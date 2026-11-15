import { randomUUID } from 'node:crypto';
import { schema } from '@zybrilka/db';
import { createFullContentTestDb } from '@zybrilka/db/testing';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../../app.js';
import { loadConfig } from '../../../config.js';
import { RATINGS_PER_MINUTE } from './service.js';

type TaskRow = typeof schema.tasks.$inferSelect;

describe('difficulty ratings 1–10 (production auth)', () => {
  let testDb: Awaited<ReturnType<typeof createFullContentTestDb>>;
  let app: ReturnType<typeof buildApp>;
  let pool: TaskRow[];
  let next = 0;

  beforeAll(async () => {
    testDb = await createFullContentTestDb();
    app = buildApp({
      version: 'test',
      db: testDb.db,
      authConfig: loadConfig({ NODE_ENV: 'test' }),
    });
    pool = await testDb.db
      .select()
      .from(schema.tasks)
      .where(
        and(eq(schema.tasks.status, 'published'), eq(schema.tasks.answerType, 'short_answer')),
      );
  });
  afterAll(async () => {
    await app.close();
    await testDb.close();
  });

  const task = () => pool[next++]!;
  async function account() {
    const [user] = await testDb.db.insert(schema.users).values({}).returning();
    const sessionId = randomUUID();
    await testDb.db
      .insert(schema.authSessions)
      .values({ id: sessionId, userId: user!.id, expiresAt: new Date(Date.now() + 3_600_000) });
    return { userId: user!.id, cookie: `session_id=${sessionId}` };
  }
  const attempt = (t: TaskRow, cookie: string) =>
    app.inject({
      method: 'POST',
      url: `/api/v1/tasks/${t.id}/attempt`,
      headers: { cookie },
      payload: { answer: 'x' },
    });
  const rate = (t: TaskRow | string, cookie: string | null, rating: unknown) =>
    app.inject({
      method: 'PUT',
      url: `/api/v1/tasks/${typeof t === 'string' ? t : t.id}/difficulty-rating`,
      headers: cookie ? { cookie } : {},
      payload: { rating },
    });
  const rows = (t: TaskRow) =>
    testDb.db
      .select()
      .from(schema.taskDifficultyRatings)
      .where(eq(schema.taskDifficultyRatings.taskId, t.id));

  it('every value 1..10 is accepted after an answer; anything else is 400', async () => {
    const { cookie } = await account();
    for (let v = 1; v <= 10; v++) {
      const t = task();
      await attempt(t, cookie);
      const res = await rate(t, cookie, v);
      expect(res.statusCode, `rating ${v}`).toBe(200);
      expect(res.json().myRating).toBe(v);
    }
    const t = task();
    await attempt(t, cookie);
    for (const bad of [0, 11, 5.5, '7', null])
      expect((await rate(t, cookie, bad)).statusCode).toBe(400);
  });

  it('changing a rating updates the one row; re-sending it is not a duplicate', async () => {
    const { userId, cookie } = await account();
    const t = task();
    await attempt(t, cookie);
    await rate(t, cookie, 3);
    await rate(t, cookie, 8);
    await rate(t, cookie, 8);
    await Promise.all([rate(t, cookie, 8), rate(t, cookie, 8)]);
    const mine = (await rows(t)).filter((r) => r.userId === userId);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.rating).toBe(8);
  });

  it('no rating without an answer, for a guest, or for an unknown task', async () => {
    const { cookie } = await account();
    const t = task();
    expect((await rate(t, cookie, 5)).statusCode).toBe(409);
    expect((await rate(t, null, 5)).statusCode).toBe(401);
    expect((await rate(randomUUID(), cookie, 5)).statusCode).toBe(404);
    expect((await rate('not-a-uuid', cookie, 5)).statusCode).toBe(400);
    expect(await rows(t)).toHaveLength(0);
  });

  it('a student changes only their own rating; mass spam is limited', async () => {
    const a = await account();
    const b = await account();
    const t = task();
    await attempt(t, a.cookie);
    await attempt(t, b.cookie);
    await rate(t, a.cookie, 2);
    await rate(t, b.cookie, 9);
    expect((await rows(t)).map((r) => r.rating).sort()).toEqual([2, 9]);

    const spammer = await account();
    const many = pool.slice(next, next + RATINGS_PER_MINUTE + 1);
    next += many.length;
    for (const m of many) await attempt(m, spammer.cookie);
    const codes = [];
    for (const m of many) codes.push((await rate(m, spammer.cookie, 5)).statusCode);
    expect(codes.slice(0, RATINGS_PER_MINUTE).every((c) => c === 200)).toBe(true);
    expect(codes.at(-1)).toBe(429);
  });

  it('community difficulty: hidden below 5 ratings, robust median above, own rating kept apart', async () => {
    const t = task();
    const students = await Promise.all(Array.from({ length: 7 }, () => account()));
    for (const s of students) await attempt(t, s.cookie);
    const values = [8, 8, 7, 9];
    for (let i = 0; i < values.length; i++) await rate(t, students[i]!.cookie, values[i]);
    // 4 ratings: not shown yet — no false precision.
    expect((await rate(t, students[0]!.cookie, 8)).json().community).toMatchObject({
      count: 4,
      median: null,
      confident: false,
    });
    await rate(t, students[4]!.cookie, 8);
    // A lone «1» is an outlier: dropped, the median stays 8.
    let res = (await rate(t, students[5]!.cookie, 1)).json();
    expect(res.community).toMatchObject({ count: 6, used: 5, confident: true, median: 8 });
    expect(res.myRating).toBe(1);
    res = (
      await app.inject({
        method: 'GET',
        url: `/api/v1/tasks/${t.id}/difficulty-rating`,
        headers: { cookie: students[6]!.cookie },
      })
    ).json();
    expect(res.myRating).toBeNull();
    expect(res.community.median).toBe(8);
  });

  it('a rating changes no XP, no attempt and no correctness', async () => {
    const { userId, cookie } = await account();
    const t = task();
    await attempt(t, cookie);
    const xp = async () =>
      (await testDb.db.select().from(schema.xpEvents).where(eq(schema.xpEvents.userId, userId)))
        .length;
    const attempts = async () =>
      (await testDb.db.select().from(schema.attempts).where(eq(schema.attempts.userId, userId)))
        .length;
    const [x0, a0] = [await xp(), await attempts()];
    await rate(t, cookie, 10);
    expect([await xp(), await attempts()]).toEqual([x0, a0]);
  });
});
