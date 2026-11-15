import { randomUUID } from 'node:crypto';
import { schema } from '@zybrilka/db';
import { createSeededTestDb } from '@zybrilka/db/testing';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { ACCOUNT_ATTEMPTS_PER_MINUTE } from './modules/tasks/routes.js';

/**
 * Regression tests for the 2026-11 security audit (SECURITY_AUDIT_REPORT.md):
 * answer checks are rate-limited per account too, a 5xx never carries its
 * internals, and every API response has the security headers.
 */
describe('security hardening (production auth config)', () => {
  let testDb: Awaited<ReturnType<typeof createSeededTestDb>>;
  let app: ReturnType<typeof buildApp>;
  let task: { id: string };

  beforeAll(async () => {
    testDb = await createSeededTestDb();
    app = buildApp({
      version: 'test',
      db: testDb.db,
      authConfig: loadConfig({ NODE_ENV: 'test' }),
    });
    // A route that fails the way a database error does, to see what leaks.
    app.get('/api/v1/__boom', async () => {
      throw new Error('Failed query: select secret_column from users\nparams: 42');
    });
    const [row] = await testDb.db
      .select({ id: schema.tasks.id })
      .from(schema.tasks)
      .where(and(eq(schema.tasks.answerType, 'short_answer'), eq(schema.tasks.status, 'published')))
      .limit(1);
    task = row!;
  });
  afterAll(async () => {
    await app.close();
    await testDb.close();
  });

  async function signedInCookie() {
    const [user] = await testDb.db.insert(schema.users).values({}).returning();
    const sessionId = randomUUID();
    await testDb.db
      .insert(schema.authSessions)
      .values({ id: sessionId, userId: user!.id, expiresAt: new Date(Date.now() + 3_600_000) });
    return `session_id=${sessionId}`;
  }

  const attempt = (cookie: string) =>
    app.inject({
      method: 'POST',
      url: `/api/v1/tasks/${task.id}/attempt`,
      headers: { cookie },
      payload: { answer: 'не то' },
    });

  it('a signed-in account is limited per minute; another account is not affected', async () => {
    const cookie = await signedInCookie();
    for (let i = 0; i < ACCOUNT_ATTEMPTS_PER_MINUTE; i++) {
      expect((await attempt(cookie)).statusCode).toBe(200);
    }
    expect((await attempt(cookie)).statusCode).toBe(429);
    // The limit is per account, not per IP: a classmate on the same network answers on.
    expect((await attempt(await signedInCookie())).statusCode).toBe(200);
  });

  it('a 500 says «internal_error» and nothing about SQL or parameters', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/__boom' });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: 'internal_error' });
    expect(res.body).not.toMatch(/select|params|secret/i);
  });

  it('client errors keep their usual shape (bad JSON → 400)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/tasks/${task.id}/attempt`,
      headers: { 'content-type': 'application/json' },
      payload: '{not json',
    });
    expect(res.statusCode).toBe(400);
  });

  it('every API response carries the security headers', async () => {
    for (const url of ['/health', '/api/v1/tasks?subject=math', '/api/v1/progress/summary']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-frame-options']).toBe('DENY');
      expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
      expect(res.headers['strict-transport-security']).toMatch(/max-age=\d+/);
      expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    }
  });
});
