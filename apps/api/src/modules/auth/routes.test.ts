import { createSeededTestDb } from '@zybrilka/db/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';

const sendMailMock = vi.fn(async (_opts: { html: string }) => ({}));
vi.mock('nodemailer', () => ({
  default: { createTransport: () => ({ sendMail: sendMailMock }) },
}));

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

function parseSetCookie(header: string | string[] | undefined, name: string): string | undefined {
  const headers = Array.isArray(header) ? header : header ? [header] : [];
  for (const raw of headers) {
    const [pair] = raw.split(';');
    const [key, value] = pair!.split('=');
    if (key === name) return value;
  }
  return undefined;
}

function extractToken(link: string): string {
  return new URL(link).searchParams.get('token')!;
}

describe('auth (magic-link + VK ID + session)', () => {
  let testDb: Awaited<ReturnType<typeof createSeededTestDb>>;
  let app: ReturnType<typeof buildApp>;
  let appNoAuth: ReturnType<typeof buildApp>;

  beforeAll(async () => {
    testDb = await createSeededTestDb();
    const authConfig = loadConfig({
      NODE_ENV: 'test',
      SMTP_HOST: 'smtp.test',
      SMTP_USER: 'user',
      SMTP_PASSWORD: 'pass',
      VK_CLIENT_ID: 'vk-client',
      VK_CLIENT_SECRET: 'vk-secret',
      VK_REDIRECT_URI: 'http://localhost:5173/auth/vk/callback',
    });
    app = buildApp({ version: 'test', db: testDb.db, authConfig });
    // No authConfig at all — mirrors every pre-existing test's buildApp
    // call shape, asserting auth routes/cookie plugin simply don't exist.
    appNoAuth = buildApp({ version: 'test', db: testDb.db });
  });

  afterEach(() => {
    sendMailMock.mockClear();
    fetchMock.mockReset();
  });

  afterAll(async () => {
    await app.close();
    await appNoAuth.close();
    await testDb.close();
  });

  it('does not register auth routes at all when no authConfig is given', async () => {
    const res = await appNoAuth.inject({ method: 'GET', url: '/api/v1/auth/me' });
    expect(res.statusCode).toBe(404);
  });

  it('magic-link request 503s with email_not_configured when SMTP is unset', async () => {
    const unconfigured = buildApp({
      version: 'test',
      db: testDb.db,
      authConfig: loadConfig({ NODE_ENV: 'test' }),
    });
    const res = await unconfigured.inject({
      method: 'POST',
      url: '/api/v1/auth/magic-link',
      payload: { email: 'someone@example.com' },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: 'email_not_configured' });
    await unconfigured.close();
  });

  it('magic-link request rejects an invalid email with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/magic-link',
      payload: { email: 'not-an-email' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('magic-link request returns the identical {ok:true} response for a brand-new email and a previously-used one (anti-enumeration)', async () => {
    const freshEmail = `fresh-${Date.now()}@example.com`;
    const resFresh = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/magic-link',
      payload: { email: freshEmail },
    });

    // Now make that same email "previously used" by completing a login.
    const link = sendMailMock.mock.calls.at(-1)![0].html as string;
    const token = extractToken(link.match(/href="([^"]+)"/)![1]!);
    await app.inject({ method: 'POST', url: '/api/v1/auth/verify', payload: { token } });

    const resUsed = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/magic-link',
      payload: { email: freshEmail },
    });

    expect(resFresh.statusCode).toBe(resUsed.statusCode);
    expect(resFresh.json()).toEqual(resUsed.json());
    expect(resFresh.json()).toEqual({ ok: true });
  });

  it('completes a full magic-link sign-in: request -> verify -> session cookie -> /auth/me -> logout', async () => {
    const email = `login-${Date.now()}@example.com`;
    const requestRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/magic-link',
      payload: { email },
    });
    expect(requestRes.statusCode).toBe(200);
    expect(sendMailMock).toHaveBeenCalledTimes(1);

    const html = sendMailMock.mock.calls[0]![0].html as string;
    const token = extractToken(html.match(/href="([^"]+)"/)![1]!);

    const verifyRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/verify',
      payload: { token },
    });
    expect(verifyRes.statusCode).toBe(200);
    expect(verifyRes.json().user.email).toBe(email);

    const sessionId = parseSetCookie(verifyRes.headers['set-cookie'], 'session_id');
    expect(sessionId).toBeTruthy();

    const meRes = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: `session_id=${sessionId}` },
    });
    expect(meRes.json()).toEqual({ user: { id: verifyRes.json().user.id, email } });

    // The same token is single-use — replaying it must fail.
    const replayRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/verify',
      payload: { token },
    });
    expect(replayRes.statusCode).toBe(400);
    expect(replayRes.json()).toEqual({ error: 'invalid_or_expired_token' });

    const logoutRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { cookie: `session_id=${sessionId}` },
    });
    expect(logoutRes.statusCode).toBe(204);

    const meAfterLogout = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: `session_id=${sessionId}` },
    });
    expect(meAfterLogout.json()).toEqual({ user: null });
  });

  it('verify rejects a garbage/unknown token with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/verify',
      payload: { token: 'not-a-real-token' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'invalid_or_expired_token' });
  });

  it('a request with no session cookie is anonymous on /auth/me', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/auth/me' });
    expect(res.json()).toEqual({ user: null });
  });

  it('VK start 503s with vk_not_configured when VK env vars are unset', async () => {
    const unconfigured = buildApp({
      version: 'test',
      db: testDb.db,
      authConfig: loadConfig({ NODE_ENV: 'test' }),
    });
    const res = await unconfigured.inject({ method: 'GET', url: '/api/v1/auth/vk/start' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: 'vk_not_configured' });
    await unconfigured.close();
  });

  it('VK start redirects to id.vk.com with a PKCE challenge and sets a short-lived state cookie', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/auth/vk/start' });
    expect(res.statusCode).toBe(302);
    const location = new URL(res.headers.location as string);
    expect(location.origin).toBe('https://id.vk.com');
    expect(location.searchParams.get('code_challenge_method')).toBe('S256');
    expect(parseSetCookie(res.headers['set-cookie'], 'vk_pkce')).toBeTruthy();
  });

  it('VK callback 400s when the PKCE cookie is missing', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/vk/callback?code=abc&device_id=1&state=xyz',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'invalid_callback' });
  });

  it('VK callback 400s when the returned state does not match the stored PKCE state (CSRF guard)', async () => {
    const startRes = await app.inject({ method: 'GET', url: '/api/v1/auth/vk/start' });
    const pkceCookie = parseSetCookie(startRes.headers['set-cookie'], 'vk_pkce')!;
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/vk/callback?code=abc&device_id=1&state=wrong-state',
      headers: { cookie: `vk_pkce=${pkceCookie}` },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'invalid_state' });
  });

  it('completes a full VK sign-in when the token exchange succeeds, and reuses the same user on a second login', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ user_id: 555444333 }),
      text: async () => '',
    });

    const startRes = await app.inject({ method: 'GET', url: '/api/v1/auth/vk/start' });
    const location = new URL(startRes.headers.location as string);
    const state = location.searchParams.get('state');
    const pkceCookie = parseSetCookie(startRes.headers['set-cookie'], 'vk_pkce')!;

    const callbackRes = await app.inject({
      method: 'GET',
      url: `/api/v1/auth/vk/callback?code=abc&device_id=dev-1&state=${state}`,
      headers: { cookie: `vk_pkce=${pkceCookie}` },
    });
    expect(callbackRes.statusCode).toBe(302);
    const sessionId = parseSetCookie(callbackRes.headers['set-cookie'], 'session_id')!;

    const meRes = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: `session_id=${sessionId}` },
    });
    const firstUserId = meRes.json().user.id as string;
    expect(firstUserId).toBeTruthy();

    // Second VK login with the same VK user id must resolve to the same user.
    const start2 = await app.inject({ method: 'GET', url: '/api/v1/auth/vk/start' });
    const location2 = new URL(start2.headers.location as string);
    const state2 = location2.searchParams.get('state');
    const pkceCookie2 = parseSetCookie(start2.headers['set-cookie'], 'vk_pkce')!;
    const callback2 = await app.inject({
      method: 'GET',
      url: `/api/v1/auth/vk/callback?code=abc2&device_id=dev-2&state=${state2}`,
      headers: { cookie: `vk_pkce=${pkceCookie2}` },
    });
    const sessionId2 = parseSetCookie(callback2.headers['set-cookie'], 'session_id')!;
    const meRes2 = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: `session_id=${sessionId2}` },
    });
    expect(meRes2.json().user.id).toBe(firstUserId);
  });

  it('VK callback surfaces a 502 when the token exchange fails', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 400, text: async () => 'bad request' });

    const startRes = await app.inject({ method: 'GET', url: '/api/v1/auth/vk/start' });
    const location = new URL(startRes.headers.location as string);
    const state = location.searchParams.get('state');
    const pkceCookie = parseSetCookie(startRes.headers['set-cookie'], 'vk_pkce')!;

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/auth/vk/callback?code=abc&device_id=dev-1&state=${state}`,
      headers: { cookie: `vk_pkce=${pkceCookie}` },
    });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ error: 'vk_login_failed' });
  });
});
