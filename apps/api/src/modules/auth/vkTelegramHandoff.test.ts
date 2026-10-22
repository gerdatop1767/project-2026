import { createSeededTestDb } from '@zybrilka/db/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

function cookieFrom(header: string | string[] | undefined, name: string) {
  const all = Array.isArray(header) ? header : header ? [header] : [];
  for (const raw of all) {
    const [pair, ...attrs] = raw.split(';').map((p) => p.trim());
    const [key, value] = pair!.split('=');
    if (key === name) return { value: value!, attrs: attrs.join('; ') };
  }
  return undefined;
}

/**
 * VK ID started from the Telegram Mini App: it runs in the external
 * browser (Safari/Chrome — its own cookie jar), and the account is handed
 * back to the Mini App's WebView through a one-time handoff. These tests
 * play both sides with separate cookie jars, exactly like on a phone.
 */
describe('VK sign-in from the Telegram Mini App (external browser + handoff)', () => {
  let testDb: Awaited<ReturnType<typeof createSeededTestDb>>;
  let app: ReturnType<typeof buildApp>;

  beforeAll(async () => {
    testDb = await createSeededTestDb();
    app = buildApp({
      version: 'test',
      db: testDb.db,
      authConfig: loadConfig({
        NODE_ENV: 'test',
        WEB_BASE_URL: 'https://zybrilka.test',
        VK_CLIENT_ID: 'vk-client',
        VK_CLIENT_SECRET: 'vk-secret',
        VK_REDIRECT_URI: 'https://zybrilka.test/api/v1/auth/vk/callback',
      }),
    });
  });
  afterEach(() => fetchMock.mockReset());
  afterAll(async () => {
    await app.close();
    await testDb.close();
  });

  /** Mini App (WebView jar): starts a handoff. */
  async function miniAppStarts() {
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/vk/handoff' });
    expect(res.statusCode).toBe(200);
    const claim = cookieFrom(res.headers['set-cookie'], 'vk_handoff')!;
    const startUrl = new URL(res.json().startUrl as string);
    return { claim, startUrl };
  }

  /** External browser (its own jar): opens the start URL, goes to VK. */
  async function browserOpens(startUrl: URL) {
    const res = await app.inject({ method: 'GET', url: startUrl.pathname + startUrl.search });
    return res;
  }

  async function browserReturnsFromVk(
    start: Awaited<ReturnType<typeof browserOpens>>,
    query: string,
  ) {
    const pkce = cookieFrom(start.headers['set-cookie'], 'vk_pkce')!;
    const state = new URL(start.headers.location as string).searchParams.get('state');
    return app.inject({
      method: 'GET',
      url: `/api/v1/auth/vk/callback?${query.replace('STATE', state!)}`,
      headers: { cookie: `vk_pkce=${pkce.value}` },
    });
  }

  const claim = (claimCookie?: string) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/auth/vk/handoff/claim',
      headers: claimCookie ? { cookie: `vk_handoff=${claimCookie}` } : {},
    });

  function mockVkUser(vkUserId: number) {
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes('oauth2/auth')) {
        return {
          ok: true,
          json: async () => ({ user_id: vkUserId, access_token: 'vk-at' }),
          text: async () => '',
        };
      }
      return {
        ok: true,
        json: async () => ({ user: { first_name: 'Вера' } }),
        text: async () => '',
      };
    });
  }

  it('full flow: Mini App → external browser → VK ID → back in the Mini App with a working session', async () => {
    mockVkUser(777000111);
    const { claim: claimCookie, startUrl } = await miniAppStarts();

    // The claim secret is the WebView's own httpOnly cookie, scoped to the
    // handoff endpoints; the start URL carries a DIFFERENT one-time token.
    expect(claimCookie.attrs).toMatch(/HttpOnly/i);
    expect(claimCookie.attrs).toMatch(/Path=\/api\/v1\/auth\/vk\/handoff/i);
    expect(claimCookie.attrs).toMatch(/SameSite=Lax/i);
    expect(startUrl.origin).toBe('https://zybrilka.test');
    expect(startUrl.searchParams.get('handoff')).not.toBe(claimCookie.value);

    // While the user is still in the browser, the Mini App just waits.
    expect((await claim(claimCookie.value)).json()).toEqual({ status: 'pending' });

    const start = await browserOpens(startUrl);
    expect(start.statusCode).toBe(302);
    const authorize = new URL(start.headers.location as string);
    expect(authorize.origin + authorize.pathname).toBe('https://id.vk.ru/authorize');
    for (const p of ['client_id', 'redirect_uri', 'state', 'code_challenge']) {
      expect(authorize.searchParams.get(p)).toBeTruthy();
    }
    expect(authorize.searchParams.get('code_challenge_method')).toBe('S256');

    const callback = await browserReturnsFromVk(start, 'code=c1&device_id=d1&state=STATE');
    expect(callback.statusCode).toBe(302);
    expect(callback.headers.location).toBe('https://zybrilka.test/telegram-return?status=ok');
    // The code exchange happened server-side, with the PKCE verifier.
    const [, init] = fetchMock.mock.calls.find(([u]) => String(u).includes('oauth2/auth'))!;
    expect(new URLSearchParams(init.body as string).get('code_verifier')).toBeTruthy();
    // No token or secret ever travels in the return URL.
    expect(callback.headers.location).not.toMatch(/token|code=|session/i);

    // Back in Telegram: the Mini App claims ITS OWN session.
    const claimed = await claim(claimCookie.value);
    expect(claimed.json().status).toBe('ok');
    const session = cookieFrom(claimed.headers['set-cookie'], 'session_id')!;
    expect(session.attrs).toMatch(/HttpOnly/i);
    const me = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: `session_id=${session.value}` },
    });
    expect(me.json().user.id).toBe(claimed.json().user.id);
    // …and that session really opens private data.
    const summary = await app.inject({
      method: 'GET',
      url: '/api/v1/progress/summary',
      headers: { cookie: `session_id=${session.value}` },
    });
    expect(summary.statusCode).toBe(200);

    // Single use: a second claim (or a replayed start link) gets nothing.
    expect((await claim(claimCookie.value)).json()).toEqual({ status: 'expired' });
    const replay = await browserOpens(startUrl);
    expect(replay.headers.location).toBe(
      'https://zybrilka.test/telegram-return?status=expired',
    );
  });

  it('the same VK account signs into the same user (existing progress is kept, nothing is overwritten)', async () => {
    mockVkUser(777000222);
    const first = await miniAppStarts();
    await browserReturnsFromVk(
      await browserOpens(first.startUrl),
      'code=a&device_id=d&state=STATE',
    );
    const firstUser = (await claim(first.claim.value)).json().user.id;

    const again = await miniAppStarts();
    await browserReturnsFromVk(
      await browserOpens(again.startUrl),
      'code=b&device_id=d&state=STATE',
    );
    expect((await claim(again.claim.value)).json().user.id).toBe(firstUser);
  });

  it('cancelling on the VK screen: the browser is told so, the Mini App learns "cancelled", no session', async () => {
    const { claim: claimCookie, startUrl } = await miniAppStarts();
    const start = await browserOpens(startUrl);
    const pkce = cookieFrom(start.headers['set-cookie'], 'vk_pkce')!;
    const callback = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/vk/callback?error=access_denied&state=x',
      headers: { cookie: `vk_pkce=${pkce.value}` },
    });
    expect(callback.headers.location).toBe(
      'https://zybrilka.test/telegram-return?status=cancelled',
    );
    const res = await claim(claimCookie.value);
    expect(res.json()).toEqual({ status: 'cancelled' });
    expect(cookieFrom(res.headers['set-cookie'], 'session_id')).toBeUndefined();
  });

  it('a VK error: the browser shows an error page, the Mini App learns "failed", no session', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 400, text: async () => 'bad' });
    const { claim: claimCookie, startUrl } = await miniAppStarts();
    const callback = await browserReturnsFromVk(
      await browserOpens(startUrl),
      'code=c&device_id=d&state=STATE',
    );
    expect(callback.headers.location).toBe(
      'https://zybrilka.test/telegram-return?status=error',
    );
    expect((await claim(claimCookie.value)).json()).toEqual({ status: 'failed' });
  });

  it('the CSRF state check still applies to a handoff sign-in', async () => {
    const { startUrl } = await miniAppStarts();
    const start = await browserOpens(startUrl);
    const pkce = cookieFrom(start.headers['set-cookie'], 'vk_pkce')!;
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/vk/callback?code=c&device_id=d&state=forged',
      headers: { cookie: `vk_pkce=${pkce.value}` },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'invalid_state' });
  });

  it('a start token can never be used to claim, and a made-up one leads nowhere', async () => {
    const { startUrl } = await miniAppStarts();
    const startToken = startUrl.searchParams.get('handoff')!;
    expect((await claim(startToken)).json()).toEqual({ status: 'expired' });
    expect((await claim()).json()).toEqual({ status: 'expired' });
    const forged = await app.inject({
      method: 'GET',
      url: `/api/v1/auth/vk/start?handoff=${'x'.repeat(43)}`,
    });
    expect(forged.headers.location).toBe(
      'https://zybrilka.test/telegram-return?status=expired',
    );
  });

  it('tapping the button again simply starts a fresh handoff; the old one cannot be claimed into a session', async () => {
    mockVkUser(777000333);
    const first = await miniAppStarts();
    const second = await miniAppStarts();
    expect(second.claim.value).not.toBe(first.claim.value);
    await browserReturnsFromVk(
      await browserOpens(second.startUrl),
      'code=z&device_id=d&state=STATE',
    );
    expect((await claim(first.claim.value)).json()).toEqual({ status: 'pending' });
    expect((await claim(second.claim.value)).json().status).toBe('ok');
  });

  it('a cross-site page cannot start a handoff (login CSRF guard)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/vk/handoff',
      headers: { 'sec-fetch-site': 'cross-site' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('the regular website VK sign-in is unchanged (session cookie + app landing)', async () => {
    mockVkUser(777000444);
    const start = await app.inject({ method: 'GET', url: '/api/v1/auth/vk/start' });
    const callback = await browserReturnsFromVk(start, 'code=w&device_id=d&state=STATE');
    expect(callback.statusCode).toBe(302);
    expect(callback.headers.location).toMatch(/^https:\/\/zybrilka\.test\/(onboarding)?$/);
    expect(cookieFrom(callback.headers['set-cookie'], 'session_id')).toBeDefined();
  });
});
