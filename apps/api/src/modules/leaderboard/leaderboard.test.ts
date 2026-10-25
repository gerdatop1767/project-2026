import { randomUUID } from 'node:crypto';
import { schema } from '@zybrilka/db';
import { createTestDb } from '@zybrilka/db/testing';
import { leaderboardQuerySchema, leaderboardResponseSchema } from '@zybrilka/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { getLeaderboard, periodStart, publicName } from './service.js';

const NOW = new Date('2026-10-24T12:00:00Z'); // 15:00 in Moscow
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);
const daysAgo = (d: number) => hoursAgo(d * 24);

describe('leaderboard', () => {
  let testDb: Awaited<ReturnType<typeof createTestDb>>;
  let app: ReturnType<typeof buildApp>;
  const task: Record<string, string> = {};
  const user: Record<string, string> = {};

  async function addUser(key: string, profile: Partial<typeof schema.users.$inferInsert> = {}) {
    const [row] = await testDb.db.insert(schema.users).values(profile).returning();
    user[key] = row!.id;
  }

  /** One graded answer and, when correct, its XP — the way the API records them. */
  async function answer(key: string, taskKey: string, correct: boolean, at: Date, xp = 0) {
    const [attempt] = await testDb.db
      .insert(schema.attempts)
      .values({
        userId: user[key]!,
        taskId: task[taskKey]!,
        answerRaw: correct ? '1' : '0',
        isCorrect: correct,
        createdAt: at,
      })
      .returning();
    if (xp > 0) {
      await testDb.db.insert(schema.xpEvents).values({
        userId: user[key]!,
        amount: xp,
        kind: 'task_first_solve',
        sourceType: 'task',
        sourceId: task[taskKey]!,
        attemptId: attempt!.id,
        dedupKey: `task:${task[taskKey]}:${randomUUID()}`,
        createdAt: at,
      });
    }
  }

  async function setTotal(key: string, totalXp: number) {
    await testDb.db
      .insert(schema.userXp)
      .values({ userId: user[key]!, totalXp })
      .onConflictDoUpdate({ target: schema.userXp.userId, set: { totalXp } });
  }

  const board = (key: string, q: Record<string, unknown> = {}) =>
    getLeaderboard(testDb.db, user[key]!, leaderboardQuerySchema.parse(q), NOW);

  beforeAll(async () => {
    testDb = await createTestDb();
    app = buildApp({
      version: 'test',
      db: testDb.db,
      authConfig: loadConfig({ NODE_ENV: 'test' }),
    });
    await testDb.db.insert(schema.subjects).values([
      { id: 'math', name: 'Математика' },
      { id: 'russian', name: 'Русский язык' },
    ]);
    for (const [key, subjectId] of [
      ['m1', 'math'],
      ['m2', 'math'],
      ['m3', 'math'],
      ['r1', 'russian'],
    ] as const) {
      const [row] = await testDb.db
        .insert(schema.tasks)
        .values({
          subjectId,
          taskNumber: 1,
          difficulty: 2,
          conditionMd: `leaderboard ${key}`,
          correctAnswer: '1',
          explanationMd: '-',
          source: 'test',
          status: 'published',
        })
        .returning();
      task[key] = row!.id;
    }
    await addUser('anna', {
      firstName: 'Анна',
      lastName: 'Смирнова',
      avatarUrl: 'https://x/a.jpg',
    });
    await addUser('boris', { displayName: 'Боря-математик', firstName: 'Борис', lastName: 'Ли' });
    await addUser('vera', { firstName: 'Вера' });
    await addUser('nobody', {});
    await addUser('newbie', { firstName: 'Новичок' });

    // Anna: 3 tasks today (one wrong first), 40 XP; plus old Russian XP.
    await answer('anna', 'm1', false, hoursAgo(2));
    await answer('anna', 'm1', true, hoursAgo(1), 10);
    await answer('anna', 'm2', true, hoursAgo(1), 10);
    await answer('anna', 'r1', true, hoursAgo(3), 20);
    await answer('anna', 'm3', true, daysAgo(30), 100);
    await setTotal('anna', 140);
    // Boris: 40 XP three days ago (week, not today), all math.
    await answer('boris', 'm1', true, daysAgo(3), 20);
    await answer('boris', 'm2', true, daysAgo(3), 20);
    await setTotal('boris', 700);
    // Vera: 20 XP today in Russian — ties nobody.
    await answer('vera', 'r1', true, hoursAgo(5), 20);
    await setTotal('vera', 20);
    // «nobody» has no name at all; 15 XP today.
    await answer('nobody', 'm3', true, hoursAgo(4), 15);
    await setTotal('nobody', 15);
    // newbie: only a wrong answer — no points, not ranked.
    await answer('newbie', 'm1', false, hoursAgo(1));
  });
  afterAll(async () => {
    await testDb.close();
  });

  it('periods: today from Moscow midnight, week = last 7 days, all = no bound', () => {
    expect(periodStart('today', NOW)!.toISOString()).toBe('2026-10-23T21:00:00.000Z');
    expect(periodStart('week', NOW)!.toISOString()).toBe('2026-10-17T12:00:00.000Z');
    expect(periodStart('all', NOW)).toBeNull();
  });

  it('today: ranked by XP earned today, with solved and accuracy from the same day', async () => {
    const r = await board('anna', { period: 'today' });
    expect(r.entries.map((e) => [e.rank, e.name, e.points])).toEqual([
      [1, 'Анна С.', 40],
      [2, 'Вера', 20],
      [3, 'Участник', 15],
    ]);
    expect(r.entries[0]).toMatchObject({ solved: 3, accuracyPercent: 75, isMe: true, level: 3 });
    expect(r.participants).toBe(3);
    expect(r.me).toMatchObject({ rank: 1, points: 40, solved: 3, accuracyPercent: 75 });
    expect(r.since).toBe('2026-10-23T21:00:00.000Z');
  });

  it('week includes Boris (3 days ago); equal points share a rank', async () => {
    const r = await board('boris', { period: 'week' });
    expect(r.entries.map((e) => e.rank)).toEqual([1, 1, 3, 4]);
    // The order within a tie is stable but not meaningful: compare as a set.
    expect(new Set(r.entries.slice(0, 2).map((e) => `${e.name}:${e.points}`))).toEqual(
      new Set(['Анна С.:40', 'Боря-математик:40']),
    );
    expect(r.entries.slice(2).map((e) => [e.name, e.points])).toEqual([
      ['Вера', 20],
      ['Участник', 15],
    ]);
    expect(r.entries.find((e) => e.isMe)!.name).toBe('Боря-математик');
    expect(r.me.rank).toBe(1);
  });

  it('all time counts every event', async () => {
    const r = await board('vera', { period: 'all' });
    expect(r.entries.map((e) => [e.name, e.points])).toEqual([
      ['Анна С.', 140],
      ['Боря-математик', 40],
      ['Вера', 20],
      ['Участник', 15],
    ]);
    expect(r.me).toMatchObject({ rank: 3 });
  });

  it('a subject filter counts only that subject’s XP, solved tasks and answers', async () => {
    const r = await board('anna', { period: 'today', subject: 'math' });
    expect(r.entries.map((e) => [e.name, e.points, e.solved, e.accuracyPercent])).toEqual([
      ['Анна С.', 20, 2, 67],
      ['Участник', 15, 1, 100],
    ]);
    const russian = await board('anna', { period: 'all', subject: 'russian' });
    expect(new Set(russian.entries.map((e) => `${e.name}:${e.points}`))).toEqual(
      new Set(['Анна С.:20', 'Вера:20']),
    );
    expect(russian.entries.map((e) => e.rank)).toEqual([1, 1]);
    expect((await board('anna', { subject: 'physics' })).entries).toEqual([]);
  });

  it('someone with no points is not ranked but still gets their own numbers', async () => {
    const r = await board('newbie', { period: 'today' });
    expect(r.entries.some((e) => e.isMe)).toBe(false);
    expect(r.me).toEqual({ rank: null, level: 1, points: 0, solved: 0, accuracyPercent: 0 });
  });

  it('the limit cuts the list but «me» keeps the real rank; limit 0 returns only «me»', async () => {
    const r = await board('nobody', { period: 'all', limit: 2 });
    expect(r.entries).toHaveLength(2);
    expect(r.me.rank).toBe(4);
    expect(r.participants).toBe(4);
    const onlyMe = await board('nobody', { period: 'all', limit: 0 });
    expect(onlyMe.entries).toEqual([]);
    expect(onlyMe.me.rank).toBe(4);
  });

  it('public names never reveal more than a last-name initial', () => {
    expect(publicName({ displayName: null, firstName: 'Анна', lastName: 'Смирнова' })).toBe(
      'Анна С.',
    );
    expect(publicName({ displayName: 'Ник', firstName: 'Анна', lastName: 'Смирнова' })).toBe('Ник');
    expect(publicName({ displayName: null, firstName: null, lastName: 'Смирнова' })).toBe(
      'Участник',
    );
  });

  describe('HTTP', () => {
    async function cookieFor(key: string) {
      const id = randomUUID();
      await testDb.db
        .insert(schema.authSessions)
        .values({ id, userId: user[key]!, expiresAt: new Date(Date.now() + 3_600_000) });
      return `session_id=${id}`;
    }

    it('needs an account', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/leaderboard' });
      expect(res.statusCode).toBe(401);
    });

    it('returns the validated shape with no ids, emails or photos', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/leaderboard?period=all',
        headers: { cookie: await cookieFor('anna') },
      });
      expect(res.statusCode).toBe(200);
      const body = leaderboardResponseSchema.parse(res.json());
      expect(body.entries.length).toBe(4);
      const text = res.body;
      for (const id of Object.values(user)) expect(text).not.toContain(id);
      expect(text).not.toContain('Смирнова');
      expect(text).not.toContain('https://x/a.jpg');
      expect(text).not.toMatch(/userId|email|avatarUrl/);
    });

    it('generated avatars: stable per user, varied across users', async () => {
      const ask = async () =>
        leaderboardResponseSchema.parse(
          (
            await app.inject({
              method: 'GET',
              url: '/api/v1/leaderboard?period=all',
              headers: { cookie: await cookieFor('anna') },
            })
          ).json(),
        );
      const first = await ask();
      const second = await ask();
      const pick = (b: typeof first) =>
        b.entries.map((e) => [e.name, e.avatarHue, e.avatarVariant]);
      expect(pick(second)).toEqual(pick(first));
      const looks = new Set(first.entries.map((e) => `${e.avatarHue}:${e.avatarVariant}`));
      expect(looks.size).toBe(first.entries.length);
    });

    it('rejects a bad period, subject or limit', async () => {
      const cookie = await cookieFor('anna');
      for (const q of ['period=month', 'subject=../x', 'limit=500', 'limit=-1']) {
        const res = await app.inject({
          method: 'GET',
          url: `/api/v1/leaderboard?${q}`,
          headers: { cookie },
        });
        expect(res.statusCode, q).toBe(400);
      }
    });
  });
});
