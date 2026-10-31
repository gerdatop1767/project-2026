import { randomUUID } from 'node:crypto';
import { schema } from '@zybrilka/db';
import { createSeededTestDb } from '@zybrilka/db/testing';
import { AVATAR_MAX_BYTES } from '@zybrilka/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { fakeJpeg, fakePng } from '../../testSupport.js';

describe('profile API: name, avatar, isolation', () => {
  let testDb: Awaited<ReturnType<typeof createSeededTestDb>>;
  let app: ReturnType<typeof buildApp>;

  beforeAll(async () => {
    testDb = await createSeededTestDb();
    app = buildApp({
      version: 'test',
      db: testDb.db,
      authConfig: loadConfig({ NODE_ENV: 'test' }),
    });
  });
  afterAll(async () => {
    await app.close();
    await testDb.close();
  });

  async function signedInUser(
    profile: { firstName?: string; lastName?: string; avatarUrl?: string } = {},
  ) {
    const [user] = await testDb.db.insert(schema.users).values(profile).returning();
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

  const patchName = (cookie: string, displayName: unknown, headers: Record<string, string> = {}) =>
    app.inject({
      method: 'PATCH',
      url: '/api/v1/me/profile',
      payload: { displayName },
      headers: { cookie, ...headers },
    });
  const putAvatar = (
    cookie: string,
    body: Buffer | string,
    type = 'image/png',
    headers: Record<string, string> = {},
  ) =>
    app.inject({
      method: 'PUT',
      url: '/api/v1/me/avatar',
      payload: body,
      headers: { cookie, 'content-type': type, ...headers },
    });

  describe('display name', () => {
    it('requires a session', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/v1/me/profile',
        payload: { displayName: 'x' },
      });
      expect(res.statusCode).toBe(401);
    });

    it('saves a normalized custom name which wins over the provider name; null resets it', async () => {
      const { cookie } = await signedInUser({ firstName: 'Иван', lastName: 'Петров' });
      const res = await patchName(cookie, '  Вася ​  Пупкин\t');
      expect(res.statusCode).toBe(200);
      expect(res.json().user).toMatchObject({
        customName: 'Вася Пупкин',
        displayName: 'Вася Пупкин',
        firstName: 'Иван',
        lastName: 'Петров',
      });
      const reset = await patchName(cookie, '   ');
      expect(reset.json().user).toMatchObject({ customName: null, displayName: 'Иван Петров' });
    });

    it.each([
      ['markup', '<img src=x onerror=alert(1)>', 'forbidden_characters'],
      ['too long', 'я'.repeat(41), 'too_long'],
    ])('rejects %s', async (_name, value, problem) => {
      const { cookie } = await signedInUser();
      const res = await patchName(cookie, value);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'invalid_name', problem });
    });

    it('rejects the wrong shape', async () => {
      const { cookie } = await signedInUser();
      expect((await patchName(cookie, 42)).statusCode).toBe(400);
      expect((await patchName(cookie, undefined)).statusCode).toBe(400);
    });

    it('ignores any user id in the body — only the session owner changes', async () => {
      const a = await signedInUser();
      const b = await signedInUser();
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/v1/me/profile',
        payload: { displayName: 'Mine', userId: b.userId, id: b.userId },
        headers: { cookie: a.cookie },
      });
      expect(res.statusCode).toBe(200);
      const [other] = await testDb.db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, b.userId));
      expect(other!.displayName).toBeNull();
    });

    it('blocks a cross-site write even with a valid cookie', async () => {
      const { cookie } = await signedInUser();
      const res = await patchName(cookie, 'x', { 'sec-fetch-site': 'cross-site' });
      expect(res.statusCode).toBe(403);
    });

    it('stores the name verbatim as text — no HTML interpretation server-side', async () => {
      const { cookie } = await signedInUser();
      const res = await patchName(cookie, 'Tom & "Jerry"');
      expect(res.json().user.displayName).toBe('Tom & "Jerry"');
    });
  });

  describe('avatar upload', () => {
    it('stores a valid image, serves it back to its owner with hardened headers, and shows it first', async () => {
      const { cookie } = await signedInUser({
        avatarUrl: 'https://sun9.userapi.com/provider.jpg',
      });
      const png = fakePng(256, 256, 100);
      const res = await putAvatar(cookie, png);
      expect(res.statusCode).toBe(200);
      const { user } = res.json();
      expect(user.hasCustomAvatar).toBe(true);
      expect(user.avatarUrl).toMatch(/^\/api\/v1\/me\/avatars\/user\?v=[0-9a-f]{12}$/);

      const served = await app.inject({
        method: 'GET',
        url: user.avatarUrl,
        headers: { cookie },
      });
      expect(served.statusCode).toBe(200);
      expect(served.headers['content-type']).toBe('image/png');
      expect(served.headers['x-content-type-options']).toBe('nosniff');
      expect(served.headers['content-security-policy']).toContain('sandbox');
      expect(served.headers['cache-control']).toContain('private');
      expect(Buffer.compare(served.rawPayload, png)).toBe(0);
    });

    it('replaces the previous upload (one row per user) and the URL version changes', async () => {
      const { cookie, userId } = await signedInUser();
      const first = (await putAvatar(cookie, fakePng(200, 200, 1))).json().user.avatarUrl;
      const second = (await putAvatar(cookie, fakeJpeg(300, 300), 'image/jpeg')).json().user
        .avatarUrl;
      expect(second).not.toBe(first);
      const rows = await testDb.db
        .select()
        .from(schema.userAvatars)
        .where(eq(schema.userAvatars.userId, userId));
      expect(rows).toHaveLength(1);
      expect(rows[0]!.contentType).toBe('image/jpeg');
    });

    it('decides by the real bytes: a text/HTML/SVG file labelled image/png is refused', async () => {
      const { cookie } = await signedInUser();
      for (const body of [
        '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
        '<html></html>',
        'plain text',
      ]) {
        const res = await putAvatar(cookie, body, 'image/png');
        expect(res.statusCode).toBe(400);
        expect(res.json().error).toBe('invalid_image');
      }
    });

    it('refuses a real image served with an SVG/GIF/text content type', async () => {
      const { cookie } = await signedInUser();
      for (const type of ['image/svg+xml', 'image/gif', 'text/plain', 'application/json']) {
        const res = await putAvatar(cookie, fakePng(200, 200), type);
        expect([400, 415]).toContain(res.statusCode); // rejected before any storage
        expect(res.json().user).toBeUndefined();
      }
    });

    it('refuses oversize files (413) and unreasonable dimensions (400)', async () => {
      const { cookie } = await signedInUser();
      const big = await putAvatar(cookie, fakePng(512, 512, AVATAR_MAX_BYTES + 10));
      expect(big.statusCode).toBe(413);
      const tiny = await putAvatar(cookie, fakePng(8, 8));
      expect(tiny.statusCode).toBe(400);
      expect(tiny.json().problem).toBe('bad_dimensions');
      const huge = await putAvatar(cookie, fakePng(60_000, 60_000));
      expect(huge.json().problem).toBe('bad_dimensions');
    });

    it('refuses an empty body', async () => {
      const { cookie } = await signedInUser();
      const res = await putAvatar(cookie, Buffer.alloc(0));
      expect([400, 413, 415]).toContain(res.statusCode);
    });

    it('cannot be given an arbitrary URL — JSON bodies are not accepted', async () => {
      const { cookie, userId } = await signedInUser();
      const res = await app.inject({
        method: 'PUT',
        url: '/api/v1/me/avatar',
        payload: { avatarUrl: 'https://evil.example/x.png' },
        headers: { cookie },
      });
      expect(res.statusCode).toBe(415);
      const [row] = await testDb.db.select().from(schema.users).where(eq(schema.users.id, userId));
      expect(row!.avatarUrl).toBeNull();
    });

    it('requires a session and rejects cross-site writes', async () => {
      const anon = await app.inject({
        method: 'PUT',
        url: '/api/v1/me/avatar',
        payload: fakePng(200, 200),
        headers: { 'content-type': 'image/png' },
      });
      expect(anon.statusCode).toBe(401);
      const { cookie } = await signedInUser();
      const cross = await putAvatar(cookie, fakePng(200, 200), 'image/png', {
        'sec-fetch-site': 'cross-site',
      });
      expect(cross.statusCode).toBe(403);
    });

    it('removing the upload falls back to the provider photo', async () => {
      const { cookie } = await signedInUser({ avatarUrl: 'https://sun9.userapi.com/p.jpg' });
      await putAvatar(cookie, fakePng(200, 200));
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/v1/me/avatar',
        headers: { cookie },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().user).toMatchObject({
        hasCustomAvatar: false,
        avatarUrl: 'https://sun9.userapi.com/p.jpg',
      });
    });

    it("a user can never read someone else's avatar", async () => {
      const a = await signedInUser();
      const b = await signedInUser();
      await putAvatar(a.cookie, fakePng(200, 200));
      // b asks for "user" avatar: gets b's own (none), never a's.
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/me/avatars/user',
        headers: { cookie: b.cookie },
      });
      expect(res.statusCode).toBe(404);
      const anon = await app.inject({ method: 'GET', url: '/api/v1/me/avatars/user' });
      expect(anon.statusCode).toBe(401);
      const bad = await app.inject({
        method: 'GET',
        url: '/api/v1/me/avatars/..%2Fusers',
        headers: { cookie: b.cookie },
      });
      expect(bad.statusCode).toBe(404);
    });
  });

  describe('GET /me/identities', () => {
    it('lists linked methods, availability, and whether unlinking is allowed', async () => {
      const { cookie } = await signedInUser();
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/me/identities',
        headers: { cookie },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.identities).toHaveLength(1);
      expect(body.identities[0].provider).toBe('email');
      expect(body.canUnlink).toBe(false);
      expect(body.available).toEqual({ vk: false, telegram: false, yandex: false });
    });
  });

  describe('unlinking: only working methods (VK, Yandex, Telegram) count', () => {
    async function addIdentity(userId: string, provider: 'vk' | 'yandex' | 'telegram') {
      await testDb.db.insert(schema.authIdentities).values({
        userId,
        provider,
        providerUserId: String(Math.floor(Math.random() * 1e12)),
      });
    }
    const unlink = (cookie: string, provider: string) =>
      app.inject({
        method: 'DELETE',
        url: `/api/v1/me/identities/${provider}`,
        headers: { cookie },
      });
    const providersOf = async (userId: string) =>
      (
        await testDb.db
          .select({ provider: schema.authIdentities.provider })
          .from(schema.authIdentities)
          .where(eq(schema.authIdentities.userId, userId))
      )
        .map((row) => row.provider)
        .sort();

    it('unlinking a provider removes its photo copy, nothing else', async () => {
      const { userId, cookie } = await signedInUser();
      await addIdentity(userId, 'vk');
      await addIdentity(userId, 'telegram');
      const png = Buffer.from('89504e470d0a1a0a', 'hex');
      for (const source of ['vk', 'telegram', 'user'] as const) {
        await testDb.db.insert(schema.userAvatars).values({
          userId,
          source,
          contentType: 'image/png',
          width: 1,
          height: 1,
          byteSize: png.length,
          sha256: 'a'.repeat(64),
          data: png,
        });
      }
      expect((await unlink(cookie, 'vk')).statusCode).toBe(200);
      const left = await testDb.db
        .select({ source: schema.userAvatars.source })
        .from(schema.userAvatars)
        .where(eq(schema.userAvatars.userId, userId));
      expect(left.map((r) => r.source).sort()).toEqual(['telegram', 'user']);
    });

    it('email + Yandex: Yandex cannot be unlinked (it is the only way in)', async () => {
      const { userId, cookie } = await signedInUser();
      await addIdentity(userId, 'yandex');

      const list = await app.inject({
        method: 'GET',
        url: '/api/v1/me/identities',
        headers: { cookie },
      });
      expect(list.json().canUnlink).toBe(false);

      const res = await unlink(cookie, 'yandex');
      expect(res.statusCode).toBe(409);
      expect(res.json()).toEqual({ error: 'last_identity' });
      expect(await providersOf(userId)).toEqual(['email', 'yandex']);
    });

    it('DELETE /me/identities/email is refused and the email row stays', async () => {
      const { userId, cookie } = await signedInUser();
      await addIdentity(userId, 'vk');
      await addIdentity(userId, 'yandex');
      const res = await unlink(cookie, 'email');
      expect(res.statusCode).toBe(404);
      expect(await providersOf(userId)).toEqual(['email', 'vk', 'yandex']);
    });

    it('with two working methods one can be unlinked, then the other cannot', async () => {
      const { userId, cookie } = await signedInUser();
      await addIdentity(userId, 'vk');
      await addIdentity(userId, 'yandex');

      const first = await unlink(cookie, 'yandex');
      expect(first.statusCode).toBe(200);
      expect(first.json().canUnlink).toBe(false);
      expect(await providersOf(userId)).toEqual(['email', 'vk']);

      const second = await unlink(cookie, 'vk');
      expect(second.statusCode).toBe(409);
      expect(await providersOf(userId)).toEqual(['email', 'vk']);
    });
  });

  describe('GET /auth/me: needsSignInMethod', () => {
    const me = (cookie: string) =>
      app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie } });

    it('is set for a legacy account with only an email identity', async () => {
      const { cookie } = await signedInUser();
      const res = await me(cookie);
      expect(res.statusCode).toBe(200);
      expect(res.json().user).not.toBeNull();
      expect(res.json().needsSignInMethod).toBe(true);
    });

    it.each(['vk', 'yandex', 'telegram'] as const)(
      'is absent once %s is connected',
      async (provider) => {
        const { userId, cookie } = await signedInUser();
        await testDb.db.insert(schema.authIdentities).values({
          userId,
          provider,
          providerUserId: String(Math.floor(Math.random() * 1e12)),
        });
        const res = await me(cookie);
        expect(res.json().user).not.toBeNull();
        expect(res.json()).not.toHaveProperty('needsSignInMethod');
      },
    );

    it('is absent for a guest', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/auth/me' });
      expect(res.json()).toEqual({ user: null });
    });
  });
});
