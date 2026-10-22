import { randomUUID } from 'node:crypto';
import { schema } from '@zybrilka/db';
import { createSeededTestDb } from '@zybrilka/db/testing';
import { eq } from 'drizzle-orm';
import type { RouteOptions } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { telegramLaunch } from '../../testSupport.js';

const BOT_TOKEN = '123456:TEST-ONLY-admin-access';

/**
 * The admin API is owner-only, decided server-side (docs/ADMIN.md §Доступ).
 * Every route under /api/v1/admin is enumerated from the app itself, so a
 * route added later is covered by these checks automatically.
 */
describe('admin API access (owner only)', () => {
  let testDb: Awaited<ReturnType<typeof createSeededTestDb>>;
  let app: ReturnType<typeof buildApp>;
  const adminRoutes: { method: string; url: string }[] = [];
  let owner: { userId: string; cookie: string };
  let regular: { userId: string; cookie: string };

  async function userWithSession() {
    const [user] = await testDb.db.insert(schema.users).values({}).returning();
    const sessionId = randomUUID();
    await testDb.db
      .insert(schema.authSessions)
      .values({ id: sessionId, userId: user!.id, expiresAt: new Date(Date.now() + 3_600_000) });
    return { userId: user!.id, cookie: `session_id=${sessionId}` };
  }

  beforeAll(async () => {
    testDb = await createSeededTestDb();
    owner = await userWithSession();
    regular = await userWithSession();
    app = buildApp({
      version: 'test',
      db: testDb.db,
      authConfig: loadConfig({
        NODE_ENV: 'test',
        TELEGRAM_BOT_TOKEN: BOT_TOKEN,
        ADMIN_OWNER_USER_IDS: owner.userId,
      }),
    });
    app.addHook('onRoute', (route: RouteOptions) => {
      if (!route.url.startsWith('/api/v1/admin')) return;
      for (const method of [route.method].flat()) {
        if (method !== 'HEAD') adminRoutes.push({ method, url: route.url });
      }
    });
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    await testDb.close();
  });

  /** Fills `:param` placeholders with syntactically valid values. */
  const concrete = (url: string) => url.replace(/:[a-zA-Z]+/g, randomUUID());
  const writeHeaders = { 'x-zybrilka-admin': '1', 'content-type': 'application/json' };

  it('has admin routes to check', () => {
    expect(adminRoutes.length).toBeGreaterThan(0);
  });

  it('a guest gets 401 on every admin route (reads, writes, exports)', async () => {
    for (const route of adminRoutes) {
      const res = await app.inject({
        method: route.method as 'GET',
        url: concrete(route.url),
        headers: route.method === 'GET' ? {} : writeHeaders,
        ...(route.method === 'GET' ? {} : { payload: '{}' }),
      });
      expect(res.statusCode, `${route.method} ${route.url}`).toBe(401);
      expect(res.json()).toEqual({ error: 'unauthorized' });
    }
  });

  it('a signed-in regular user gets 403 on every admin route, and it is audited', async () => {
    for (const route of adminRoutes) {
      const res = await app.inject({
        method: route.method as 'GET',
        url: concrete(route.url),
        headers: { cookie: regular.cookie, ...(route.method === 'GET' ? {} : writeHeaders) },
        ...(route.method === 'GET' ? {} : { payload: '{}' }),
      });
      expect(res.statusCode, `${route.method} ${route.url}`).toBe(403);
      expect(res.json()).toEqual({ error: 'forbidden' });
      expect(res.headers['cache-control']).toBe('no-store');
    }
    const denied = await testDb.db
      .select()
      .from(schema.adminAuditLog)
      .where(eq(schema.adminAuditLog.actorUserId, regular.userId));
    expect(denied.length).toBe(adminRoutes.length);
    expect(denied.every((row) => row.action === 'admin.access_denied')).toBe(true);
  });

  it('the owner is let in', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/me',
      headers: { cookie: owner.cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ userId: owner.userId, role: 'owner' });
  });

  it("naming the owner's id anywhere the client controls does not help", async () => {
    const attempts = [
      { headers: { 'x-anon-id': owner.userId } },
      { headers: { 'x-user-id': owner.userId, 'x-admin': 'true' } },
      { headers: { cookie: `session_id=${owner.userId}` } },
      { headers: { cookie: `session_id=${randomUUID()}; admin=1; role=owner` } },
      { url: `/api/v1/admin/me?userId=${owner.userId}&admin=true` },
    ];
    for (const attempt of attempts) {
      const res = await app.inject({
        method: 'GET',
        url: attempt.url ?? '/api/v1/admin/me',
        headers: attempt.headers ?? {},
      });
      expect(res.statusCode).toBe(401);
    }
    const asRegular = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/me?userId=${owner.userId}`,
      headers: { cookie: regular.cookie, 'x-anon-id': owner.userId },
    });
    expect(asRegular.statusCode).toBe(403);
  });

  it('an expired owner session is not an owner session', async () => {
    const sessionId = randomUUID();
    await testDb.db
      .insert(schema.authSessions)
      .values({ id: sessionId, userId: owner.userId, expiresAt: new Date(Date.now() - 1000) });
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/me',
      headers: { cookie: `session_id=${sessionId}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it('owner writes need the admin header and are refused cross-site', async () => {
    const writes = adminRoutes.filter((r) => r.method !== 'GET');
    for (const route of writes) {
      const noHeader = await app.inject({
        method: route.method as 'POST',
        url: concrete(route.url),
        headers: { cookie: owner.cookie, 'content-type': 'application/json' },
        payload: '{}',
      });
      expect(noHeader.statusCode, `${route.method} ${route.url}`).toBe(403);
      const crossSite = await app.inject({
        method: route.method as 'POST',
        url: concrete(route.url),
        headers: { cookie: owner.cookie, ...writeHeaders, 'sec-fetch-site': 'cross-site' },
        payload: '{}',
      });
      expect(crossSite.statusCode, `${route.method} ${route.url}`).toBe(403);
    }
  });

  it('signing up (Telegram first launch) never creates an admin', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/telegram',
      payload: { initData: telegramLaunch(BOT_TOKEN, { id: 777001, first_name: 'Новый' }) },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().created).toBe(true);
    const cookie = res.cookies.find((c) => c.name === 'session_id')!;
    const admin = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/me',
      headers: { cookie: `session_id=${cookie.value}` },
    });
    expect(admin.statusCode).toBe(403);
  });

  it('with no owner configured (the default) nobody gets in', async () => {
    const closed = buildApp({
      version: 'test',
      db: testDb.db,
      authConfig: loadConfig({ NODE_ENV: 'test' }),
    });
    for (const who of [owner, regular]) {
      const res = await closed.inject({
        method: 'GET',
        url: '/api/v1/admin/me',
        headers: { cookie: who.cookie },
      });
      expect(res.statusCode).toBe(403);
    }
    await closed.close();
  });
});
