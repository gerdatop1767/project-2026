import { randomUUID } from 'node:crypto';
import { schema } from '@zybrilka/db';
import { createFullContentTestDb } from '@zybrilka/db/testing';
import type { ProgressPeriodResponse } from '@zybrilka/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { getPeriodStats } from './period.js';

/**
 * «Статистика за период»: totals, per-subject numbers and the chart all
 * come from the same range, in the student's timezone, empty days included.
 */
describe('progress for a period', () => {
  let testDb: Awaited<ReturnType<typeof createFullContentTestDb>>;
  let app: ReturnType<typeof buildApp>;
  let mathTasks: { id: string }[];
  let russianTasks: { id: string }[];

  beforeAll(async () => {
    testDb = await createFullContentTestDb();
    app = buildApp({
      version: 'test',
      db: testDb.db,
      authConfig: loadConfig({ NODE_ENV: 'test' }),
    });
    mathTasks = await testDb.db
      .select({ id: schema.tasks.id })
      .from(schema.tasks)
      .where(and(eq(schema.tasks.subjectId, 'math'), eq(schema.tasks.status, 'published')))
      .limit(10);
    russianTasks = await testDb.db
      .select({ id: schema.tasks.id })
      .from(schema.tasks)
      .where(and(eq(schema.tasks.subjectId, 'russian'), eq(schema.tasks.status, 'published')))
      .limit(10);
  }, 300_000);
  afterAll(async () => {
    await app.close();
    await testDb.close();
  });

  async function student() {
    const [user] = await testDb.db.insert(schema.users).values({}).returning();
    const sid = randomUUID();
    await testDb.db
      .insert(schema.authSessions)
      .values({ id: sid, userId: user!.id, expiresAt: new Date(Date.now() + 3_600_000) });
    return { userId: user!.id, cookie: `session_id=${sid}` };
  }
  const answerAt = (userId: string, taskId: string, at: Date, isCorrect: boolean, ms?: number) =>
    testDb.db.insert(schema.attempts).values({
      userId,
      taskId,
      answerRaw: 'x',
      isCorrect,
      createdAt: at,
      ...(ms ? { timeSpentMs: ms } : {}),
    });

  // «Now»: 19 Nov 2026, 10:00 UTC = 13:00 in Moscow.
  const NOW = new Date('2026-11-19T10:00:00Z');
  const daysAgo = (n: number, hourUtc = 9) => new Date(Date.UTC(2026, 10, 19 - n, hourUtc, 0, 0));

  it('every number follows the period: 7, 15, 30, 90 days and all time differ as the answers do', async () => {
    const { userId } = await student();
    await answerAt(userId, mathTasks[0]!.id, daysAgo(1), true, 60_000); // in 7d
    await answerAt(userId, mathTasks[1]!.id, daysAgo(3), false, 120_000); // in 7d
    await answerAt(userId, mathTasks[2]!.id, daysAgo(10), true); // in 15d
    await answerAt(userId, russianTasks[0]!.id, daysAgo(20), true); // in 30d
    await answerAt(userId, mathTasks[3]!.id, daysAgo(60), false); // in 90d
    await answerAt(userId, mathTasks[4]!.id, daysAgo(200), true); // all time only

    const get = (period: ProgressPeriodResponse['period']) =>
      getPeriodStats(testDb.db, userId, { period, timezone: 'Europe/Moscow', now: NOW });
    const d7 = await get('7d');
    expect(d7).toMatchObject({ from: '2026-11-13', to: '2026-11-19', granularity: 'day' });
    expect(d7.totals).toMatchObject({
      answers: 2,
      correct: 1,
      wrong: 1,
      accuracyPercent: 50,
      solvedTasks: 1,
      attemptedTasks: 2,
      activeDays: 2,
      timeSpentMs: 180_000,
      averageTimeMs: 90_000,
    });
    expect(d7.buckets).toHaveLength(7);
    expect(d7.buckets.reduce((s, b) => s + b.answers, 0)).toBe(2);
    // Days without answers are there, with zeros and no accuracy.
    expect(d7.buckets.find((b) => b.start === '2026-11-19')).toMatchObject({
      answers: 0,
      accuracyPercent: null,
    });

    const d15 = await get('15d');
    expect(d15.totals.answers).toBe(3);
    expect(d15.buckets).toHaveLength(15);
    const d30 = await get('30d');
    expect(d30.totals.answers).toBe(4);
    expect(d30.bySubject.map((s) => [s.subjectId, s.answers])).toEqual([
      ['math', 3],
      ['russian', 1],
    ]);
    const d90 = await get('90d');
    expect(d90.totals.answers).toBe(5);
    expect(d90.buckets).toHaveLength(90);
    const all = await get('all');
    expect(all.totals.answers).toBe(6);
    expect(all.from).toBe('2026-05-03');
    expect(all.granularity).toBe('week');
    expect(all.buckets.reduce((s, b) => s + b.answers, 0)).toBe(6);
    // The subject filter scopes totals and chart, never the per-subject list.
    const math30 = await getPeriodStats(testDb.db, userId, {
      period: '30d',
      subjectId: 'math',
      timezone: 'Europe/Moscow',
      now: NOW,
    });
    expect(math30.totals.answers).toBe(3);
    expect(math30.buckets.reduce((s, b) => s + b.answers, 0)).toBe(3);
    expect(math30.bySubject).toHaveLength(2);
  });

  it('days are the student’s own: an answer at 23:30 UTC is «tomorrow» in Moscow', async () => {
    const { userId } = await student();
    // 18 Nov 23:30 UTC = 19 Nov 02:30 in Moscow.
    await answerAt(userId, mathTasks[5]!.id, new Date('2026-11-18T23:30:00Z'), true);
    const moscow = await getPeriodStats(testDb.db, userId, {
      period: '7d',
      timezone: 'Europe/Moscow',
      now: NOW,
    });
    const utc = await getPeriodStats(testDb.db, userId, {
      period: '7d',
      timezone: 'UTC',
      now: NOW,
    });
    expect(moscow.buckets.find((b) => b.answers > 0)!.start).toBe('2026-11-19');
    expect(utc.buckets.find((b) => b.answers > 0)!.start).toBe('2026-11-18');
    // The range edge: 7 days ending today in Vladivostok (UTC+10) start a day later.
    const vlad = await getPeriodStats(testDb.db, userId, {
      period: '7d',
      timezone: 'Asia/Vladivostok',
      now: new Date('2026-11-19T15:00:00Z'), // 01:00 on 20 Nov there
    });
    expect(vlad).toMatchObject({ from: '2026-11-14', to: '2026-11-20' });
  });

  it('no activity: zeros, no accuracy, an empty but complete chart', async () => {
    const { userId } = await student();
    const empty = await getPeriodStats(testDb.db, userId, { period: '30d', now: NOW });
    expect(empty.totals).toMatchObject({
      answers: 0,
      accuracyPercent: null,
      averageTimeMs: null,
      activeDays: 0,
    });
    expect(empty.buckets).toHaveLength(30);
    expect(empty.bySubject).toEqual([]);
    const all = await getPeriodStats(testDb.db, userId, { period: 'all', now: NOW });
    expect(all.from).toBe(all.to);
    expect(all.buckets).toHaveLength(1);
  });

  it('the route: own data only, validated period and timezone, never cached', async () => {
    const a = await student();
    await answerAt(a.userId, mathTasks[6]!.id, new Date(), true);
    const b = await student();
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/progress/period?period=7d&tz=Europe/Moscow',
      headers: { cookie: a.cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect((res.json() as ProgressPeriodResponse).totals.answers).toBe(1);
    const other = await app.inject({
      method: 'GET',
      url: '/api/v1/progress/period?period=7d',
      headers: { cookie: b.cookie },
    });
    expect((other.json() as ProgressPeriodResponse).totals.answers).toBe(0);
    for (const q of ['period=8d', 'period=7d&tz=Mars/Base', 'period=7d&tz=%27;drop']) {
      const bad = await app.inject({
        method: 'GET',
        url: `/api/v1/progress/period?${q}`,
        headers: { cookie: a.cookie },
      });
      expect(bad.statusCode, q).toBe(400);
    }
  });
});
