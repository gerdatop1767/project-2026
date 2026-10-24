import { randomUUID } from 'node:crypto';
import { schema } from '@zybrilka/db';
import { createSeededTestDb } from '@zybrilka/db/testing';
import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

const SECRET = 'ya-client-secret-do-not-leak';

function cookieFrom(header: string | string[] | undefined, name: string) {
  const all = Array.isArray(header) ? header : header ? [header] : [];
  for (const raw of all) {
    const [pair] = raw.split(';');
    const i = pair!.indexOf('=');
    if (pair!.slice(0, i) === name) return { value: pair!.slice(i + 1), raw };
  }
  return undefined;
}

/** Yandex answers: token exchange, then /info. */
function yandexReplies(info: Record<string, unknown>, token = 'ya-access-token') {
  fetchMock.mockImplementation(async (url: string) => {
    if (url.startsWith('https://oauth.yandex.ru/token')) {
      return new Response(JSON.stringify({ access_token: token, token_type: 'bearer' }), {
        status: 200,
      });
    }
    if (url.startsWith('https://login.yandex.ru/info')) {
      return new Response(JSON.stringify(info), { status: 200 });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
}

describe('Yandex ID sign-in', () => {
  let testDb: Awaited<ReturnType<typeof createSeededTestDb>>;
  let app: ReturnType<typeof buildApp>;
  let unconfigured: ReturnType<typeof buildApp>;

  async function start(cookie?: string, link = false) {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/auth/yandex/start${link ? '?link=1' : ''}`,
      headers: cookie ? { cookie } : {},
    });
    return { res, oauth: cookieFrom(res.headers['set-cookie'], 'ya_oauth') };
  }

  async function callback(query: string, cookies: string[]) {
    return app.inject({
      method: 'GET',
      url: `/api/v1/auth/yandex/callback?${query}`,
      headers: { cookie: cookies.join('; ') },
    });
  }

  /** Full round trip: start → (user approves at Yandex) → callback. */
  async function signInWithYandex(info: Record<string, unknown>, session?: string, link = false) {
    const { res, oauth } = await start(session, link);
    const state = new URL(res.headers.location as string).searchParams.get('state')!;
    yandexReplies(info);
    const cookies = [`ya_oauth=${oauth!.value}`, ...(session ? [session] : [])];
    return callback(`code=auth-code-1&state=${state}`, cookies);
  }

  async function usersCount() {
    return (await testDb.db.select({ id: schema.users.id }).from(schema.users)).length;
  }

  async function signedIn() {
    const [user] = await testDb.db.insert(schema.users).values({}).returning();
    const id = randomUUID();
    await testDb.db
      .insert(schema.authSessions)
      .values({ id, userId: user!.id, expiresAt: new Date(Date.now() + 3_600_000) });
    return { userId: user!.id, cookie: `session_id=${id}` };
  }

  beforeAll(async () => {
    testDb = await createSeededTestDb();
    app = buildApp({
      version: 'test',
      db: testDb.db,
      authConfig: loadConfig({
        NODE_ENV: 'test',
        WEB_BASE_URL: 'https://zybrilka.test',
        YANDEX_CLIENT_ID: 'ya-client-id',
        YANDEX_CLIENT_SECRET: SECRET,
        YANDEX_REDIRECT_URI: 'https://zybrilka.test/api/v1/auth/yandex/callback',
      }),
    });
    unconfigured = buildApp({
      version: 'test',
      db: testDb.db,
      authConfig: loadConfig({ NODE_ENV: 'test', WEB_BASE_URL: 'https://zybrilka.test' }),
    });
  });

  afterEach(() => fetchMock.mockReset());

  afterAll(async () => {
    await app.close();
    await unconfigured.close();
    await testDb.close();
  });

  it('without credentials says «not configured» and leaves other sign-in untouched', async () => {
    const res = await unconfigured.inject({ method: 'GET', url: '/api/v1/auth/yandex/start' });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('https://zybrilka.test/login?yandex=not_configured');
    const me = await unconfigured.inject({ method: 'GET', url: '/api/v1/auth/me' });
    expect(me.json()).toEqual({ user: null });
  });

  it('start redirects to oauth.yandex.ru with state + PKCE, never the secret', async () => {
    const { res, oauth } = await start();
    expect(res.statusCode).toBe(302);
    const url = new URL(res.headers.location as string);
    expect(url.origin + url.pathname).toBe('https://oauth.yandex.ru/authorize');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      response_type: 'code',
      client_id: 'ya-client-id',
      redirect_uri: 'https://zybrilka.test/api/v1/auth/yandex/callback',
      code_challenge_method: 'S256',
    });
    expect(url.searchParams.get('state')).toMatch(/^[\w-]{16,}$/);
    expect(url.searchParams.get('code_challenge')).toMatch(/^[\w-]{43}$/);
    expect(res.headers.location).not.toContain(SECRET);
    expect(oauth!.raw).toMatch(/HttpOnly/i);
    expect(oauth!.raw).toMatch(/Path=\/api\/v1\/auth\/yandex/);
    expect(decodeURIComponent(oauth!.value)).not.toContain(SECRET);
  });

  it('signs a new user in: account + identity created, profile filled, session issued', async () => {
    const before = await usersCount();
    const res = await signInWithYandex({
      id: '1130000012345678',
      default_email: 'ivan.petrov@yandex.ru',
      first_name: 'Иван',
      last_name: 'Петров',
      default_avatar_id: '12345/abcdef-1',
      is_avatar_empty: false,
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('https://zybrilka.test/onboarding');
    const session = cookieFrom(res.headers['set-cookie'], 'session_id');
    expect(session?.raw).toMatch(/HttpOnly/i);
    expect(await usersCount()).toBe(before + 1);

    // The token exchange was server-to-server, with the secret and verifier.
    const [tokenUrl, tokenInit] = fetchMock.mock.calls[0]!;
    expect(tokenUrl).toBe('https://oauth.yandex.ru/token');
    const body = new URLSearchParams(tokenInit.body as URLSearchParams);
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('auth-code-1');
    expect(body.get('client_secret')).toBe(SECRET);
    expect(body.get('code_verifier')).toMatch(/^[\w-]{43}$/);
    expect(fetchMock.mock.calls[1]![1].headers.authorization).toBe('OAuth ya-access-token');

    const me = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: `session_id=${session!.value}` },
    });
    expect(me.json().user).toMatchObject({
      firstName: 'Иван',
      lastName: 'Петров',
      email: null,
      avatarUrl: 'https://avatars.yandex.net/get-yapic/12345/abcdef-1/islands-200',
    });
    expect(JSON.stringify(me.json())).not.toContain('ya-access-token');
  });

  it('signing in again returns the same account — no duplicate', async () => {
    const info = { id: '1130000099999999', first_name: 'Мария' };
    const first = await signInWithYandex(info);
    const firstSession = cookieFrom(first.headers['set-cookie'], 'session_id')!.value;
    const me1 = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: `session_id=${firstSession}` },
    });
    const count = await usersCount();

    const second = await signInWithYandex(info);
    const secondSession = cookieFrom(second.headers['set-cookie'], 'session_id')!.value;
    const me2 = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: `session_id=${secondSession}` },
    });
    expect(me2.json().user.id).toBe(me1.json().user.id);
    expect(await usersCount()).toBe(count);
    const identities = await testDb.db
      .select()
      .from(schema.authIdentities)
      .where(
        and(
          eq(schema.authIdentities.provider, 'yandex'),
          eq(schema.authIdentities.providerUserId, '1130000099999999'),
        ),
      );
    expect(identities).toHaveLength(1);
  });

  it('rejects a missing or wrong state before talking to Yandex', async () => {
    const { res, oauth } = await start();
    const state = new URL(res.headers.location as string).searchParams.get('state')!;

    const noCookie = await callback(`code=c&state=${state}`, []);
    const wrongState = await callback(`code=c&state=forged-state-123456`, [
      `ya_oauth=${oauth!.value}`,
    ]);
    const noState = await callback(`code=c`, [`ya_oauth=${oauth!.value}`]);
    for (const r of [noCookie, wrongState, noState]) {
      expect(r.statusCode).toBe(302);
      expect(r.headers.location).toBe('https://zybrilka.test/login?yandex=invalid_state');
      expect(cookieFrom(r.headers['set-cookie'], 'session_id')).toBeUndefined();
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('handles the user cancelling and a provider error', async () => {
    const a = await start();
    const stateA = new URL(a.res.headers.location as string).searchParams.get('state')!;
    const cancelled = await callback(`error=access_denied&state=${stateA}`, [
      `ya_oauth=${a.oauth!.value}`,
    ]);
    expect(cancelled.headers.location).toBe('https://zybrilka.test/login?yandex=cancelled');

    const b = await start();
    const stateB = new URL(b.res.headers.location as string).searchParams.get('state')!;
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }),
    );
    const failed = await callback(`code=expired-code&state=${stateB}`, [
      `ya_oauth=${b.oauth!.value}`,
    ]);
    expect(failed.headers.location).toBe('https://zybrilka.test/login?yandex=error');
    expect(cookieFrom(failed.headers['set-cookie'], 'session_id')).toBeUndefined();

    const c = await start();
    const stateC = new URL(c.res.headers.location as string).searchParams.get('state')!;
    fetchMock.mockRejectedValue(Object.assign(new Error('t'), { name: 'TimeoutError' }));
    const timeout = await callback(`code=c&state=${stateC}`, [`ya_oauth=${c.oauth!.value}`]);
    expect(timeout.headers.location).toBe('https://zybrilka.test/login?yandex=error');
  });

  it('never uses the Yandex email: an existing email account is neither taken over nor merged', async () => {
    const [owner] = await testDb.db.insert(schema.users).values({}).returning();
    await testDb.db
      .insert(schema.authIdentities)
      .values({ userId: owner!.id, provider: 'email', providerUserId: 'shared@yandex.ru' });
    const before = await usersCount();

    const res = await signInWithYandex({
      id: '1130000055555555',
      default_email: 'Shared@Yandex.ru',
    });
    const session = cookieFrom(res.headers['set-cookie'], 'session_id')!.value;
    const who = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: `session_id=${session}` },
    });
    // A separate, new account — the existing one is untouched.
    expect(who.json().user.id).not.toBe(owner!.id);
    expect(who.json().user.email).toBeNull();
    expect(await usersCount()).toBe(before + 1);
    const ownerIdentities = await testDb.db
      .select()
      .from(schema.authIdentities)
      .where(eq(schema.authIdentities.userId, owner!.id));
    expect(ownerIdentities.map((i) => i.provider)).toEqual(['email']);
  });

  it('connects Yandex to a signed-in account (with its progress and XP) and signs back into it', async () => {
    const me = await signedIn();
    // Some real history on the account.
    const [task] = await testDb.db
      .select({ id: schema.tasks.id, answer: schema.tasks.correctAnswer })
      .from(schema.tasks)
      .where(eq(schema.tasks.answerType, 'short_answer'))
      .limit(1);
    const attempt = await app.inject({
      method: 'POST',
      url: `/api/v1/tasks/${task!.id}/attempt`,
      headers: { cookie: me.cookie },
      payload: { answer: task!.answer },
    });
    const xpBefore = attempt.json().xp.totalXp as number;
    expect(xpBefore).toBeGreaterThan(0);

    const linked = await signInWithYandex({ id: '1130000077777777' }, me.cookie, true);
    expect(linked.headers.location).toBe('https://zybrilka.test/profile?link=ok&provider=yandex');
    expect(cookieFrom(linked.headers['set-cookie'], 'session_id')).toBeUndefined();

    // Later: a fresh browser signs in with Yandex → the SAME account.
    const login = await signInWithYandex({ id: '1130000077777777' });
    const session = cookieFrom(login.headers['set-cookie'], 'session_id')!.value;
    expect(login.headers.location).toBe('https://zybrilka.test/onboarding');
    const who = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: `session_id=${session}` },
    });
    expect(who.json().user.id).toBe(me.userId);
    const xp = await app.inject({
      method: 'GET',
      url: '/api/v1/progress/xp',
      headers: { cookie: `session_id=${session}` },
    });
    expect(xp.json().totalXp).toBe(xpBefore);
  });

  it('refuses to connect a Yandex account that belongs to someone else', async () => {
    await signInWithYandex({ id: '1130000088888888' });
    const other = await signedIn();
    const res = await signInWithYandex({ id: '1130000088888888' }, other.cookie, true);
    expect(res.headers.location).toBe('https://zybrilka.test/profile?link=taken&provider=yandex');
    const rows = await testDb.db
      .select()
      .from(schema.authIdentities)
      .where(eq(schema.authIdentities.userId, other.userId));
    expect(rows).toHaveLength(0);
  });

  it('connecting requires a session', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/auth/yandex/start?link=1' });
    expect(res.statusCode).toBe(401);
  });

  describe('from the Telegram Mini App (external browser + handoff)', () => {
    /** Mini App asks for a start link; returns its claim cookie and the link. */
    async function miniAppHandoff() {
      const res = await app.inject({ method: 'POST', url: '/api/v1/auth/yandex/handoff' });
      expect(res.statusCode).toBe(200);
      const claim = cookieFrom(res.headers['set-cookie'], 'ya_handoff')!;
      expect(claim.raw).toMatch(/HttpOnly/i);
      expect(claim.raw).toMatch(/Path=\/api\/v1\/auth\/yandex\/handoff/);
      const startUrl = new URL(res.json().startUrl as string);
      expect(startUrl.pathname).toBe('/api/v1/auth/yandex/start');
      return {
        claimCookie: `ya_handoff=${claim.value}`,
        startPath: startUrl.pathname + startUrl.search,
      };
    }
    const claim = (cookie: string) =>
      app.inject({ method: 'POST', url: '/api/v1/auth/yandex/handoff/claim', headers: { cookie } });

    /** The external browser: start → Yandex → callback. */
    async function browserFlow(
      startPath: string,
      answer: 'ok' | 'cancel',
      info = { id: '1130000044444444' },
    ) {
      const start = await app.inject({ method: 'GET', url: startPath });
      const oauth = cookieFrom(start.headers['set-cookie'], 'ya_oauth')!;
      const state = new URL(start.headers.location as string).searchParams.get('state')!;
      if (answer === 'cancel') {
        return callback(`error=access_denied&state=${state}`, [`ya_oauth=${oauth.value}`]);
      }
      yandexReplies(info);
      return callback(`code=c&state=${state}`, [`ya_oauth=${oauth.value}`]);
    }

    it('signs the Mini App in: the browser keeps no session, the Mini App claims its own once', async () => {
      const { claimCookie, startPath } = await miniAppHandoff();
      expect((await claim(claimCookie)).json()).toEqual({ status: 'pending', started: false });

      const done = await browserFlow(startPath, 'ok');
      expect(done.headers.location).toBe(
        'https://zybrilka.test/telegram-return?status=ok&provider=yandex',
      );
      expect(cookieFrom(done.headers['set-cookie'], 'session_id')).toBeUndefined();

      const claimed = await claim(claimCookie);
      expect(claimed.json()).toMatchObject({ status: 'ok', user: { id: expect.any(String) } });
      const session = cookieFrom(claimed.headers['set-cookie'], 'session_id')!.value;
      const who = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: { cookie: `session_id=${session}` },
      });
      expect(who.json().user.id).toBe(claimed.json().user.id);
      // Exactly once.
      expect((await claim(claimCookie)).json()).toEqual({ status: 'expired' });
    });

    it('a cancelled Yandex screen is reported back to the Mini App', async () => {
      const { claimCookie, startPath } = await miniAppHandoff();
      const res = await browserFlow(startPath, 'cancel');
      expect(res.headers.location).toBe(
        'https://zybrilka.test/telegram-return?status=cancelled&provider=yandex',
      );
      expect((await claim(claimCookie)).json()).toEqual({ status: 'cancelled' });
    });

    it('a start link works once; a reused one says «expired»', async () => {
      const { startPath } = await miniAppHandoff();
      await app.inject({ method: 'GET', url: startPath });
      const again = await app.inject({ method: 'GET', url: startPath });
      expect(again.headers.location).toBe(
        'https://zybrilka.test/telegram-return?status=expired&provider=yandex',
      );
    });

    it('answers 503 when Yandex ID is not configured', async () => {
      const res = await unconfigured.inject({ method: 'POST', url: '/api/v1/auth/yandex/handoff' });
      expect(res.statusCode).toBe(503);
      expect(res.json()).toEqual({ error: 'yandex_not_configured' });
    });
  });
});
