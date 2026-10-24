import { createSeededTestDb } from '@zybrilka/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';
import { createApp } from './createApp.js';

/**
 * Regression for the production incident where every `/api/v1/auth/*`
 * route 404'd: `server.ts` built the app without `authConfig`, so the
 * auth module was never registered. These tests go through the same
 * `createApp` the server entrypoint uses (not `buildApp` directly with a
 * hand-picked `authConfig`, which is what masked the bug).
 */
describe('createApp (production wiring)', () => {
  let testDb: Awaited<ReturnType<typeof createSeededTestDb>>;

  beforeAll(async () => {
    testDb = await createSeededTestDb();
  });
  afterAll(async () => {
    await testDb.close();
  });

  it('registers the auth routes: /api/v1/auth/me exists (not a 404)', async () => {
    const app = createApp(loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'fatal' }), testDb.db);
    const res = await app.inject({ method: 'GET', url: '/api/v1/auth/me' });
    expect(res.statusCode).not.toBe(404);
    await app.close();
  });

  it('VK start answers a clear 503 when VK is not configured — not a 404', async () => {
    const app = createApp(loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'fatal' }), testDb.db);
    const res = await app.inject({ method: 'GET', url: '/api/v1/auth/vk/start' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: 'vk_not_configured' });
    await app.close();
  });

  it('VK start redirects (302) to VK without echoing secrets when configured', async () => {
    const app = createApp(
      loadConfig({
        NODE_ENV: 'test',
        LOG_LEVEL: 'fatal',
        VK_CLIENT_ID: 'vk-client',
        VK_CLIENT_SECRET: 'vk-secret',
        VK_REDIRECT_URI: 'https://zybrilka.ru/api/v1/auth/vk/callback',
      }),
      testDb.db,
    );
    const res = await app.inject({ method: 'GET', url: '/api/v1/auth/vk/start' });
    expect(res.statusCode).toBe(302);
    expect(new URL(res.headers.location as string).origin).toBe('https://id.vk.ru');
    expect(res.headers.location).not.toContain('vk-secret');
    await app.close();
  });

  it('keeps the existing non-auth routes working alongside auth', async () => {
    const app = createApp(loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'fatal' }), testDb.db);
    expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
    await app.close();
  });

  it('in production, rate-limits per real client IP (X-Forwarded-For), not per reverse proxy', async () => {
    const app = createApp(
      loadConfig({
        NODE_ENV: 'production',
        LOG_LEVEL: 'fatal',
        DATABASE_URL: 'postgres://unused:unused@localhost:5432/unused',
      }),
      testDb.db,
    );
    const post = (ip: string) =>
      app.inject({
        method: 'POST',
        url: '/api/v1/auth/telegram',
        remoteAddress: '172.18.0.5', // the proxy, same for everyone
        headers: { 'x-forwarded-for': ip },
        payload: {},
      });
    for (let i = 0; i < 30; i++) expect((await post('203.0.113.1')).statusCode).toBe(400);
    expect((await post('203.0.113.1')).statusCode).toBe(429);
    // A different real client behind the same proxy is NOT throttled.
    expect((await post('203.0.113.2')).statusCode).toBe(400);
    await app.close();
  });
});
