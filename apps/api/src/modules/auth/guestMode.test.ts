import { randomUUID } from 'node:crypto';
import { schema } from '@zybrilka/db';
import { createSeededTestDb } from '@zybrilka/db/testing';
import { and, count, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';

/**
 * Guest mode, as production runs it (`authConfig`): anyone can load tasks
 * and have answers checked; a guest's answer is NEVER recorded anywhere;
 * statistics and mistakes stay behind a session.
 */
describe('guest mode (production auth config)', () => {
  let testDb: Awaited<ReturnType<typeof createSeededTestDb>>;
  let app: ReturnType<typeof buildApp>;
  let task: { id: string; correctAnswer: string };

  beforeAll(async () => {
    testDb = await createSeededTestDb();
    app = buildApp({
      version: 'test',
      db: testDb.db,
      authConfig: loadConfig({ NODE_ENV: 'test' }),
    });
    const [row] = await testDb.db
      .select({ id: schema.tasks.id, correctAnswer: schema.tasks.correctAnswer })
      .from(schema.tasks)
      .where(and(eq(schema.tasks.answerType, 'short_answer'), eq(schema.tasks.status, 'published')))
      .limit(1);
    task = row!;
  });
  afterAll(async () => {
    await app.close();
    await testDb.close();
  });

  async function signedInUser() {
    const [user] = await testDb.db.insert(schema.users).values({}).returning();
    const sessionId = randomUUID();
    await testDb.db
      .insert(schema.authSessions)
      .values({ id: sessionId, userId: user!.id, expiresAt: new Date(Date.now() + 3_600_000) });
    return { userId: user!.id, cookie: `session_id=${sessionId}` };
  }

  const attemptRows = async () =>
    (await testDb.db.select({ n: count() }).from(schema.attempts))[0]!.n;

  it.each([
    '/api/v1/tasks?subject=math',
    '/api/v1/tasks/counts',
    '/api/v1/tasks/random?subject=math',
    '/api/v1/collections',
    '/api/v1/topics?subject=math',
  ])('a guest can read task content: GET %s → 200', async (url) => {
    const res = await app.inject({ method: 'GET', url });
    expect(res.statusCode).toBe(200);
  });

  it('the public topic list has real totals and nothing personal', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/topics?subject=math' });
    const items = res.json().items as { total: number; completed: number }[];
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((t) => t.total > 0 && t.completed === 0)).toBe(true);
    // The personal one stays private.
    const personal = await app.inject({
      method: 'GET',
      url: '/api/v1/progress/by-topic?subject=math',
    });
    expect(personal.statusCode).toBe(401);
  });

  it('a guest opens a task without its answer', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/v1/tasks/${task.id}` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).not.toHaveProperty('correctAnswer');
  });

  it('a guest answer is checked (right and wrong) but nothing at all is written', async () => {
    const before = await attemptRows();
    const right = await app.inject({
      method: 'POST',
      url: `/api/v1/tasks/${task.id}/attempt`,
      payload: { answer: task.correctAnswer },
    });
    expect(right.statusCode).toBe(200);
    expect(right.json()).toMatchObject({ correct: true, attemptId: null, mistakeId: null });

    const wrong = await app.inject({
      method: 'POST',
      url: `/api/v1/tasks/${task.id}/attempt`,
      payload: { answer: 'definitely-wrong-123' },
    });
    expect(wrong.json()).toMatchObject({
      correct: false,
      correctAnswer: task.correctAnswer,
      attemptId: null,
    });
    expect(await attemptRows()).toBe(before);
    const mistakes = (await testDb.db.select({ n: count() }).from(schema.mistakes))[0]!.n;
    expect(mistakes).toBe(0);
  });

  it("a forged x-anon-id never makes a guest's answer land in that user's profile", async () => {
    const victim = await signedInUser();
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/tasks/${task.id}/attempt`,
      headers: { 'x-anon-id': victim.userId },
      payload: { answer: task.correctAnswer },
    });
    expect(res.json().attemptId).toBeNull();
    const rows = await testDb.db
      .select()
      .from(schema.attempts)
      .where(eq(schema.attempts.userId, victim.userId));
    expect(rows).toHaveLength(0);
  });

  it('a signed-in answer is still recorded for that user', async () => {
    const user = await signedInUser();
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/tasks/${task.id}/attempt`,
      headers: { cookie: user.cookie },
      payload: { answer: 'wrong-on-purpose' },
    });
    expect(res.json().attemptId).toEqual(expect.any(String));
    const rows = await testDb.db
      .select()
      .from(schema.attempts)
      .where(eq(schema.attempts.userId, user.userId));
    expect(rows).toHaveLength(1);
    const summary = await app.inject({
      method: 'GET',
      url: '/api/v1/progress/summary',
      headers: { cookie: user.cookie },
    });
    expect(summary.statusCode).toBe(200);
    expect(summary.json().solvedTotal).toBeGreaterThan(0);
  });

  it.each([
    ['GET', '/api/v1/progress/summary'],
    ['GET', '/api/v1/progress/daily'],
    ['GET', '/api/v1/mistakes'],
    ['GET', '/api/v1/favorites'],
    ['GET', '/api/v1/me/learning-profile'],
  ] as const)('statistics/mistakes stay private: %s %s → 401 for a guest', async (method, url) => {
    const res = await app.inject({ method, url });
    expect(res.statusCode).toBe(401);
  });

  it('account-only task features say "sign in" instead of guessing (401 sign_in_required)', async () => {
    for (const url of [
      '/api/v1/tasks/random?subject=math&unseen=true',
      '/api/v1/tasks?subject=math&unsolved=true',
    ]) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ error: 'sign_in_required' });
    }
  });

  it('a cross-site answer submission is refused (CSRF guard still applies)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/tasks/${task.id}/attempt`,
      headers: { 'sec-fetch-site': 'cross-site' },
      payload: { answer: '1' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('guests are rate-limited per IP; signed-in users are not', async () => {
    const user = await signedInUser();
    const send = (headers: Record<string, string>) =>
      app.inject({
        method: 'POST',
        url: `/api/v1/tasks/${task.id}/attempt`,
        remoteAddress: '203.0.113.9',
        headers,
        payload: { answer: 'x' },
      });
    let limited = false;
    for (let i = 0; i < 125 && !limited; i++) {
      if ((await send({})).statusCode === 429) limited = true;
    }
    expect(limited).toBe(true);
    expect((await send({ cookie: user.cookie })).statusCode).toBe(200);
  });
});
