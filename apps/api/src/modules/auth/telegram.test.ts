import { randomUUID } from 'node:crypto';
import { schema } from '@zybrilka/db';
import { createSeededTestDb } from '@zybrilka/db/testing';
import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import {
  cookieValue,
  fakePng,
  signTelegramInitData,
  telegramLaunch,
  type TgUserInput,
} from '../../testSupport.js';
import { TelegramAuthError, verifyTelegramInitData } from './telegram.js';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

const BOT_TOKEN = '123456:TEST-bot-token-not-a-real-secret';
const NOW = 1_800_000_000;
const verifyOptions = { maxAgeSeconds: 3600, nowSeconds: NOW };

const ivan: TgUserInput = { id: 777001, first_name: 'Иван', last_name: 'Петров', username: 'ivan' };

describe('verifyTelegramInitData (official HMAC algorithm, independent signer)', () => {
  const launch = (user: TgUserInput = ivan, authDate = NOW - 10) =>
    telegramLaunch(BOT_TOKEN, user, { authDate });

  it('accepts data signed with the bot token and returns the stable numeric id', () => {
    const verified = verifyTelegramInitData(launch(), BOT_TOKEN, verifyOptions);
    expect(verified).toMatchObject({ id: '777001', firstName: 'Иван', lastName: 'Петров' });
  });

  it('keys identity by id, not by username', () => {
    const a = verifyTelegramInitData(
      launch({ id: 5, username: 'old_name' }),
      BOT_TOKEN,
      verifyOptions,
    );
    const b = verifyTelegramInitData(
      launch({ id: 5, username: 'new_name' }),
      BOT_TOKEN,
      verifyOptions,
    );
    expect(a.id).toBe(b.id);
  });

  it('rejects data signed with a different bot token', () => {
    const forged = telegramLaunch('999:other-bot', ivan, { authDate: NOW - 10 });
    expect(() => verifyTelegramInitData(forged, BOT_TOKEN, verifyOptions)).toThrow(
      expect.objectContaining({ reason: 'bad_signature' }),
    );
  });

  it('rejects any tampering with a signed field', () => {
    const params = new URLSearchParams(launch());
    params.set('user', JSON.stringify({ ...ivan, id: 1 })); // swap in another user id
    expect(() => verifyTelegramInitData(params.toString(), BOT_TOKEN, verifyOptions)).toThrow(
      expect.objectContaining({ reason: 'bad_signature' }),
    );
  });

  it('rejects an added field, a removed field and a wrong hash', () => {
    const added = new URLSearchParams(launch());
    added.set('start_param', 'x');
    expect(() => verifyTelegramInitData(added.toString(), BOT_TOKEN, verifyOptions)).toThrow(
      TelegramAuthError,
    );
    const removed = new URLSearchParams(launch());
    removed.delete('query_id');
    expect(() => verifyTelegramInitData(removed.toString(), BOT_TOKEN, verifyOptions)).toThrow(
      TelegramAuthError,
    );
    const wrong = signTelegramInitData(
      BOT_TOKEN,
      { auth_date: String(NOW), user: JSON.stringify(ivan) },
      { hash: 'a'.repeat(64) },
    );
    expect(() => verifyTelegramInitData(wrong, BOT_TOKEN, verifyOptions)).toThrow(
      expect.objectContaining({ reason: 'bad_signature' }),
    );
  });

  it.each([
    ['empty', ''],
    ['not a query string', 'hello'],
    ['no hash', 'auth_date=1&user=%7B%7D'],
    ['hash of the wrong shape', 'auth_date=1&hash=zz'],
  ])('rejects malformed input: %s', (_name, input) => {
    expect(() => verifyTelegramInitData(input, BOT_TOKEN, verifyOptions)).toThrow(
      TelegramAuthError,
    );
  });

  it('rejects duplicated fields instead of picking one', () => {
    const dup = `${launch()}&user=${encodeURIComponent(JSON.stringify({ id: 1 }))}`;
    expect(() => verifyTelegramInitData(dup, BOT_TOKEN, verifyOptions)).toThrow(
      expect.objectContaining({ reason: 'malformed' }),
    );
  });

  it('rejects stale auth_date and one from the future', () => {
    expect(() =>
      verifyTelegramInitData(launch(ivan, NOW - 3601), BOT_TOKEN, verifyOptions),
    ).toThrow(expect.objectContaining({ reason: 'expired' }));
    expect(() =>
      verifyTelegramInitData(launch(ivan, NOW + 3600), BOT_TOKEN, verifyOptions),
    ).toThrow(expect.objectContaining({ reason: 'from_future' }));
    expect(() =>
      verifyTelegramInitData(launch(ivan, NOW - 3600), BOT_TOKEN, verifyOptions),
    ).not.toThrow();
  });

  it('rejects signed data without a usable user, and bots', () => {
    const chatOnly = signTelegramInitData(BOT_TOKEN, {
      auth_date: String(NOW),
      chat_type: 'sender',
    });
    expect(() => verifyTelegramInitData(chatOnly, BOT_TOKEN, verifyOptions)).toThrow(
      expect.objectContaining({ reason: 'no_user' }),
    );
    expect(() =>
      verifyTelegramInitData(launch({ id: 9, is_bot: true }), BOT_TOKEN, verifyOptions),
    ).toThrow(expect.objectContaining({ reason: 'invalid_user' }));
    const badJson = signTelegramInitData(BOT_TOKEN, { auth_date: String(NOW), user: '{nope' });
    expect(() => verifyTelegramInitData(badJson, BOT_TOKEN, verifyOptions)).toThrow(
      expect.objectContaining({ reason: 'invalid_user' }),
    );
  });

  it('passes through only an allow-listed https photo URL', () => {
    const ok = verifyTelegramInitData(
      launch({ ...ivan, photo_url: 'https://t.me/i/userpic/320/abc.jpg' }),
      BOT_TOKEN,
      verifyOptions,
    );
    expect(ok.photoUrl).toBe('https://t.me/i/userpic/320/abc.jpg');
    for (const photo_url of [
      'http://t.me/i/userpic/320/abc.jpg',
      'https://evil.example/x.jpg',
      'javascript:alert(1)',
    ]) {
      const verified = verifyTelegramInitData(
        launch({ ...ivan, photo_url }),
        BOT_TOKEN,
        verifyOptions,
      );
      expect(verified.photoUrl).toBeUndefined();
    }
  });
});

describe('POST /auth/telegram and linking (full server flow)', () => {
  let testDb: Awaited<ReturnType<typeof createSeededTestDb>>;
  let app: ReturnType<typeof buildApp>;
  let counter = 100_000;

  beforeAll(async () => {
    testDb = await createSeededTestDb();
    app = buildApp({
      version: 'test',
      db: testDb.db,
      authConfig: loadConfig({
        NODE_ENV: 'test',
        TELEGRAM_BOT_TOKEN: BOT_TOKEN,
        VK_CLIENT_ID: 'vk-client',
        VK_CLIENT_SECRET: 'vk-secret',
        VK_REDIRECT_URI: 'http://localhost:5173/api/v1/auth/vk/callback',
      }),
    });
  });
  afterEach(() => fetchMock.mockReset());
  afterAll(async () => {
    await app.close();
    await testDb.close();
  });

  const newUser = (extra: Partial<TgUserInput> = {}): TgUserInput => ({
    id: ++counter,
    first_name: 'Анна',
    last_name: 'Ким',
    ...extra,
  });

  async function tgLogin(initData: string, cookie?: string) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/telegram',
      payload: { initData },
      headers: cookie ? { cookie } : {},
    });
    return { res, sessionId: cookieValue(res.headers['set-cookie'], 'session_id') };
  }

  const meWith = async (sessionId: string) =>
    (
      await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: { cookie: `session_id=${sessionId}` },
      })
    ).json().user;

  const usersWithTelegram = async (id: number) =>
    (
      await testDb.db
        .select()
        .from(schema.authIdentities)
        .where(
          and(
            eq(schema.authIdentities.provider, 'telegram'),
            eq(schema.authIdentities.providerUserId, String(id)),
          ),
        )
    ).length;

  it('registers a new Telegram user, opens a normal session, and shows the Telegram name and photo', async () => {
    const user = newUser({ photo_url: 'https://t.me/i/userpic/320/a.jpg' });
    const { res, sessionId } = await tgLogin(telegramLaunch(BOT_TOKEN, user));
    expect(res.statusCode).toBe(200);
    expect(res.json().created).toBe(true);
    expect(sessionId).toBeTruthy();
    expect(res.headers['set-cookie']).toContain('HttpOnly');
    expect(await meWith(sessionId!)).toMatchObject({
      firstName: 'Анна',
      lastName: 'Ким',
      displayName: 'Анна Ким',
      avatarUrl: 'https://t.me/i/userpic/320/a.jpg',
      hasCustomAvatar: false,
      onboardingCompleted: false,
    });
    expect(await usersWithTelegram(user.id)).toBe(1);
  });

  it('a returning user is logged into the SAME account — no duplicate', async () => {
    const user = newUser();
    const first = await tgLogin(telegramLaunch(BOT_TOKEN, user));
    const second = await tgLogin(telegramLaunch(BOT_TOKEN, user));
    expect(second.res.json().created).toBe(false);
    expect(second.res.json().user.id).toBe(first.res.json().user.id);
    expect(await usersWithTelegram(user.id)).toBe(1);
  });

  it('a changed username does not create another account', async () => {
    const user = newUser({ username: 'before' });
    const first = await tgLogin(telegramLaunch(BOT_TOKEN, user));
    const second = await tgLogin(telegramLaunch(BOT_TOKEN, { ...user, username: 'after' }));
    expect(second.res.json().user.id).toBe(first.res.json().user.id);
  });

  it('missing photo, missing names: sign-in still works', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 400, json: async () => ({ ok: false }) });
    const { res } = await tgLogin(telegramLaunch(BOT_TOKEN, { id: ++counter }));
    expect(res.statusCode).toBe(200);
    expect(res.json().user).toMatchObject({ firstName: null, lastName: null, avatarUrl: null });
  });

  it('falls back to the bot API for a photo when initData has none, and stores it', async () => {
    const user = newUser();
    const png = fakePng(320, 320, 50);
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith('/getUserProfilePhotos')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            result: {
              photos: [
                [
                  { file_id: 'small', width: 160, height: 160, file_size: 10 },
                  { file_id: 'big', width: 640, height: 640, file_size: 20 },
                ],
              ],
            },
          }),
        };
      }
      if (url.endsWith('/getFile')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, result: { file_path: 'photos/file_1.jpg' } }),
        };
      }
      if (url.includes('/file/bot')) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-length': String(png.length) }),
          arrayBuffer: async () => png.buffer.slice(png.byteOffset, png.byteOffset + png.length),
        };
      }
      throw new Error(`unexpected ${url}`);
    });
    const { res, sessionId } = await tgLogin(telegramLaunch(BOT_TOKEN, user));
    expect(res.statusCode).toBe(200);
    const me = await meWith(sessionId!);
    expect(me.avatarUrl).toMatch(/^\/api\/v1\/me\/avatars\/telegram\?v=[0-9a-f]{12}$/);
    const getFileCall = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/getFile'));
    expect(JSON.parse(getFileCall![1].body)).toEqual({ file_id: 'big' }); // best variant
    const avatar = await app.inject({
      method: 'GET',
      url: me.avatarUrl,
      headers: { cookie: `session_id=${sessionId}` },
    });
    expect(avatar.statusCode).toBe(200);
    expect(avatar.headers['content-type']).toBe('image/png');
    expect(avatar.headers['x-content-type-options']).toBe('nosniff');
  });

  it('a non-image from the bot file endpoint is dropped, login still succeeds', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith('/getUserProfilePhotos')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, result: { photos: [[{ file_id: 'x', file_size: 5 }]] } }),
        };
      }
      if (url.endsWith('/getFile')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, result: { file_path: 'photos/f.jpg' } }),
        };
      }
      const html = Buffer.from('<html>not an image</html>');
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        arrayBuffer: async () => html.buffer.slice(html.byteOffset, html.byteOffset + html.length),
      };
    });
    const { res } = await tgLogin(telegramLaunch(BOT_TOKEN, newUser()));
    expect(res.statusCode).toBe(200);
    expect(res.json().user.avatarUrl).toBeNull();
  });

  it('rejects forged, tampered, expired and malformed data with no session', async () => {
    const forged = telegramLaunch('1:other', newUser());
    const stale = telegramLaunch(BOT_TOKEN, newUser(), {
      authDate: Math.floor(Date.now() / 1000) - 7200,
    });
    for (const [initData, error] of [
      [forged, 'invalid_telegram_data'],
      [stale, 'telegram_data_expired'],
      ['garbage', 'invalid_telegram_data'],
    ] as const) {
      const { res, sessionId } = await tgLogin(initData);
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ error });
      expect(sessionId).toBeUndefined();
    }
    const empty = await app.inject({ method: 'POST', url: '/api/v1/auth/telegram', payload: {} });
    expect(empty.statusCode).toBe(400);
  });

  it('a user object sent next to initData is never trusted', async () => {
    const real = newUser();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/telegram',
      payload: { initData: telegramLaunch(BOT_TOKEN, real), user: { id: 1 }, userId: '1' },
    });
    expect(res.statusCode).toBe(200);
    expect(await usersWithTelegram(real.id)).toBe(1);
  });

  it('refuses cross-site POSTs (login CSRF)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/telegram',
      payload: { initData: telegramLaunch(BOT_TOKEN, newUser()) },
      headers: { 'sec-fetch-site': 'cross-site' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('is unavailable (503), not open, without a bot token', async () => {
    const bare = buildApp({
      version: 'test',
      db: testDb.db,
      authConfig: loadConfig({ NODE_ENV: 'test' }),
    });
    const res = await bare.inject({
      method: 'POST',
      url: '/api/v1/auth/telegram',
      payload: { initData: telegramLaunch(BOT_TOKEN, newUser()) },
    });
    expect(res.statusCode).toBe(503);
    await bare.close();
  });

  it('does not overwrite a custom name or uploaded avatar on login', async () => {
    const user = newUser();
    const first = await tgLogin(telegramLaunch(BOT_TOKEN, user));
    const cookie = `session_id=${first.sessionId}`;
    const rename = await app.inject({
      method: 'PATCH',
      url: '/api/v1/me/profile',
      payload: { displayName: 'Мой ник' },
      headers: { cookie },
    });
    expect(rename.statusCode).toBe(200);
    const upload = await app.inject({
      method: 'PUT',
      url: '/api/v1/me/avatar',
      payload: fakePng(200, 200, 20),
      headers: { cookie, 'content-type': 'image/png' },
    });
    expect(upload.statusCode).toBe(200);

    const again = await tgLogin(
      telegramLaunch(BOT_TOKEN, {
        ...user,
        first_name: 'Другое',
        photo_url: 'https://t.me/i/userpic/320/new.jpg',
      }),
    );
    expect(again.res.json().user).toMatchObject({
      customName: 'Мой ник',
      displayName: 'Мой ник',
      hasCustomAvatar: true,
    });
    expect(again.res.json().user.avatarUrl).toMatch(/\/me\/avatars\/user\?v=/);
  });

  describe('linking Telegram to a signed-in account', () => {
    async function emailSession(email: string) {
      const user = (await testDb.db.insert(schema.users).values({}).returning())[0]!;
      await testDb.db
        .insert(schema.authIdentities)
        .values({ userId: user.id, provider: 'email', providerUserId: email });
      const sessionId = randomUUID();
      await testDb.db
        .insert(schema.authSessions)
        .values({ id: sessionId, userId: user.id, expiresAt: new Date(Date.now() + 3_600_000) });
      return { userId: user.id, cookie: `session_id=${sessionId}` };
    }

    const link = (cookie: string, initData: string) =>
      app.inject({
        method: 'POST',
        url: '/api/v1/me/identities/telegram',
        payload: { initData },
        headers: { cookie },
      });

    it('requires a session', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/me/identities/telegram',
        payload: { initData: telegramLaunch(BOT_TOKEN, newUser()) },
      });
      expect(res.statusCode).toBe(401);
    });

    it('links a verified Telegram account to the current account and is idempotent', async () => {
      const { cookie, userId } = await emailSession('link1@example.com');
      const tg = newUser();
      const res = await link(cookie, telegramLaunch(BOT_TOKEN, tg));
      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe('linked');
      expect(res.json().user.id).toBe(userId);
      const again = await link(cookie, telegramLaunch(BOT_TOKEN, tg));
      expect(again.json().status).toBe('already_linked');
      expect(await usersWithTelegram(tg.id)).toBe(1);

      // Signing in with Telegram now lands in that same account.
      const login = await tgLogin(telegramLaunch(BOT_TOKEN, tg));
      expect(login.res.json().user.id).toBe(userId);
    });

    it('refuses an identity owned by another account — nothing moves or merges', async () => {
      const owner = newUser();
      const ownerLogin = await tgLogin(telegramLaunch(BOT_TOKEN, owner));
      const { cookie } = await emailSession('link2@example.com');
      const res = await link(cookie, telegramLaunch(BOT_TOKEN, owner));
      expect(res.statusCode).toBe(409);
      expect(res.json()).toEqual({ error: 'identity_taken', provider: 'telegram' });
      const [row] = await testDb.db
        .select()
        .from(schema.authIdentities)
        .where(eq(schema.authIdentities.providerUserId, String(owner.id)));
      expect(row!.userId).toBe(ownerLogin.res.json().user.id);
    });

    it('one account cannot hold two different Telegram accounts', async () => {
      const { cookie } = await emailSession('link3@example.com');
      expect((await link(cookie, telegramLaunch(BOT_TOKEN, newUser()))).statusCode).toBe(200);
      const second = await link(cookie, telegramLaunch(BOT_TOKEN, newUser()));
      expect(second.statusCode).toBe(409);
      expect(second.json().error).toBe('provider_already_used');
    });

    it('rejects forged / expired initData', async () => {
      const { cookie } = await emailSession('link4@example.com');
      const forged = await link(cookie, telegramLaunch('1:other', newUser()));
      expect(forged.statusCode).toBe(400);
      expect(forged.json()).toEqual({ error: 'invalid_telegram_data' });
      const stale = await link(
        cookie,
        telegramLaunch(BOT_TOKEN, newUser(), { authDate: Math.floor(Date.now() / 1000) - 99_999 }),
      );
      expect(stale.json()).toEqual({ error: 'telegram_data_expired' });
    });

    it('signing in with an unlinked Telegram account while signed in does NOT create or merge accounts', async () => {
      const { cookie } = await emailSession('link5@example.com');
      const tg = newUser();
      const res = await tgLogin(telegramLaunch(BOT_TOKEN, tg), cookie);
      expect(res.res.statusCode).toBe(409);
      expect(res.res.json()).toEqual({ error: 'telegram_not_linked' });
      expect(await usersWithTelegram(tg.id)).toBe(0);
    });

    it('blocks unlinking the last WORKING method — a legacy email row does not count', async () => {
      const { cookie } = await emailSession('link6@example.com');
      const tg = newUser();
      await link(cookie, telegramLaunch(BOT_TOKEN, tg));

      // email + telegram: telegram is the only way in, so it stays.
      const removeTelegram = await app.inject({
        method: 'DELETE',
        url: '/api/v1/me/identities/telegram',
        headers: { cookie },
      });
      expect(removeTelegram.statusCode).toBe(409);
      expect(removeTelegram.json()).toEqual({ error: 'last_identity' });

      // The legacy email row can never be removed through the API.
      const removeEmail = await app.inject({
        method: 'DELETE',
        url: '/api/v1/me/identities/email',
        headers: { cookie },
      });
      expect(removeEmail.statusCode).toBe(404);

      const missing = await app.inject({
        method: 'DELETE',
        url: '/api/v1/me/identities/vk',
        headers: { cookie },
      });
      expect(missing.statusCode).toBe(404);
      expect(missing.json()).toEqual({ error: 'not_linked' });

      const list = await app.inject({
        method: 'GET',
        url: '/api/v1/me/identities',
        headers: { cookie },
      });
      expect(list.json().canUnlink).toBe(false);
      expect(
        list
          .json()
          .identities.map((i: { provider: string }) => i.provider)
          .sort(),
      ).toEqual(['email', 'telegram']);
    });
  });
});
