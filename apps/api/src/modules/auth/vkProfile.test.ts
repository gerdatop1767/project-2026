import { randomUUID } from 'node:crypto';
import { schema } from '@zybrilka/db';
import { createSeededTestDb } from '@zybrilka/db/testing';
import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { cookieValue, fakePng } from '../../testSupport.js';
import { declaredPixels, fetchVkProfile, pickBestAvatar } from './vk.js';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

const config = loadConfig({
  NODE_ENV: 'test',
  VK_CLIENT_ID: 'vk-client',
  VK_CLIENT_SECRET: 'vk-secret',
  VK_REDIRECT_URI: 'http://localhost:5173/api/v1/auth/vk/callback',
});

const ok = (body: unknown) => ({
  ok: true,
  status: 200,
  json: async () => body,
  text: async () => '',
});

interface VkMock {
  userId?: number;
  userInfo?: unknown; // body of oauth2/user_info; undefined => HTTP error
  usersGet?: unknown; // body of method/users.get; undefined => HTTP error
}

function mockVk(opts: VkMock) {
  fetchMock.mockImplementation(async (url: string) => {
    if (url === 'https://id.vk.ru/oauth2/auth') {
      return ok({ user_id: opts.userId ?? 1, access_token: 'tok' });
    }
    if (url === 'https://id.vk.ru/oauth2/user_info') {
      return opts.userInfo === undefined
        ? { ...ok({}), ok: false, status: 500 }
        : ok(opts.userInfo);
    }
    if (url === 'https://api.vk.com/method/users.get') {
      return opts.usersGet === undefined
        ? { ...ok({}), ok: false, status: 500 }
        : ok(opts.usersGet);
    }
    throw new Error(`unexpected fetch ${url}`);
  });
}

describe('VK avatar quality (pure helpers)', () => {
  it('reads the crop a VK URL declares, and nothing else', () => {
    expect(declaredPixels('https://sun9.userapi.com/a.jpg?size=200x200&cs=50x50')).toBe(2_500);
    expect(declaredPixels('https://sun9.userapi.com/a.jpg?size=300x300')).toBe(90_000);
    expect(declaredPixels('https://sun9.userapi.com/a.jpg?cs=400x400')).toBe(160_000);
    expect(declaredPixels('https://sun9.userapi.com/a.jpg')).toBe(0);
    expect(declaredPixels('not a url')).toBe(0);
  });

  it('keeps the highest score, the earlier on a tie, and none when empty', () => {
    expect(
      pickBestAvatar([
        { url: 'a', score: 10 },
        { url: 'b', score: 30 },
        { url: 'c', score: 30 },
      ]),
    ).toBe('b');
    expect(pickBestAvatar([])).toBeUndefined();
  });
});

describe('fetchVkProfile: picks the best real photo, degrades gracefully', () => {
  afterEach(() => fetchMock.mockReset());
  const warnings: Record<string, unknown>[] = [];
  const log = { warn: (obj: Record<string, unknown>) => void warnings.push(obj) };
  afterEach(() => (warnings.length = 0));

  it('prefers the original upload (photo_max_orig) over the small user_info thumbnail', async () => {
    mockVk({
      userInfo: {
        user: {
          first_name: 'Иван',
          last_name: 'Петров',
          avatar: 'https://sun9.userapi.com/thumb.jpg?cs=50x50',
        },
      },
      usersGet: {
        response: [
          {
            first_name: 'Иван',
            photo_100: 'https://sun9.userapi.com/p100.jpg',
            photo_max_orig: 'https://sun9.userapi.com/orig.jpg',
            photo_200: 'https://sun9.userapi.com/p200.jpg',
          },
        ],
      },
    });
    expect(await fetchVkProfile(config, 'tok', log)).toEqual({
      firstName: 'Иван',
      lastName: 'Петров',
      avatarUrl: 'https://sun9.userapi.com/orig.jpg',
    });
    expect(warnings).toEqual([]);
  });

  it('without photo_max_orig takes the biggest sized variant that exists (no upscaling of small ones)', async () => {
    mockVk({
      userInfo: { user: { first_name: 'A', avatar: 'https://sun9.userapi.com/t.jpg?cs=50x50' } },
      usersGet: {
        response: [
          {
            photo_50: 'https://sun9.userapi.com/p50.jpg',
            photo_100: 'https://sun9.userapi.com/p100.jpg',
          },
        ],
      },
    });
    expect((await fetchVkProfile(config, 'tok')).avatarUrl).toBe(
      'https://sun9.userapi.com/p100.jpg',
    );
  });

  it('falls back to user_info when users.get fails entirely', async () => {
    mockVk({
      userInfo: { user: { first_name: 'A', avatar: 'https://sun9.userapi.com/t.jpg?cs=200x200' } },
    });
    expect(await fetchVkProfile(config, 'tok', log)).toMatchObject({
      avatarUrl: 'https://sun9.userapi.com/t.jpg?cs=200x200',
    });
    expect(warnings).toContainEqual(expect.objectContaining({ vkPhotoApi: 'http' }));
  });

  it('a VK API error (HTTP 200 + error object) is a warning with the error CODE only', async () => {
    mockVk({
      userInfo: { user: { first_name: 'A' } },
      usersGet: { error: { error_code: 5, error_msg: 'User authorization failed: SECRET-DETAIL' } },
    });
    expect((await fetchVkProfile(config, 'tok', log)).firstName).toBe('A');
    expect(warnings).toContainEqual({ vkPhotoApi: 'api_error', vkErrorCode: 5 });
    expect(JSON.stringify(warnings)).not.toContain('SECRET-DETAIL');
  });

  it('ignores VK placeholder pictures, foreign hosts and non-https URLs', async () => {
    mockVk({
      userInfo: { user: { first_name: 'A', avatar: 'https://vk.com/images/camera_200.png' } },
      usersGet: {
        response: [
          {
            photo_max_orig: 'https://evil.example/x.jpg',
            photo_400_orig: 'http://sun9.userapi.com/insecure.jpg',
            photo_200: 'javascript:alert(1)',
          },
        ],
      },
    });
    const profile = await fetchVkProfile(config, 'tok', log);
    expect(profile.avatarUrl).toBeUndefined();
    expect(profile.firstName).toBe('A');
    // the foreign host is reported by reason, never by URL
    expect(JSON.stringify(warnings)).not.toContain('evil.example');
  });

  it('copes with a user without a photo or last name, and with both sources down', async () => {
    mockVk({ userInfo: { user: { first_name: 'Solo' } }, usersGet: { response: [{ id: 1 }] } });
    expect(await fetchVkProfile(config, 'tok')).toEqual({
      firstName: 'Solo',
      lastName: undefined,
      avatarUrl: undefined,
    });
    mockVk({});
    expect(await fetchVkProfile(config, 'tok', log)).toEqual({
      firstName: undefined,
      lastName: undefined,
      avatarUrl: undefined,
    });
  });

  it('never throws when the network is down', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    await expect(fetchVkProfile(config, 'tok')).resolves.toBeDefined();
  });

  it('sends the access token to VK only in the request body, with the minimal field list', async () => {
    mockVk({ userInfo: { user: {} }, usersGet: { response: [{}] } });
    await fetchVkProfile(config, 'tok');
    const call = fetchMock.mock.calls.find(([u]) => u === 'https://api.vk.com/method/users.get')!;
    expect(String(call[0])).not.toContain('tok');
    expect(String(call[1].body)).toContain('fields=photo_max_orig');
    expect(String(call[1].body)).not.toContain('email'); // no extra scopes/fields
  });
});

describe('VK sign-in and linking through the HTTP flow', () => {
  let testDb: Awaited<ReturnType<typeof createSeededTestDb>>;
  let app: ReturnType<typeof buildApp>;
  let nextVkId = 5_000;

  beforeAll(async () => {
    testDb = await createSeededTestDb();
    app = buildApp({ version: 'test', db: testDb.db, authConfig: config });
  });
  afterEach(() => fetchMock.mockReset());
  afterAll(async () => {
    await app.close();
    await testDb.close();
  });

  async function vkFlow(opts: { cookie?: string; link?: boolean; state?: 'valid' | 'wrong' }) {
    const start = await app.inject({
      method: 'GET',
      url: `/api/v1/auth/vk/start${opts.link ? '?link=1' : ''}`,
      headers: opts.cookie ? { cookie: opts.cookie } : {},
    });
    if (start.statusCode !== 302) return { start, res: start, sessionId: undefined };
    const state = new URL(start.headers.location as string).searchParams.get('state');
    const pkce = cookieValue(start.headers['set-cookie'], 'vk_pkce')!;
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/auth/vk/callback?code=c&device_id=d&state=${opts.state === 'wrong' ? 'nope' : state}`,
      headers: { cookie: [`vk_pkce=${pkce}`, opts.cookie].filter(Boolean).join('; ') },
    });
    return { start, res, sessionId: cookieValue(res.headers['set-cookie'], 'session_id') };
  }

  const me = async (sessionId: string) =>
    (
      await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: { cookie: `session_id=${sessionId}` },
      })
    ).json().user;

  async function emailUser() {
    const [user] = await testDb.db.insert(schema.users).values({}).returning();
    await testDb.db.insert(schema.authIdentities).values({
      userId: user!.id,
      provider: 'email',
      providerUserId: `${randomUUID()}@example.com`,
    });
    const sessionId = randomUUID();
    await testDb.db
      .insert(schema.authSessions)
      .values({ id: sessionId, userId: user!.id, expiresAt: new Date(Date.now() + 3_600_000) });
    return { userId: user!.id, cookie: `session_id=${sessionId}` };
  }

  it('login saves the name and the best photo', async () => {
    const vkId = nextVkId++;
    mockVk({
      userId: vkId,
      userInfo: { user: { first_name: 'Иван', last_name: 'Петров' } },
      usersGet: { response: [{ photo_max_orig: 'https://sun9.userapi.com/orig.jpg' }] },
    });
    const { sessionId } = await vkFlow({});
    expect(await me(sessionId!)).toMatchObject({
      displayName: 'Иван Петров',
      avatarUrl: 'https://sun9.userapi.com/orig.jpg',
    });
  });

  it('login still works with no photo and no names', async () => {
    mockVk({ userId: nextVkId++, userInfo: { user: {} }, usersGet: { response: [{}] } });
    const { res, sessionId } = await vkFlow({});
    expect(res.statusCode).toBe(302);
    expect(await me(sessionId!)).toMatchObject({ firstName: null, avatarUrl: null });
  });

  it('login still works when both profile endpoints fail', async () => {
    mockVk({ userId: nextVkId++ });
    const { res, sessionId } = await vkFlow({});
    expect(res.statusCode).toBe(302);
    expect(sessionId).toBeTruthy();
  });

  it('re-login refreshes the provider photo but never a custom name or uploaded avatar', async () => {
    const vkId = nextVkId++;
    mockVk({
      userId: vkId,
      userInfo: { user: { first_name: 'Иван' } },
      usersGet: { response: [{ photo_max_orig: 'https://sun9.userapi.com/one.jpg' }] },
    });
    const first = await vkFlow({});
    expect((await me(first.sessionId!)).avatarUrl).toBe('https://sun9.userapi.com/one.jpg');

    // VK-side photo changes → picked up on the next login.
    mockVk({
      userId: vkId,
      userInfo: { user: { first_name: 'Иван' } },
      usersGet: { response: [{ photo_max_orig: 'https://sun9.userapi.com/two.jpg' }] },
    });
    const second = await vkFlow({});
    expect((await me(second.sessionId!)).avatarUrl).toBe('https://sun9.userapi.com/two.jpg');

    // The user sets their own name and picture.
    const cookie = `session_id=${second.sessionId}`;
    await app.inject({
      method: 'PATCH',
      url: '/api/v1/me/profile',
      payload: { displayName: 'Мой ник' },
      headers: { cookie },
    });
    await app.inject({
      method: 'PUT',
      url: '/api/v1/me/avatar',
      payload: fakePng(200, 200, 10),
      headers: { cookie, 'content-type': 'image/png' },
    });

    mockVk({
      userId: vkId,
      userInfo: { user: { first_name: 'Другое' } },
      usersGet: { response: [{ photo_max_orig: 'https://sun9.userapi.com/three.jpg' }] },
    });
    const third = await vkFlow({});
    expect(await me(third.sessionId!)).toMatchObject({
      customName: 'Мой ник',
      displayName: 'Мой ник',
      hasCustomAvatar: true,
    });
  });

  it('a failed/empty lookup on re-login never clears what is stored', async () => {
    const vkId = nextVkId++;
    mockVk({
      userId: vkId,
      userInfo: { user: { first_name: 'Иван', last_name: 'Петров' } },
      usersGet: { response: [{ photo_max_orig: 'https://sun9.userapi.com/keep.jpg' }] },
    });
    await vkFlow({});
    mockVk({
      userId: vkId,
      userInfo: { user: { first_name: '  ' } },
      usersGet: { response: [{}] },
    });
    const again = await vkFlow({});
    expect(await me(again.sessionId!)).toMatchObject({
      displayName: 'Иван Петров',
      avatarUrl: 'https://sun9.userapi.com/keep.jpg',
    });
  });

  it('rejects a wrong state with no session', async () => {
    mockVk({ userId: nextVkId++, userInfo: { user: {} }, usersGet: { response: [{}] } });
    const { res, sessionId } = await vkFlow({ state: 'wrong' });
    expect(res.statusCode).toBe(400);
    expect(sessionId).toBeUndefined();
  });

  describe('linking VK to the signed-in account', () => {
    it('refuses to start without a session', async () => {
      const { start } = await vkFlow({ link: true });
      expect(start.statusCode).toBe(401);
    });

    it('links VK to the CURRENT account, keeps the session, adopts the VK photo if empty', async () => {
      const { userId, cookie } = await emailUser();
      const vkId = nextVkId++;
      mockVk({
        userId: vkId,
        userInfo: { user: { first_name: 'Вера' } },
        usersGet: { response: [{ photo_max_orig: 'https://sun9.userapi.com/v.jpg' }] },
      });
      const { res, sessionId } = await vkFlow({ cookie, link: true });
      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toContain('/profile?link=ok&provider=vk');
      expect(sessionId).toBeUndefined(); // no new session: still the same login
      const [row] = await testDb.db
        .select()
        .from(schema.authIdentities)
        .where(
          and(
            eq(schema.authIdentities.provider, 'vk'),
            eq(schema.authIdentities.providerUserId, String(vkId)),
          ),
        );
      expect(row!.userId).toBe(userId);
      const [user] = await testDb.db.select().from(schema.users).where(eq(schema.users.id, userId));
      expect(user).toMatchObject({
        firstName: 'Вера',
        avatarUrl: 'https://sun9.userapi.com/v.jpg',
      });
    });

    it('a VK account that belongs to someone else is refused and stays where it is', async () => {
      const vkId = nextVkId++;
      mockVk({
        userId: vkId,
        userInfo: { user: { first_name: 'Owner' } },
        usersGet: { response: [{}] },
      });
      const owner = await vkFlow({});
      const ownerId = (await me(owner.sessionId!)).id;

      const { cookie } = await emailUser();
      mockVk({
        userId: vkId,
        userInfo: { user: { first_name: 'Owner' } },
        usersGet: { response: [{}] },
      });
      const { res } = await vkFlow({ cookie, link: true });
      expect(res.headers.location).toContain('link=taken');
      const [row] = await testDb.db
        .select()
        .from(schema.authIdentities)
        .where(eq(schema.authIdentities.providerUserId, String(vkId)));
      expect(row!.userId).toBe(ownerId);
    });

    it('linking the same VK account twice is a harmless no-op', async () => {
      const { cookie } = await emailUser();
      const vkId = nextVkId++;
      const mock = () =>
        mockVk({
          userId: vkId,
          userInfo: { user: { first_name: 'A' } },
          usersGet: { response: [{}] },
        });
      mock();
      await vkFlow({ cookie, link: true });
      mock();
      const { res } = await vkFlow({ cookie, link: true });
      expect(res.headers.location).toContain('link=already');
    });

    it('an account holds one VK account only', async () => {
      const { cookie } = await emailUser();
      mockVk({ userId: nextVkId++, userInfo: { user: {} }, usersGet: { response: [{}] } });
      await vkFlow({ cookie, link: true });
      mockVk({ userId: nextVkId++, userInfo: { user: {} }, usersGet: { response: [{}] } });
      const { res } = await vkFlow({ cookie, link: true });
      expect(res.headers.location).toContain('link=provider_used');
    });

    it('the callback fails safely if the signed-in account changed mid-flow', async () => {
      const a = await emailUser();
      const b = await emailUser();
      const start = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/vk/start?link=1',
        headers: { cookie: a.cookie },
      });
      const state = new URL(start.headers.location as string).searchParams.get('state');
      const pkce = cookieValue(start.headers['set-cookie'], 'vk_pkce')!;
      mockVk({ userId: nextVkId++, userInfo: { user: {} }, usersGet: { response: [{}] } });
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/auth/vk/callback?code=c&device_id=d&state=${state}`,
        headers: { cookie: `vk_pkce=${pkce}; ${b.cookie}` },
      });
      expect(res.headers.location).toContain('link=session_changed');
      const linked = await testDb.db
        .select()
        .from(schema.authIdentities)
        .where(eq(schema.authIdentities.provider, 'vk'));
      expect(linked.some((row) => row.userId === b.userId)).toBe(false);
    });

    it('replaying the callback does nothing (state cookie is single-use)', async () => {
      const { cookie } = await emailUser();
      const start = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/vk/start?link=1',
        headers: { cookie },
      });
      const state = new URL(start.headers.location as string).searchParams.get('state');
      const pkce = cookieValue(start.headers['set-cookie'], 'vk_pkce')!;
      mockVk({ userId: nextVkId++, userInfo: { user: {} }, usersGet: { response: [{}] } });
      const url = `/api/v1/auth/vk/callback?code=c&device_id=d&state=${state}`;
      const first = await app.inject({
        method: 'GET',
        url,
        headers: { cookie: `vk_pkce=${pkce}; ${cookie}` },
      });
      expect(first.headers.location).toContain('link=ok');
      // The browser dropped the cleared cookie, so a replay carries none.
      const replay = await app.inject({ method: 'GET', url, headers: { cookie } });
      expect(replay.statusCode).toBe(400);
    });

    it('a VK failure during linking leaves the account unchanged', async () => {
      const { cookie, userId } = await emailUser();
      fetchMock.mockRejectedValue(new TypeError('fetch failed'));
      const { res } = await vkFlow({ cookie, link: true });
      expect(res.headers.location).toContain('link=error');
      const identities = await testDb.db
        .select()
        .from(schema.authIdentities)
        .where(eq(schema.authIdentities.userId, userId));
      expect(identities.map((i) => i.provider)).toEqual(['email']);
    });
  });
});
