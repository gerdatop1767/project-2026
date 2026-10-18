import { schema } from '@zybrilka/db';
import { createSeededTestDb } from '@zybrilka/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import * as repo from './repo.js';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

function jsonResponse(body: unknown, ok = true) {
  return { ok, status: ok ? 200 : 500, json: async () => body, text: async () => '' };
}

/** Routes the mocked `fetch` by URL: VK's token endpoint vs user_info. */
function mockVk(opts: {
  userId: number;
  profile?: unknown; // body of user_info; `undefined` => user_info fails
}) {
  fetchMock.mockImplementation(async (url: string) => {
    if (url === 'https://id.vk.ru/oauth2/auth') {
      return jsonResponse({ user_id: opts.userId, access_token: 'tok-' + opts.userId });
    }
    if (url === 'https://id.vk.ru/oauth2/user_info') {
      if (opts.profile === undefined) return jsonResponse({}, false);
      return jsonResponse(opts.profile);
    }
    throw new Error(`unexpected fetch ${url}`);
  });
}

function cookieValue(header: string | string[] | undefined, name: string): string | undefined {
  const headers = Array.isArray(header) ? header : header ? [header] : [];
  for (const raw of headers) {
    const [pair] = raw.split(';');
    const [key, value] = pair!.split('=');
    if (key === name) return value;
  }
  return undefined;
}

describe('VK profile data, onboarding routing, private API and logout', () => {
  let testDb: Awaited<ReturnType<typeof createSeededTestDb>>;
  let app: ReturnType<typeof buildApp>;

  beforeAll(async () => {
    testDb = await createSeededTestDb();
    app = buildApp({
      version: 'test',
      db: testDb.db,
      authConfig: loadConfig({
        NODE_ENV: 'test',
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

  /** Full /vk/start -> /vk/callback round trip; returns the callback response. */
  async function vkLogin() {
    const start = await app.inject({ method: 'GET', url: '/api/v1/auth/vk/start' });
    const state = new URL(start.headers.location as string).searchParams.get('state');
    const pkce = cookieValue(start.headers['set-cookie'], 'vk_pkce')!;
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/auth/vk/callback?code=c&device_id=d&state=${state}`,
      headers: { cookie: `vk_pkce=${pkce}` },
    });
    return {
      res,
      sessionId: cookieValue(res.headers['set-cookie'], 'session_id')!,
    };
  }

  async function me(sessionId: string) {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: `session_id=${sessionId}` },
    });
    return res.json().user;
  }

  async function finishOnboarding(sessionId: string) {
    return app.inject({
      method: 'PUT',
      url: '/api/v1/me/learning-profile',
      headers: { cookie: `session_id=${sessionId}` },
      payload: {
        subjects: [{ subjectId: 'math', selfReportedScore: '60_plus', targetScore: '80_plus' }],
      },
    });
  }

  const countUsersWithVk = async (vkId: string) =>
    (
      await testDb.db
        .select()
        .from(schema.authIdentities)
        .where(eq(schema.authIdentities.providerUserId, vkId))
    ).length;

  describe('first sign-in vs returning sign-in', () => {
    it('first VK login creates exactly one account, saves name + avatar, and lands on onboarding', async () => {
      mockVk({
        userId: 1001,
        profile: {
          user: {
            user_id: '1001',
            first_name: 'Иван',
            last_name: 'Петров',
            avatar: 'https://sun9.userapi.com/a.jpg',
          },
        },
      });
      const { res, sessionId } = await vkLogin();

      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe('http://localhost:5173/onboarding');
      expect(await countUsersWithVk('1001')).toBe(1);
      expect(await me(sessionId)).toMatchObject({
        firstName: 'Иван',
        lastName: 'Петров',
        avatarUrl: 'https://sun9.userapi.com/a.jpg',
        onboardingCompleted: false,
      });
      // user_info is called with the token VK itself issued for this
      // code (server-to-server), plus the client id.
      const infoCall = fetchMock.mock.calls.find(
        ([u]) => u === 'https://id.vk.ru/oauth2/user_info',
      )!;
      const sent = new URLSearchParams(infoCall[1].body as string);
      expect(sent.get('access_token')).toBe('tok-1001');
      expect(sent.get('client_id')).toBe('vk-client');
    });

    it('a returning user with completed onboarding goes straight to the main menu, on the SAME account', async () => {
      mockVk({ userId: 1002, profile: { user: { first_name: 'Анна', last_name: 'Ким' } } });
      const first = await vkLogin();
      const userId = (await me(first.sessionId)).id;
      expect((await finishOnboarding(first.sessionId)).statusCode).toBe(200);

      const second = await vkLogin();
      expect(second.res.headers.location).toBe('http://localhost:5173');
      const user = await me(second.sessionId);
      expect(user.id).toBe(userId);
      expect(user.onboardingCompleted).toBe(true);
      expect(await countUsersWithVk('1002')).toBe(1);
      // Their saved subjects/answers are still there.
      const profile = await app.inject({
        method: 'GET',
        url: '/api/v1/me/learning-profile',
        headers: { cookie: `session_id=${second.sessionId}` },
      });
      expect(profile.json().subjects).toEqual([
        { subjectId: 'math', selfReportedScore: '60_plus', targetScore: '80_plus' },
      ]);
    });

    it('an existing user whose onboarding was never finished is sent back to onboarding (resumes), not to the menu', async () => {
      mockVk({ userId: 1003, profile: { user: { first_name: 'Олег' } } });
      await vkLogin();
      const again = await vkLogin();
      expect(again.res.headers.location).toBe('http://localhost:5173/onboarding');
      expect(await countUsersWithVk('1003')).toBe(1);
    });

    it('does not trust anything the browser sends: extra query params cannot mark a user as new/onboarded', async () => {
      mockVk({ userId: 1004, profile: { user: { first_name: 'Мария' } } });
      const start = await app.inject({ method: 'GET', url: '/api/v1/auth/vk/start' });
      const state = new URL(start.headers.location as string).searchParams.get('state');
      const pkce = cookieValue(start.headers['set-cookie'], 'vk_pkce')!;
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/auth/vk/callback?code=c&device_id=d&state=${state}&first_name=Hacker&user_id=1&onboarding_completed=true&is_new=false`,
        headers: { cookie: `vk_pkce=${pkce}` },
      });
      const sessionId = cookieValue(res.headers['set-cookie'], 'session_id')!;
      expect(res.headers.location).toBe('http://localhost:5173/onboarding');
      expect(await me(sessionId)).toMatchObject({ firstName: 'Мария', onboardingCompleted: false });
    });
  });

  describe('where the browser lands after VK (never an arbitrary or internal page)', () => {
    const WEB = 'http://localhost:5173';

    /** /vk/start then /vk/callback with extra raw query text appended. */
    async function callbackWith(extraQuery: string, startQuery = '', cookieHeader = '') {
      const start = await app.inject({
        method: 'GET',
        url: `/api/v1/auth/vk/start${startQuery}`,
        headers: cookieHeader ? { cookie: cookieHeader } : {},
      });
      const state = new URL(start.headers.location as string).searchParams.get('state');
      const pkce = cookieValue(start.headers['set-cookie'], 'vk_pkce')!;
      return app.inject({
        method: 'GET',
        url: `/api/v1/auth/vk/callback?code=c&device_id=d&state=${state}${extraQuery}`,
        headers: { cookie: `vk_pkce=${pkce}` },
      });
    }

    it('ignores every redirect-style parameter: the target is only ever the configured site root or /onboarding', async () => {
      const hostile =
        '&returnTo=https://evil.example/phish&return_to=//evil.example&next=/help&redirect=/help' +
        '&redirect_uri=https://evil.example&url=https://evil.example&continue=/help&to=/help';

      // Brand-new account -> onboarding.
      mockVk({ userId: 3101, profile: { user: { first_name: 'Нина' } } });
      const fresh = await callbackWith(hostile);
      expect(fresh.statusCode).toBe(302);
      expect(fresh.headers.location).toBe(`${WEB}/onboarding`);

      // Returning account that finished onboarding -> the site root (the main menu).
      const first = await vkLogin();
      await finishOnboarding(first.sessionId);
      mockVk({ userId: 3101, profile: { user: { first_name: 'Нина' } } });
      const returning = await callbackWith(hostile);
      expect(returning.statusCode).toBe(302);
      expect(returning.headers.location).toBe(WEB);
      for (const location of [fresh.headers.location, returning.headers.location]) {
        expect(String(location)).not.toMatch(/evil|help/);
      }
    });

    it('a cancelled/denied VK consent returns to the sign-in page with a notice flag, signs nobody in and never calls VK', async () => {
      const start = await app.inject({ method: 'GET', url: '/api/v1/auth/vk/start' });
      const state = new URL(start.headers.location as string).searchParams.get('state');
      const pkce = cookieValue(start.headers['set-cookie'], 'vk_pkce')!;
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/auth/vk/callback?error=access_denied&error_description=User+denied&state=${state}`,
        headers: { cookie: `vk_pkce=${pkce}` },
      });
      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe(`${WEB}/login?vk=cancelled`);
      expect(cookieValue(res.headers['set-cookie'], 'session_id')).toBeUndefined();
      // The single-use PKCE cookie is expired on this outcome too.
      expect(String(res.headers['set-cookie'])).toMatch(/vk_pkce=;/);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('a cancelled consent without the PKCE cookie (expired/other browser) still lands on sign-in, not on a raw JSON error', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/vk/callback?error=access_denied&state=whatever',
      });
      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe(`${WEB}/login?vk=cancelled`);
    });

    it('the error text VK sends is never echoed into the redirect', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/vk/callback?error=%3Cscript%3Ealert(1)%3C/script%3E&error_description=https://evil.example',
      });
      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe(`${WEB}/login?vk=cancelled`);
    });

    it('cancelling while ADDING VK from the profile goes back to the profile, not to sign-in', async () => {
      mockVk({ userId: 3102, profile: { user: { first_name: 'Лев' } } });
      const { sessionId } = await vkLogin();
      const start = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/vk/start?link=1',
        headers: { cookie: `session_id=${sessionId}` },
      });
      const pkce = cookieValue(start.headers['set-cookie'], 'vk_pkce')!;
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/vk/callback?error=access_denied&state=x',
        headers: { cookie: `vk_pkce=${pkce}; session_id=${sessionId}` },
      });
      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe(`${WEB}/profile?link=error&provider=vk`);
    });

    it('a callback that is neither a success nor a cancel (no code, no error) is still rejected as before', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/vk/callback?state=x',
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'invalid_callback' });
    });
  });

  describe('missing / partial VK data', () => {
    it('login still succeeds with no profile at all (user_info fails) and the fields are null', async () => {
      mockVk({ userId: 1010 /* profile undefined => user_info 500 */ });
      const { res, sessionId } = await vkLogin();
      expect(res.statusCode).toBe(302);
      expect(await me(sessionId)).toMatchObject({
        firstName: null,
        lastName: null,
        avatarUrl: null,
      });
    });

    it('login succeeds when user_info throws or returns garbage', async () => {
      fetchMock.mockImplementation(async (url: string) => {
        if (url === 'https://id.vk.ru/oauth2/auth') {
          return jsonResponse({ user_id: 1011, access_token: 't' });
        }
        throw new Error('network down');
      });
      const { res } = await vkLogin();
      expect(res.statusCode).toBe(302);

      mockVk({ userId: 1012, profile: 'not-an-object' });
      expect((await vkLogin()).res.statusCode).toBe(302);
    });

    it('a later login where VK omits/blanks fields never overwrites stored values with empties', async () => {
      mockVk({
        userId: 1013,
        profile: {
          user: {
            first_name: 'Пётр',
            last_name: 'Сидоров',
            avatar: 'https://sun9.userapi.com/p.jpg',
          },
        },
      });
      const first = await vkLogin();
      const userId = (await me(first.sessionId)).id;

      mockVk({ userId: 1013, profile: { user: { first_name: '  ', last_name: null } } });
      const second = await vkLogin();
      expect(await me(second.sessionId)).toMatchObject({
        id: userId,
        firstName: 'Пётр',
        lastName: 'Сидоров',
        avatarUrl: 'https://sun9.userapi.com/p.jpg',
      });

      // A real change from VK does update.
      mockVk({ userId: 1013, profile: { user: { first_name: 'Петя' } } });
      const third = await vkLogin();
      expect(await me(third.sessionId)).toMatchObject({ firstName: 'Петя', lastName: 'Сидоров' });
    });

    it('a profile refresh leaves the learning profile (onboarding, subjects) untouched', async () => {
      mockVk({ userId: 1014, profile: { user: { first_name: 'Лена' } } });
      const first = await vkLogin();
      await finishOnboarding(first.sessionId);
      mockVk({ userId: 1014, profile: { user: { first_name: 'Елена' } } });
      const second = await vkLogin();
      expect(await me(second.sessionId)).toMatchObject({
        firstName: 'Елена',
        onboardingCompleted: true,
      });
    });

    it('drops non-https / javascript: / oversized avatar URLs instead of storing them', async () => {
      for (const [i, avatar] of [
        'http://insecure.example/a.jpg',
        'javascript:alert(1)',
        'data:image/png;base64,AAAA',
        'https://x.example/' + 'a'.repeat(1100),
        42,
      ].entries()) {
        mockVk({ userId: 1020 + i, profile: { user: { first_name: 'Т', avatar } } });
        const { sessionId } = await vkLogin();
        expect((await me(sessionId)).avatarUrl).toBeNull();
      }
    });
  });

  describe('no duplicate accounts', () => {
    it('concurrent first sign-ins for one identity resolve to one account and leave no orphan user row', async () => {
      const usersBefore = (await testDb.db.select().from(schema.users)).length;
      const results = await Promise.all(
        Array.from({ length: 5 }, () => repo.findOrCreateUserByIdentity(testDb.db, 'vk', '2001')),
      );
      expect(new Set(results.map((r) => r.userId)).size).toBe(1);
      expect(results.filter((r) => r.created)).toHaveLength(1);
      expect(await countUsersWithVk('2001')).toBe(1);
      expect((await testDb.db.select().from(schema.users)).length).toBe(usersBefore + 1);
    });

    it('replaying the same OAuth callback does not create a second account or reuse the PKCE state', async () => {
      mockVk({ userId: 2002, profile: { user: { first_name: 'Ж' } } });
      const start = await app.inject({ method: 'GET', url: '/api/v1/auth/vk/start' });
      const state = new URL(start.headers.location as string).searchParams.get('state');
      const pkce = cookieValue(start.headers['set-cookie'], 'vk_pkce')!;
      const url = `/api/v1/auth/vk/callback?code=c&device_id=d&state=${state}`;
      const ok = await app.inject({ method: 'GET', url, headers: { cookie: `vk_pkce=${pkce}` } });
      expect(ok.statusCode).toBe(302);
      // The browser would have dropped the cleared cookie; a replay
      // without it is rejected, and with it still creates nothing new.
      const replayNoCookie = await app.inject({ method: 'GET', url });
      expect(replayNoCookie.statusCode).toBe(400);
      const replayWithCookie = await app.inject({
        method: 'GET',
        url,
        headers: { cookie: `vk_pkce=${pkce}` },
      });
      expect(replayWithCookie.statusCode).toBe(302);
      expect(await countUsersWithVk('2002')).toBe(1);
    });
  });

  describe('private API is closed to unauthenticated callers', () => {
    const privateUrls = [
      '/api/v1/tasks?subject=math',
      '/api/v1/tasks/counts',
      '/api/v1/progress/summary',
      '/api/v1/me/learning-profile',
      '/api/v1/mistakes',
    ];

    it.each(privateUrls)('GET %s answers 401 without a session', async (url) => {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ error: 'unauthorized' });
    });

    it('a forged x-anon-id header does not authenticate and does not create a user', async () => {
      const id = '7f0c1d5e-3b2a-4c6d-8e9f-0a1b2c3d4e5f';
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/progress/summary',
        headers: { 'x-anon-id': id },
      });
      expect(res.statusCode).toBe(401);
      const rows = await testDb.db.select().from(schema.users).where(eq(schema.users.id, id));
      expect(rows).toHaveLength(0);
    });

    it('a made-up or malformed session cookie does not authenticate', async () => {
      for (const cookie of [
        'session_id=00000000-0000-4000-8000-000000000000',
        'session_id=garbage',
      ]) {
        const res = await app.inject({
          method: 'GET',
          url: '/api/v1/progress/summary',
          headers: { cookie },
        });
        expect(res.statusCode).toBe(401);
      }
    });

    it('stays reachable: /health and the auth endpoints (/auth/me, /auth/vk/start, callback)', async () => {
      expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
      expect((await app.inject({ method: 'GET', url: '/api/v1/auth/me' })).statusCode).toBe(200);
      expect((await app.inject({ method: 'GET', url: '/api/v1/auth/vk/start' })).statusCode).toBe(
        302,
      );
      expect(
        (await app.inject({ method: 'GET', url: '/api/v1/auth/vk/callback' })).statusCode,
      ).toBe(400);
    });

    it('a valid session reaches the private API as that user', async () => {
      mockVk({ userId: 3001, profile: { user: { first_name: 'Ы' } } });
      const { sessionId } = await vkLogin();
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/progress/summary',
        headers: { cookie: `session_id=${sessionId}` },
      });
      expect(res.statusCode).toBe(200);
    });
  });

  describe('logout', () => {
    it('invalidates the server session, expires the cookie with Path=/, and locks the private API again', async () => {
      mockVk({ userId: 4001, profile: { user: { first_name: 'Л' } } });
      const { sessionId } = await vkLogin();
      const cookie = `session_id=${sessionId}`;
      const priv = () =>
        app.inject({ method: 'GET', url: '/api/v1/progress/summary', headers: { cookie } });
      expect((await priv()).statusCode).toBe(200);

      const out = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/logout',
        headers: { cookie },
      });
      expect(out.statusCode).toBe(204);
      const setCookie = ([] as string[]).concat(out.headers['set-cookie'] ?? []).join('\n');
      expect(setCookie).toMatch(/session_id=;/);
      expect(setCookie).toMatch(/Path=\//i);
      expect(setCookie).toMatch(/Expires=Thu, 01 Jan 1970/i);
      expect(setCookie).toMatch(/HttpOnly/i);

      // The row is really gone — replaying the OLD cookie value fails.
      const rows = await testDb.db
        .select()
        .from(schema.authSessions)
        .where(eq(schema.authSessions.id, sessionId));
      expect(rows).toHaveLength(0);
      expect((await priv()).statusCode).toBe(401);
      expect(
        (await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie } })).json(),
      ).toEqual({ user: null });
    });

    it('signing in again with VK after logout works and yields the same account', async () => {
      mockVk({ userId: 4002, profile: { user: { first_name: 'Р' } } });
      const first = await vkLogin();
      const id = (await me(first.sessionId)).id;
      await app.inject({
        method: 'POST',
        url: '/api/v1/auth/logout',
        headers: { cookie: `session_id=${first.sessionId}` },
      });
      const second = await vkLogin();
      expect(second.sessionId).not.toBe(first.sessionId);
      expect((await me(second.sessionId)).id).toBe(id);
    });

    it('an expired session behaves as signed out and /auth/me clears the stale cookie', async () => {
      mockVk({ userId: 4003, profile: { user: { first_name: 'Э' } } });
      const { sessionId } = await vkLogin();
      await testDb.db
        .update(schema.authSessions)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(schema.authSessions.id, sessionId));
      const cookie = `session_id=${sessionId}`;
      const meRes = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: { cookie },
      });
      expect(meRes.json()).toEqual({ user: null });
      expect(String(meRes.headers['set-cookie'])).toMatch(/session_id=;/);
      expect(
        (
          await app.inject({
            method: 'GET',
            url: '/api/v1/progress/summary',
            headers: { cookie },
          })
        ).statusCode,
      ).toBe(401);
    });
  });
});
