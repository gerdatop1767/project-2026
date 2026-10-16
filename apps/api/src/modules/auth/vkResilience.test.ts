import { Writable } from 'node:stream';
import { createSeededTestDb } from '@zybrilka/db/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { exchangeVkCode, fetchVkProfile, VkRequestError } from './vk.js';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

const SECRET = 'super-secret-client-value';
const ACCESS_TOKEN = 'access-token-value-xyz';
const CODE = 'authorization-code-abc';

const baseEnv = {
  NODE_ENV: 'test',
  VK_CLIENT_ID: 'vk-client',
  VK_CLIENT_SECRET: SECRET,
  VK_REDIRECT_URI: 'http://localhost:5173/api/v1/auth/vk/callback',
  VK_REQUEST_TIMEOUT_MS: '150',
} as const;

function jsonResponse(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body, text: async () => 'RAW-BODY' };
}

/** A fetch that never answers on its own but, like the real one, rejects
 * when the caller's AbortSignal fires. */
function hangUntilAborted(_url: string, init?: { signal?: AbortSignal }) {
  return new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
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

describe('VK server-to-server calls: timeouts, safe logging, PKCE cookie handling', () => {
  let testDb: Awaited<ReturnType<typeof createSeededTestDb>>;
  let logLines: string[];
  let app: ReturnType<typeof buildApp>;
  const config = loadConfig(baseEnv);

  beforeAll(async () => {
    testDb = await createSeededTestDb();
    logLines = [];
    app = buildApp({
      version: 'test',
      db: testDb.db,
      authConfig: config,
      logger: {
        level: 'warn',
        stream: new Writable({
          write(chunk, _enc, done) {
            logLines.push(String(chunk));
            done();
          },
        }),
      },
    });
  });
  afterEach(() => {
    fetchMock.mockReset();
    logLines.length = 0;
  });
  afterAll(async () => {
    await app.close();
    await testDb.close();
  });

  async function start() {
    const res = await app.inject({ method: 'GET', url: '/api/v1/auth/vk/start' });
    return {
      state: new URL(res.headers.location as string).searchParams.get('state')!,
      pkce: cookieValue(res.headers['set-cookie'], 'vk_pkce')!,
    };
  }
  async function callback(pkce: string, state: string) {
    return app.inject({
      method: 'GET',
      url: `/api/v1/auth/vk/callback?code=${CODE}&device_id=dev&state=${state}`,
      headers: { cookie: `vk_pkce=${pkce}` },
    });
  }
  const logged = () => logLines.join('');

  describe('timeouts', () => {
    it('exchangeVkCode rejects with a "timeout" VkRequestError instead of hanging', async () => {
      fetchMock.mockImplementation(hangUntilAborted);
      const started = Date.now();
      await expect(exchangeVkCode(config, 'c', 'd', 'v')).rejects.toMatchObject({
        name: 'VkRequestError',
        kind: 'timeout',
      });
      expect(Date.now() - started).toBeLessThan(2000);
    });

    it('passes an AbortSignal to every VK request', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ user_id: 1, access_token: 't' }));
      await exchangeVkCode(config, 'c', 'd', 'v');
      expect(fetchMock.mock.calls[0]![1].signal).toBeInstanceOf(AbortSignal);
    });

    it('a stalled token exchange ends the OAuth callback with 504 vk_timeout and no session', async () => {
      fetchMock.mockImplementation(hangUntilAborted);
      const { state, pkce } = await start();
      const started = Date.now();
      const res = await callback(pkce, state);
      expect(Date.now() - started).toBeLessThan(2500);
      expect(res.statusCode).toBe(504);
      expect(res.json()).toEqual({ error: 'vk_timeout' });
      expect(cookieValue(res.headers['set-cookie'], 'session_id')).toBeUndefined();
      expect(logged()).toContain('"vkLogin":"timeout"');
    });

    it('a stalled profile lookup does NOT block sign-in: 302 with a session, profile left empty', async () => {
      fetchMock.mockImplementation(async (url: string, init: { signal?: AbortSignal }) =>
        url.endsWith('/oauth2/auth')
          ? jsonResponse({ user_id: 7001, access_token: ACCESS_TOKEN })
          : hangUntilAborted(url, init),
      );
      const { state, pkce } = await start();
      const started = Date.now();
      const res = await callback(pkce, state);
      expect(Date.now() - started).toBeLessThan(2500);
      expect(res.statusCode).toBe(302);
      const sessionId = cookieValue(res.headers['set-cookie'], 'session_id')!;
      expect(sessionId).toBeTruthy();
      const me = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: { cookie: `session_id=${sessionId}` },
      });
      expect(me.json().user).toMatchObject({ firstName: null, lastName: null, avatarUrl: null });
      expect(logged()).toContain('"vkProfile":"timeout"');
    });

    it('config bounds the timeout (rejects nonsense values, defaults to 5 s)', () => {
      expect(loadConfig({ NODE_ENV: 'test' }).VK_REQUEST_TIMEOUT_MS).toBe(5000);
      expect(() => loadConfig({ NODE_ENV: 'test', VK_REQUEST_TIMEOUT_MS: '5' })).toThrow();
      expect(() => loadConfig({ NODE_ENV: 'test', VK_REQUEST_TIMEOUT_MS: '999999' })).toThrow();
    });
  });

  describe('token exchange failures', () => {
    it('HTTP error: 502, logs status + VK error CODE only (never the description/body)', async () => {
      fetchMock.mockResolvedValue({
        ...jsonResponse({ error: 'invalid_grant', error_description: 'LEAKY-DESCRIPTION' }, 400),
      });
      const { state, pkce } = await start();
      const res = await callback(pkce, state);
      expect(res.statusCode).toBe(502);
      expect(res.json()).toEqual({ error: 'vk_login_failed' });
      expect(logged()).toContain('"status":400');
      expect(logged()).toContain('"vkError":"invalid_grant"');
      expect(logged()).not.toContain('LEAKY-DESCRIPTION');
      expect(logged()).not.toContain('RAW-BODY');
    });

    it('a free-text / hostile "error" value is not logged as a code', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ error: 'user@example.com has token abc!' }, 400));
      await expect(exchangeVkCode(config, 'c', 'd', 'v')).rejects.toMatchObject({
        kind: 'http',
        status: 400,
        vkError: undefined,
      });
    });

    it.each([
      [
        'a body that is not JSON',
        { ok: true, status: 200, json: async () => JSON.parse('<html>') },
      ],
      ['JSON without user_id', jsonResponse({ access_token: 'x' })],
      ['a JSON array', jsonResponse([1, 2])],
    ])('%s -> 502 invalid response, no session', async (_name, response) => {
      fetchMock.mockResolvedValue(response);
      const { state, pkce } = await start();
      const res = await callback(pkce, state);
      expect(res.statusCode).toBe(502);
      expect(cookieValue(res.headers['set-cookie'], 'session_id')).toBeUndefined();
    });

    it('a network failure is a 502 and the error text (which could name the target) is not echoed to the client', async () => {
      fetchMock.mockRejectedValue(new TypeError('fetch failed: getaddrinfo ENOTFOUND id.vk.ru'));
      const { state, pkce } = await start();
      const res = await callback(pkce, state);
      expect(res.statusCode).toBe(502);
      expect(res.json()).toEqual({ error: 'vk_login_failed' });
      expect(logged()).toContain('"vkLogin":"network"');
    });
  });

  describe('profile lookup logging (never blocks sign-in, never leaks)', () => {
    const profileLog = async (userInfo: () => unknown) => {
      fetchMock.mockImplementation(async (url: string) =>
        url.endsWith('/oauth2/auth')
          ? jsonResponse({
              user_id: 7100 + Math.floor(Math.random() * 1e6),
              access_token: ACCESS_TOKEN,
            })
          : userInfo(),
      );
      const { state, pkce } = await start();
      const res = await callback(pkce, state);
      expect(res.statusCode).toBe(302); // sign-in itself always succeeds
      return logged();
    };

    it('user_info HTTP 500 -> warning with the status only', async () => {
      const out = await profileLog(() =>
        jsonResponse({ error: 'server_error', detail: 'DETAIL' }, 500),
      );
      expect(out).toContain('"vkProfile":"http"');
      expect(out).toContain('"status":500');
      expect(out).not.toContain('DETAIL');
    });

    it('200 without a user object -> warning naming the top-level KEYS, not values', async () => {
      const out = await profileLog(() => jsonResponse({ response: { first_name: 'SECRET-NAME' } }));
      expect(out).toContain('"vkProfile":"invalid_response"');
      expect(out).toContain('"topLevelKeys":["response"]');
      expect(out).not.toContain('SECRET-NAME');
    });

    it('200 with a user whose fields use unexpected names -> warning listing key names (spots a wrong response shape)', async () => {
      const out = await profileLog(() =>
        jsonResponse({
          user: { name: 'PERSONAL-NAME', picture: 'https://pic.example/PERSONAL.jpg' },
        }),
      );
      expect(out).toContain('"vkProfile":"no_usable_fields"');
      expect(out).toContain('"userKeys":["name","picture"]');
      expect(out).not.toContain('PERSONAL');
    });

    it('a healthy profile logs no warning at all', async () => {
      const out = await profileLog(() =>
        jsonResponse({
          user: { first_name: 'Анна', last_name: 'Ким', avatar: 'https://a.example/a.jpg' },
        }),
      );
      expect(out).toBe('');
    });

    it('no sensitive value ever reaches the logs, across every failure path', async () => {
      fetchMock.mockImplementation(hangUntilAborted);
      const { state, pkce } = await start();
      const r1 = await callback(pkce, state);
      const all = [
        await profileLog(() => jsonResponse({}, 500)),
        await profileLog(() => jsonResponse({ user: {} })),
        logged(),
      ].join('');
      expect(r1.statusCode).toBe(504);
      for (const sensitive of [SECRET, ACCESS_TOKEN, CODE, pkce, state, 'session_id', 'cookie']) {
        expect(all).not.toContain(sensitive);
      }
    });

    it('fetchVkProfile never throws, whatever happens', async () => {
      for (const failure of [
        () => Promise.reject(new TypeError('boom')),
        () => Promise.reject(Object.assign(new Error('x'), { name: 'AbortError' })),
        () => Promise.resolve({ ok: true, status: 200, json: async () => null }),
      ]) {
        fetchMock.mockImplementationOnce(failure);
        await expect(fetchVkProfile(config, 'tok')).resolves.toEqual({});
      }
    });
  });

  describe('vk_pkce cookie', () => {
    it('corrupt JSON -> 400 invalid_state (not a 500), the cookie is cleared, VK is never contacted', async () => {
      const res = await callback('this-is-not-json', 'whatever');
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'invalid_state' });
      expect(String(res.headers['set-cookie'])).toMatch(/vk_pkce=;/);
      expect(String(res.headers['set-cookie'])).toMatch(/Path=\//);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(cookieValue(res.headers['set-cookie'], 'session_id')).toBeUndefined();
    });

    it.each([
      ['JSON of the wrong shape', encodeURIComponent('{}')],
      ['a JSON array', encodeURIComponent('[]')],
      ['JSON null', 'null'],
      ['a JSON string', encodeURIComponent('"x"')],
      ['state/verifier of the wrong type', encodeURIComponent('{"state":1,"codeVerifier":2}')],
      ['truncated JSON', encodeURIComponent('{"state":"abc","codeVer')],
    ])('%s -> 400 invalid_state, VK never contacted', async (_name, cookie) => {
      const res = await callback(cookie, 'abc');
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'invalid_state' });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('missing cookie -> 400 invalid_callback', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/auth/vk/callback?code=${CODE}&device_id=dev&state=abc`,
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'invalid_callback' });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('valid cookie but a different state -> 400 invalid_state (CSRF guard unchanged)', async () => {
      const { pkce } = await start();
      const res = await callback(pkce, 'some-other-state');
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'invalid_state' });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('valid cookie + matching state -> normal sign-in (302 + session), and the PKCE cookie is expired', async () => {
      fetchMock.mockImplementation(async (url: string) =>
        url.endsWith('/oauth2/auth')
          ? jsonResponse({ user_id: 7777, access_token: ACCESS_TOKEN })
          : jsonResponse({ user: { first_name: 'Мария' } }),
      );
      const { state, pkce } = await start();
      const res = await callback(pkce, state);
      expect(res.statusCode).toBe(302);
      expect(cookieValue(res.headers['set-cookie'], 'session_id')).toBeTruthy();
      expect(String(res.headers['set-cookie'])).toMatch(/vk_pkce=;/);
    });
  });

  it('VkRequestError carries no request content in its message', () => {
    const error = new VkRequestError('http', 400, 'invalid_grant');
    expect(error.message).toBe('VK request failed: http (400) invalid_grant');
  });
});
