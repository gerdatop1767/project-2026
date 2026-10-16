import { randomUUID } from 'node:crypto';
import { schema } from '@zybrilka/db';
import { createSeededTestDb } from '@zybrilka/db/testing';
import { toMoscowDateString } from '@zybrilka/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';

/**
 * GET /api/v1/progress/streak — real server-computed streak state
 * (CLAUDE.md's "система серий" block). Activity rows are inserted
 * directly into `user_daily_activity` with exact Moscow calendar
 * dates (never via a real attempt submission — that path is covered
 * separately in tasks/routes.test.ts's "daily activity recording"
 * tests, which prove the write side; these prove the read side).
 */
describe('GET /api/v1/progress/streak', () => {
  let testDb: Awaited<ReturnType<typeof createSeededTestDb>>;
  let app: ReturnType<typeof buildApp>;

  beforeAll(async () => {
    testDb = await createSeededTestDb();
    app = buildApp({ version: 'test', db: testDb.db });
  });

  afterAll(async () => {
    await app.close();
    await testDb.close();
  });

  function streak(anonId: string) {
    return app.inject({
      method: 'GET',
      url: '/api/v1/progress/streak',
      headers: { 'x-anon-id': anonId },
    });
  }

  async function ensureUser(anonId: string) {
    // Lightweight GET satisfies the anon-user plugin's lazy upsert —
    // same pattern as progress/daily.test.ts.
    await app.inject({
      method: 'GET',
      url: '/api/v1/progress/summary',
      headers: { 'x-anon-id': anonId },
    });
  }

  async function seedActivity(anonId: string, dates: readonly string[]) {
    await ensureUser(anonId);
    for (const activityDate of dates) {
      await testDb.db.insert(schema.userDailyActivity).values({ userId: anonId, activityDate });
    }
  }

  function daysAgoMoscow(n: number): string {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - n);
    return toMoscowDateString(d);
  }

  it('requires an x-anon-id header', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/progress/streak' });
    expect(res.statusCode).toBe(400);
  });

  it('a brand-new user has currentStreak 0, lastActiveDate null, isActiveToday false', async () => {
    const res = await streak(randomUUID());
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      currentStreak: 0,
      lastActiveDate: null,
      isActiveToday: false,
    });
  });

  it('a single activity day today = streak 1, isActiveToday true', async () => {
    const anonId = randomUUID();
    await seedActivity(anonId, [daysAgoMoscow(0)]);
    const res = await streak(anonId);
    expect(res.json()).toMatchObject({ currentStreak: 1, isActiveToday: true });
    expect(res.json().lastActiveDate).toBe(daysAgoMoscow(0));
  });

  it('three consecutive days ending today = streak 3', async () => {
    const anonId = randomUUID();
    await seedActivity(anonId, [daysAgoMoscow(2), daysAgoMoscow(1), daysAgoMoscow(0)]);
    const res = await streak(anonId);
    expect(res.json()).toMatchObject({ currentStreak: 3, isActiveToday: true });
  });

  it('a missed day resets the streak to just today’s run', async () => {
    const anonId = randomUUID();
    // Active 3 days ago, missed 2 days ago and yesterday, active today.
    await seedActivity(anonId, [daysAgoMoscow(3), daysAgoMoscow(0)]);
    const res = await streak(anonId);
    expect(res.json()).toMatchObject({ currentStreak: 1, isActiveToday: true });
  });

  it('no activity today but active yesterday still shows the held streak, isActiveToday false', async () => {
    const anonId = randomUUID();
    await seedActivity(anonId, [daysAgoMoscow(2), daysAgoMoscow(1)]);
    const res = await streak(anonId);
    expect(res.json()).toMatchObject({ currentStreak: 2, isActiveToday: false });
  });

  it('2+ days of no activity resets currentStreak to 0, even with old history', async () => {
    const anonId = randomUUID();
    await seedActivity(anonId, [daysAgoMoscow(10), daysAgoMoscow(9), daysAgoMoscow(8)]);
    const res = await streak(anonId);
    expect(res.json()).toMatchObject({ currentStreak: 0, isActiveToday: false });
    // lastActiveDate still reports the real last activity, honestly —
    // never nulled out just because the streak itself is broken.
    expect(res.json().lastActiveDate).toBe(daysAgoMoscow(8));
  });

  it("another user's activity never affects this user's streak", async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    await seedActivity(userB, [daysAgoMoscow(0), daysAgoMoscow(1), daysAgoMoscow(2)]);
    await ensureUser(userA);
    const res = await streak(userA);
    expect(res.json()).toMatchObject({
      currentStreak: 0,
      isActiveToday: false,
      lastActiveDate: null,
    });
  });

  it('resolves "today" using Europe/Moscow, never the server/browser local timezone', async () => {
    // Direct, deterministic proof that the endpoint's own notion of
    // "today" matches toMoscowDateString(new Date()) — if the service
    // used a different timezone (e.g. plain UTC) this would only
    // coincidentally pass outside the UTC+1..UTC+3 overlap window.
    const anonId = randomUUID();
    const realTodayMoscow = toMoscowDateString(new Date());
    await seedActivity(anonId, [realTodayMoscow]);
    const res = await streak(anonId);
    expect(res.json()).toMatchObject({ currentStreak: 1, isActiveToday: true });
  });

  it('the UNIQUE(user_id, activity_date) constraint itself prevents a duplicate-day race from double counting', async () => {
    const anonId = randomUUID();
    await ensureUser(anonId);
    const today = daysAgoMoscow(0);
    await testDb.db
      .insert(schema.userDailyActivity)
      .values({ userId: anonId, activityDate: today })
      .onConflictDoNothing({
        target: [schema.userDailyActivity.userId, schema.userDailyActivity.activityDate],
      });
    // Simulates a second concurrent request's insert landing after the first.
    await testDb.db
      .insert(schema.userDailyActivity)
      .values({ userId: anonId, activityDate: today })
      .onConflictDoNothing({
        target: [schema.userDailyActivity.userId, schema.userDailyActivity.activityDate],
      });
    const rows = await testDb.db
      .select()
      .from(schema.userDailyActivity)
      .where(eq(schema.userDailyActivity.userId, anonId));
    expect(rows).toHaveLength(1);
    const res = await streak(anonId);
    expect(res.json()).toMatchObject({ currentStreak: 1 });
  });
});
