import { randomUUID } from 'node:crypto';
import { schema } from '@zybrilka/db';
import { createImported2027TestDb } from '@zybrilka/db/testing';
import { and, asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';

/**
 * ЕГЭ 2027 Ященко, Варианты 1–25: a `needs_review` task never reaches a
 * student — not in lists, random tasks, counts, variants, similar tasks,
 * smart training, variant sessions, recommendations, mistakes, favorites
 * or the leaderboard, and not through its id either (a stale link, or a
 * mistake/favorite saved while the task was still published).
 */
describe('ЕГЭ 2027 Ященко: needs_review tasks are excluded from every student scenario', () => {
  let testDb: Awaited<ReturnType<typeof createImported2027TestDb>>;
  let app: ReturnType<typeof buildApp>;
  let hidden: { id: string; variant: number; position: number }[];
  let hiddenIds: Set<string>;
  let variantIds: string[];
  let user: { id: string; cookie: string };

  const COLLECTION = 'ege-2027-yashchenko';

  async function sessionFor(userId: string) {
    const id = randomUUID();
    await testDb.db
      .insert(schema.authSessions)
      .values({ id, userId, expiresAt: new Date(Date.now() + 3_600_000) });
    return `session_id=${id}`;
  }

  /** Fails with the leaked ids, so a regression names the tasks. */
  function expectNoHidden(body: unknown, where: string) {
    const text = JSON.stringify(body);
    const leaked = [...hiddenIds].filter((id) => text.includes(id));
    expect(leaked, where).toEqual([]);
  }

  async function get(url: string, cookie?: string) {
    const res = await app.inject({ method: 'GET', url, headers: cookie ? { cookie } : {} });
    return res;
  }

  beforeAll(async () => {
    testDb = await createImported2027TestDb();
    app = buildApp({
      version: 'test',
      db: testDb.db,
      authConfig: loadConfig({ NODE_ENV: 'test' }),
    });

    const rows = await testDb.db
      .select({
        id: schema.tasks.id,
        status: schema.tasks.status,
        variant: schema.variants.variantNumber,
        variantId: schema.variants.id,
        position: schema.variantTasks.position,
      })
      .from(schema.variantTasks)
      .innerJoin(schema.tasks, eq(schema.variantTasks.taskId, schema.tasks.id))
      .innerJoin(schema.variants, eq(schema.variantTasks.variantId, schema.variants.id))
      .innerJoin(schema.collections, eq(schema.variants.collectionId, schema.collections.id))
      .where(eq(schema.collections.slug, COLLECTION))
      .orderBy(asc(schema.variants.variantNumber), asc(schema.variantTasks.position));
    hidden = rows.filter((r) => r.status === 'needs_review');
    hiddenIds = new Set(hidden.map((r) => r.id));
    variantIds = [...new Set(rows.map((r) => r.variantId))];

    const [u] = await testDb.db.insert(schema.users).values({}).returning();
    user = { id: u!.id, cookie: await sessionFor(u!.id) };
  });

  afterAll(async () => {
    await app.close();
    await testDb.close();
  });

  it('the 2027 collection holds exactly the 11 tasks the audit left on review', () => {
    expect(variantIds).toHaveLength(25);
    expect(hidden.map((h) => `${h.variant}:${h.position}`)).toEqual([
      '1:17',
      '2:17',
      '4:15',
      '5:17',
      '6:17',
      '9:9',
      '10:9',
      '14:18',
      '15:17',
      '16:17',
      '17:17',
      '18:17',
    ]);
  });

  it('task lists (by number, by collection, by variant) never contain them', async () => {
    for (let n = 1; n <= 20; n++) {
      let cursor: string | null = null;
      do {
        const q = `/api/v1/tasks?subject=math&taskNumber=${n}&collection=${COLLECTION}&limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
        const res = await get(q);
        expect(res.statusCode).toBe(200);
        const body = res.json();
        expectNoHidden(body, q);
        cursor = body.nextCursor;
      } while (cursor);
    }
    for (const v of variantIds) {
      const res = await get(`/api/v1/tasks?subject=math&variant=${v}&limit=100`);
      expectNoHidden(res.json(), `variant ${v}`);
    }
    // The status filter can't be used to reach them either.
    expect((await get('/api/v1/tasks?subject=math&status=needs_review')).statusCode).toBe(400);
  });

  it('random tasks, counts and variants skip them', async () => {
    for (const n of [9, 15, 17, 18]) {
      for (let i = 0; i < 25; i++) {
        const res = await get(
          `/api/v1/tasks/random?subject=math&collection=${COLLECTION}&taskNumber=${n}`,
        );
        expectNoHidden(res.json(), `random №${n}`);
      }
    }
    expectNoHidden((await get(`/api/v1/tasks/counts?collection=${COLLECTION}`)).json(), 'counts');
    for (const v of variantIds) {
      const res = await get(`/api/v1/variants/${v}`);
      expect(res.statusCode).toBe(200);
      expectNoHidden(res.json(), `variant ${v}`);
    }
  });

  it('similar tasks of their published neighbours skip them', async () => {
    for (const h of hidden) {
      const [neighbour] = await testDb.db
        .select({ id: schema.tasks.id })
        .from(schema.tasks)
        .where(
          and(
            eq(schema.tasks.subjectId, 'math'),
            eq(schema.tasks.taskNumber, h.position),
            eq(schema.tasks.status, 'published'),
          ),
        )
        .limit(1);
      const res = await get(`/api/v1/tasks/${neighbour!.id}/similar`);
      expectNoHidden(res.json(), `similar of a №${h.position}`);
    }
  });

  it('smart training, variant sessions, recommendations and the path skip them', async () => {
    for (let round = 0; round < 6; round++) {
      const start = await app.inject({
        method: 'POST',
        url: '/api/v1/me/learning/sessions',
        headers: { cookie: user.cookie },
        payload: { subjectId: 'math', limit: 10, randomizeTopTier: true },
      });
      expect(start.statusCode).toBe(200);
      expectNoHidden(start.json(), 'smart session start');
      const sessionId = start.json().id ?? start.json().sessionId;
      for (let i = 0; i < 12; i++) {
        const next = await get(`/api/v1/me/learning/sessions/${sessionId}/next`, user.cookie);
        expectNoHidden(next.json(), 'smart session next');
        if (next.statusCode !== 200) break;
      }
    }
    for (const v of variantIds) {
      const start = await app.inject({
        method: 'POST',
        url: '/api/v1/me/learning/sessions/variant',
        headers: { cookie: user.cookie },
        payload: { variantId: v },
      });
      expect(start.statusCode).toBe(200);
      expectNoHidden(start.json(), 'variant session start');
      const sessionId = start.json().id ?? start.json().sessionId;
      for (let i = 0; i < 21; i++) {
        const next = await get(`/api/v1/me/learning/sessions/${sessionId}/next`, user.cookie);
        expectNoHidden(next.json(), 'variant session next');
        if (next.statusCode !== 200) break;
      }
    }
    expectNoHidden((await get('/api/v1/me/learning/next-task', user.cookie)).json(), 'next-task');
    expectNoHidden((await get('/api/v1/me/learning/path', user.cookie)).json(), 'path');
  });

  it('a hidden task cannot be opened, answered or favorited by id', async () => {
    for (const h of hidden) {
      expect((await get(`/api/v1/tasks/${h.id}`, user.cookie)).statusCode).toBe(404);
      const attempt = await app.inject({
        method: 'POST',
        url: `/api/v1/tasks/${h.id}/attempt`,
        headers: { cookie: user.cookie },
        payload: { answer: '1' },
      });
      expect(attempt.statusCode).toBe(404);
      const fav = await app.inject({
        method: 'POST',
        url: '/api/v1/favorites',
        headers: { cookie: user.cookie },
        payload: { taskId: h.id },
      });
      expect(fav.statusCode).toBe(404);
    }
  });

  it('mistakes and favorites saved while a task was published are not shown once it is on review', async () => {
    const [u] = await testDb.db.insert(schema.users).values({}).returning();
    const cookie = await sessionFor(u!.id);
    const h = hidden.find((x) => x.variant === 4)!; // В4 №15, published before this audit
    const [attempt] = await testDb.db
      .insert(schema.attempts)
      .values({ userId: u!.id, taskId: h.id, answerRaw: '0', isCorrect: false })
      .returning();
    await testDb.db.insert(schema.mistakes).values({
      userId: u!.id,
      taskId: h.id,
      firstAttemptId: attempt!.id,
      lastAttemptId: attempt!.id,
    });
    await testDb.db.insert(schema.favorites).values({ userId: u!.id, taskId: h.id });

    expectNoHidden((await get('/api/v1/mistakes', cookie)).json(), 'mistakes');
    expectNoHidden((await get('/api/v1/favorites', cookie)).json(), 'favorites');
    expectNoHidden((await get('/api/v1/progress/by-task-number', cookie)).json(), 'progress');
    expectNoHidden((await get('/api/v1/leaderboard', cookie)).json(), 'leaderboard');
  });
});
