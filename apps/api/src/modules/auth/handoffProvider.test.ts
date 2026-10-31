import { createSeededTestDb } from '@zybrilka/db/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

function cookieFrom(header: string | string[] | undefined, name: string) {
  const all = Array.isArray(header) ? header : header ? [header] : [];
  for (const raw of all) {
    const [pair] = raw.split(';');
    const i = pair!.indexOf('=');
    if (pair!.slice(0, i) === name) return pair!.slice(i + 1);
  }
  return undefined;
}

/** Yandex answers: token exchange, then /info. */
function yandexReplies(id: string) {
  fetchMock.mockImplementation(async (url: string) => {
    if (url.startsWith('https://oauth.yandex.ru/token')) {
      return new Response(JSON.stringify({ access_token: 'ya-at' }), { status: 200 });
    }
    if (url.startsWith('https://login.yandex.ru/info')) {
      return new Response(JSON.stringify({ id }), { status: 200 });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
}

const CLAIM_COOKIE = { vk: 'vk_handoff', yandex: 'ya_handoff' } as const;

const EXPIRED = (provider: 'vk' | 'yandex') =>
  `https://zybrilka.test/telegram-return?status=expired${provider === 'yandex' ? '&provider=yandex' : ''}`;

/**
 * Mini App handoffs are bound to the provider they were made for: a VK
 * start or claim token is worthless on the Yandex routes and vice versa
 * (the stored hash covers `<provider>:<token>`; see handoff.ts). Both
 * providers are configured here so a cross-provider token reaches the
 * handoff lookup instead of stopping at «not configured».
 */
describe('Mini App handoff tokens are bound to their provider', () => {
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
        YANDEX_CLIENT_ID: 'ya-client',
        YANDEX_CLIENT_SECRET: 'ya-secret',
        YANDEX_REDIRECT_URI: 'https://zybrilka.test/api/v1/auth/yandex/callback',
      }),
    });
  });
  afterEach(() => {
    fetchMock.mockReset();
    vi.useRealTimers();
  });
  afterAll(async () => {
    await app.close();
    await testDb.close();
  });

  async function miniAppHandoff(provider: 'vk' | 'yandex') {
    const res = await app.inject({ method: 'POST', url: `/api/v1/auth/${provider}/handoff` });
    expect(res.statusCode).toBe(200);
    const claimToken = cookieFrom(res.headers['set-cookie'], CLAIM_COOKIE[provider])!;
    const startUrl = new URL(res.json().startUrl as string);
    expect(startUrl.pathname).toBe(`/api/v1/auth/${provider}/start`);
    return { claimToken, startToken: startUrl.searchParams.get('handoff')! };
  }

  const openStart = (provider: 'vk' | 'yandex', startToken: string) =>
    app.inject({
      method: 'GET',
      url: `/api/v1/auth/${provider}/start?handoff=${encodeURIComponent(startToken)}`,
    });

  const claim = (provider: 'vk' | 'yandex', claimToken: string) =>
    app.inject({
      method: 'POST',
      url: `/api/v1/auth/${provider}/handoff/claim`,
      headers: { cookie: `${CLAIM_COOKIE[provider]}=${claimToken}` },
    });

  /** External browser: Yandex start (already opened) → callback, approved. */
  async function finishYandex(start: Awaited<ReturnType<typeof openStart>>, yandexId: string) {
    const oauth = cookieFrom(start.headers['set-cookie'], 'ya_oauth')!;
    const state = new URL(start.headers.location as string).searchParams.get('state')!;
    yandexReplies(yandexId);
    return app.inject({
      method: 'GET',
      url: `/api/v1/auth/yandex/callback?code=c&state=${state}`,
      headers: { cookie: `ya_oauth=${oauth}` },
    });
  }

  it('a VK start token does not start Yandex (and stays usable for VK)', async () => {
    const vk = await miniAppHandoff('vk');
    const onYandex = await openStart('yandex', vk.startToken);
    expect(onYandex.statusCode).toBe(302);
    expect(onYandex.headers.location).toBe(EXPIRED('yandex'));
    expect(cookieFrom(onYandex.headers['set-cookie'], 'ya_oauth')).toBeUndefined();
    // Untouched by the wrong-provider attempt.
    expect((await claim('vk', vk.claimToken)).json()).toEqual({
      status: 'pending',
      started: false,
    });

    const onVk = await openStart('vk', vk.startToken);
    expect(new URL(onVk.headers.location as string).hostname).toBe('id.vk.ru');
    expect((await claim('vk', vk.claimToken)).json()).toEqual({ status: 'pending', started: true });
  });

  it('a Yandex start token does not start VK', async () => {
    const ya = await miniAppHandoff('yandex');
    const onVk = await openStart('vk', ya.startToken);
    expect(onVk.headers.location).toBe(EXPIRED('vk'));
    expect(cookieFrom(onVk.headers['set-cookie'], 'vk_pkce')).toBeUndefined();
    expect((await claim('yandex', ya.claimToken)).json()).toEqual({
      status: 'pending',
      started: false,
    });
  });

  it('a completed Yandex handoff cannot be claimed on the VK route; the right route claims it once', async () => {
    const ya = await miniAppHandoff('yandex');
    const done = await finishYandex(await openStart('yandex', ya.startToken), '1130000055550001');
    expect(done.headers.location).toBe(
      'https://zybrilka.test/telegram-return?status=ok&provider=yandex',
    );

    const wrong = await claim('vk', ya.claimToken);
    expect(wrong.json()).toEqual({ status: 'expired' });
    expect(cookieFrom(wrong.headers['set-cookie'], 'session_id')).toBeUndefined();

    const right = await claim('yandex', ya.claimToken);
    expect(right.json()).toMatchObject({ status: 'ok', user: { id: expect.any(String) } });
    expect(cookieFrom(right.headers['set-cookie'], 'session_id')).toBeTruthy();

    // Single use: neither route can claim it again.
    expect((await claim('yandex', ya.claimToken)).json()).toEqual({ status: 'expired' });
    expect((await claim('vk', ya.claimToken)).json()).toEqual({ status: 'expired' });
  });

  it('a start token is single-use on its own route', async () => {
    const ya = await miniAppHandoff('yandex');
    expect((await openStart('yandex', ya.startToken)).headers.location).toMatch(
      /^https:\/\/oauth\.yandex\.ru\/authorize\?/,
    );
    expect((await openStart('yandex', ya.startToken)).headers.location).toBe(EXPIRED('yandex'));
  });

  it('an expired handoff neither starts nor claims', async () => {
    const ya = await miniAppHandoff('yandex');
    const vk = await miniAppHandoff('vk');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 11 * 60 * 1000);

    expect((await openStart('yandex', ya.startToken)).headers.location).toBe(EXPIRED('yandex'));
    expect((await openStart('vk', vk.startToken)).headers.location).toBe(EXPIRED('vk'));
    expect((await claim('yandex', ya.claimToken)).json()).toEqual({ status: 'expired' });
    expect((await claim('vk', vk.claimToken)).json()).toEqual({ status: 'expired' });
  });
});
