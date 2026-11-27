import { randomUUID } from 'node:crypto';
import { schema, syncTaskSkills } from '@zybrilka/db';
import { createFullContentTestDb } from '@zybrilka/db/testing';
import {
  YASHCHENKO_2027_PROJECT_SOURCE,
  type LearningAnalyticsResponse,
  type LearningOverviewResponse,
  type LearningRecommendationsResponse,
  type SkillState,
} from '@zybrilka/shared';
import { and, eq, inArray, ne } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../../app.js';
import { loadConfig } from '../../../config.js';

type TaskRow = typeof schema.tasks.$inferSelect;
const DAY = 24 * 60 * 60 * 1000;

/**
 * Learning Engine end to end on the real imported content
 * (docs/learning/TESTING.md): answer → attempt → skill → statistics →
 * recommendation → smart training → updated profile.
 */
describe('Learning Engine scenarios (real content, production auth)', () => {
  let testDb: Awaited<ReturnType<typeof createFullContentTestDb>>;
  let app: ReturnType<typeof buildApp>;

  beforeAll(async () => {
    testDb = await createFullContentTestDb();
    await syncTaskSkills(testDb.db); // what the API start does after sync-content
    app = buildApp({
      version: 'test',
      db: testDb.db,
      authConfig: loadConfig({ NODE_ENV: 'test' }),
    });
  }, 300_000); // the full content takes long to import on a busy CI runner
  afterAll(async () => {
    await app.close();
    await testDb.close();
  });

  async function student(profile?: { subjectId: string; targetScore: string }[]) {
    const [user] = await testDb.db.insert(schema.users).values({}).returning();
    const sessionId = randomUUID();
    await testDb.db
      .insert(schema.authSessions)
      .values({ id: sessionId, userId: user!.id, expiresAt: new Date(Date.now() + 3_600_000) });
    const cookie = `session_id=${sessionId}`;
    if (profile) {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/v1/me/learning-profile',
        headers: { cookie },
        payload: {
          subjects: profile.map((p) => ({ ...p, selfReportedScore: 'unknown' })),
        },
      });
      expect(res.statusCode).toBe(200);
    }
    return { userId: user!.id, cookie };
  }
  const get = async <T>(cookie: string, url: string) => {
    const res = await app.inject({ method: 'GET', url: `/api/v1${url}`, headers: { cookie } });
    expect(res.statusCode, url).toBe(200);
    return res.json() as T;
  };
  const answer = (cookie: string, task: TaskRow, value: string, sessionId?: string) =>
    app.inject({
      method: 'POST',
      url: `/api/v1/tasks/${task.id}/attempt`,
      headers: { cookie },
      payload: sessionId ? { answer: value, sessionId } : { answer: value },
    });
  async function tasksOf(subjectId: string, taskNumber: number, n: number) {
    return testDb.db
      .select()
      .from(schema.tasks)
      .where(
        and(
          eq(schema.tasks.subjectId, subjectId),
          eq(schema.tasks.taskNumber, taskNumber),
          eq(schema.tasks.status, 'published'),
          eq(schema.tasks.answerType, 'short_answer'),
          ne(schema.tasks.source, YASHCHENKO_2027_PROJECT_SOURCE),
        ),
      )
      .limit(n);
  }
  const skill = (o: LearningOverviewResponse, key: string): SkillState =>
    o.subjects.flatMap((s) => s.skills).find((s) => s.key === key)!;

  it('1/19. a new student with no answers: honest «no data», concrete first steps', async () => {
    const { cookie } = await student();
    const o = await get<LearningOverviewResponse>(cookie, '/me/learning/overview');
    expect(o.hasProfile).toBe(false);
    expect(o.subjects.map((s) => s.subjectId)).toEqual(['math', 'russian']);
    for (const s of o.subjects.flatMap((x) => x.skills)) {
      expect(s.level).toBe('none');
      expect(s.attempts).toBe(0);
    }
    const r = await get<LearningRecommendationsResponse>(cookie, '/me/learning/recommendations');
    expect(r.recommendations.length).toBeGreaterThan(0);
    for (const rec of r.recommendations) {
      expect(rec.kind).toBe('unexplored');
      expect(rec.taskIds.length).toBeGreaterThan(0);
    }
    const a = await get<LearningAnalyticsResponse>(
      cookie,
      '/me/learning/analytics?subject=russian',
    );
    expect(a.periods.all).toEqual({ attempts: 0, correct: 0, accuracy: null, solvedTasks: 0 });
    expect(a.weak).toEqual([]);
    expect(a.insufficient.length).toBe(27);
  });

  it('18. a guest has no personal learning data (401), and nothing is stored', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/me/learning/overview' });
    expect(res.statusCode).toBe(401);
  });

  it('3/20. correct answers raise the skill once per answer — no double counting', async () => {
    const { cookie } = await student([{ subjectId: 'math', targetScore: '80_plus' }]);
    const tasks = await tasksOf('math', 2, 3);
    for (const t of tasks)
      expect((await answer(cookie, t, t.correctAnswer)).json().correct).toBe(true);
    let o = await get<LearningOverviewResponse>(cookie, '/me/learning/overview');
    // 3 of 3: clearly not weak, but not «strong» from so few answers either.
    expect(skill(o, 'math.vectors')).toMatchObject({
      attempts: 3,
      correct: 3,
      level: 'developing',
    });
    expect(o.subjects[0]!.totals).toMatchObject({ attempts: 3, correct: 3, solvedTasks: 3 });
    // Reading again never changes the numbers.
    o = await get<LearningOverviewResponse>(cookie, '/me/learning/overview');
    expect(o.subjects[0]!.totals.attempts).toBe(3);
    // An old-edition task checking two topics counts once in the subject totals.
    const [two] = await testDb.db
      .select()
      .from(schema.tasks)
      .where(
        and(
          eq(schema.tasks.source, YASHCHENKO_2027_PROJECT_SOURCE),
          eq(schema.tasks.taskNumber, 9),
        ),
      )
      .limit(1);
    await answer(cookie, two!, '__wrong__');
    o = await get<LearningOverviewResponse>(cookie, '/me/learning/overview');
    expect(o.subjects[0]!.totals.attempts).toBe(4);
    expect(skill(o, 'math.derivative-graphs').attempts).toBe(1);
    expect(skill(o, 'math.derivative-investigation').attempts).toBe(1);
  });

  it('4/15. repeated errors → the first recommendation names that number, with tasks to retry', async () => {
    const { cookie } = await student([{ subjectId: 'russian', targetScore: '80_plus' }]);
    const [t1, t2] = await tasksOf('russian', 9, 2);
    for (const t of [t1!, t1!, t2!, t2!]) await answer(cookie, t, '__wrong__');
    const r = await get<LearningRecommendationsResponse>(cookie, '/me/learning/recommendations');
    const first = r.recommendations[0]!;
    expect(first).toMatchObject({ subjectId: 'russian', examNumber: 9, kind: 'repeated_errors' });
    expect(first.reason).toMatch(/Ошибки повторяются/);
    expect(first.taskIds).toEqual(expect.arrayContaining([t1!.id, t2!.id]));
    // only the selected subject
    expect(r.recommendations.every((x) => x.subjectId === 'russian')).toBe(true);
    const a = await get<LearningAnalyticsResponse>(
      cookie,
      '/me/learning/analytics?subject=russian',
    );
    expect(a.errors.repeated).toEqual([{ skillKey: 'russian.09-root-vowels', tasks: 2 }]);
    expect(a.errors.mostWrong[0]).toEqual({ skillKey: 'russian.09-root-vowels', wrong: 4 });
  });

  it('5. improvement after errors is visible: trend up, mastery higher', async () => {
    const { cookie } = await student([{ subjectId: 'math', targetScore: '70_plus' }]);
    const tasks = await tasksOf('math', 4, 10);
    for (const t of tasks.slice(0, 5)) await answer(cookie, t, '__wrong__');
    const before = skill(await get(cookie, '/me/learning/overview'), 'math.probability-basic');
    for (const t of tasks.slice(5, 10)) await answer(cookie, t, t.correctAnswer);
    const after = skill(await get(cookie, '/me/learning/overview'), 'math.probability-basic');
    expect(after.mastery).toBeGreaterThan(before.mastery);
    expect(after.trend).toBe('up');
    const a = await get<LearningAnalyticsResponse>(cookie, '/me/learning/analytics?subject=math');
    expect(a.improving).toContain('math.probability-basic');
  });

  it('6. a strong number not practiced for weeks is recommended for review', async () => {
    const { userId, cookie } = await student([{ subjectId: 'math', targetScore: '80_plus' }]);
    const tasks = await tasksOf('math', 1, 6);
    const old = Date.now() - 31 * DAY;
    await testDb.db.insert(schema.attempts).values(
      tasks.map((t, i) => ({
        userId,
        taskId: t.id,
        answerRaw: t.correctAnswer,
        isCorrect: true,
        createdAt: new Date(old + i * 60_000),
      })),
    );
    const r = await get<LearningRecommendationsResponse>(
      cookie,
      '/me/learning/recommendations?limit=12',
    );
    const rec = r.recommendations.find((x) => x.skillKey === 'math.planimetry')!;
    expect(rec.kind).toBe('stale');
    expect(rec.reason).toMatch(/не практиковал его 30 дней/);
  });

  it('7/8. several subjects and targets: both subjects, part 2 weighted by the target', async () => {
    const low = await student([
      { subjectId: 'math', targetScore: '60_plus' },
      { subjectId: 'russian', targetScore: '70_plus' },
    ]);
    const high = await student([{ subjectId: 'math', targetScore: '95_plus' }]);
    for (const s of [low, high]) {
      for (const n of [2, 13]) {
        for (const t of await tasksOf('math', n, 4)) await answer(s.cookie, t, '__wrong__');
      }
    }
    const lowRecs = (
      await get<LearningRecommendationsResponse>(
        low.cookie,
        '/me/learning/recommendations?limit=12',
      )
    ).recommendations;
    expect(new Set(lowRecs.map((r) => r.subjectId))).toEqual(new Set(['math', 'russian']));
    const idx = (recs: typeof lowRecs, n: number) =>
      recs.findIndex((r) => r.examNumber === n && r.subjectId === 'math');
    expect(idx(lowRecs, 2)).toBeLessThan(idx(lowRecs, 13));
    const highRecs = (
      await get<LearningRecommendationsResponse>(
        high.cookie,
        '/me/learning/recommendations?limit=12',
      )
    ).recommendations;
    expect(idx(highRecs, 13)).toBeLessThan(idx(highRecs, 2));
  });

  it('16/17. smart training: plan from the profile, real tasks, updated statistics and next steps', async () => {
    const { cookie } = await student([{ subjectId: 'math', targetScore: '80_plus' }]);
    // A profile with a weak number, a mistake, and a strong one.
    for (const t of await tasksOf('math', 6, 4)) await answer(cookie, t, '__wrong__');
    for (const t of await tasksOf('math', 2, 4)) await answer(cookie, t, t.correctAnswer);
    const statsBefore = (await get<LearningOverviewResponse>(cookie, '/me/learning/overview'))
      .subjects[0]!.totals;

    let res = (
      await app.inject({
        method: 'POST',
        url: '/api/v1/me/learning/sessions',
        headers: { cookie },
        payload: { subjectId: 'math', limit: 8 },
      })
    ).json();
    expect(res.status).toBe('active');
    expect(res.pick).toMatchObject({ bucket: 'weak' });
    const served: string[] = [];
    const buckets: string[] = [];
    while (res.status === 'active') {
      served.push(res.task.id);
      buckets.push(res.pick.bucket);
      const [row] = await testDb.db
        .select()
        .from(schema.tasks)
        .where(eq(schema.tasks.id, res.task.id));
      // answer the first half right, the rest wrong
      const value = served.length <= 4 ? row!.correctAnswer : '__wrong__';
      if (row!.answerType === 'short_answer') await answer(cookie, row!, value, res.sessionId);
      res = (
        await app.inject({
          method: 'GET',
          url: `/api/v1/me/learning/sessions/${res.sessionId}/next`,
          headers: { cookie },
        })
      ).json();
    }
    expect(served).toHaveLength(8);
    expect(new Set(served).size).toBe(8); // never the same task twice
    expect(buckets).toContain('weak');
    expect(buckets).toContain('mistakes');
    const tasks = await testDb.db
      .select()
      .from(schema.tasks)
      .where(inArray(schema.tasks.id, served));
    expect(tasks.every((t) => t.subjectId === 'math' && t.status === 'published')).toBe(true);

    expect(res.status).toBe('completed');
    expect(res.summary.skills.length).toBeGreaterThan(0);
    for (const s of res.summary.skills) {
      expect(s).toEqual(
        expect.objectContaining({
          before: expect.any(Number),
          after: expect.any(Number),
          attempts: expect.any(Number),
        }),
      );
    }
    expect(res.summary.next.length).toBeGreaterThan(0);
    const statsAfter = (await get<LearningOverviewResponse>(cookie, '/me/learning/overview'))
      .subjects[0]!.totals;
    expect(statsAfter.attempts).toBeGreaterThan(statsBefore.attempts);
  });

  it('15. «Начать» on a recommendation trains exactly that number', async () => {
    const { cookie } = await student([{ subjectId: 'russian', targetScore: '90_plus' }]);
    let res = (
      await app.inject({
        method: 'POST',
        url: '/api/v1/me/learning/sessions',
        headers: { cookie },
        payload: { subjectId: 'russian', limit: 3, focusSkill: 'russian.15-n-nn' },
      })
    ).json();
    const numbers: number[] = [];
    while (res.status === 'active') {
      numbers.push(res.pick.examNumber);
      res = (
        await app.inject({
          method: 'GET',
          url: `/api/v1/me/learning/sessions/${res.sessionId}/next`,
          headers: { cookie },
        })
      ).json();
    }
    expect(numbers).toEqual([15, 15, 15]);
    const bad = await app.inject({
      method: 'POST',
      url: '/api/v1/me/learning/sessions',
      headers: { cookie },
      payload: { subjectId: 'russian', focusSkill: 'math.vectors' },
    });
    expect(bad.statusCode).toBe(400);
  });

  it('2. a student who has only a profile (diagnostic) gets recommendations in the chosen subjects only', async () => {
    const { cookie } = await student([{ subjectId: 'russian', targetScore: '80_plus' }]);
    const r = await get<LearningRecommendationsResponse>(
      cookie,
      '/me/learning/recommendations?limit=12',
    );
    expect(r.recommendations.length).toBeGreaterThan(0);
    expect(r.recommendations.every((x) => x.subjectId === 'russian')).toBe(true);
    const o = await get<LearningOverviewResponse>(cookie, '/me/learning/overview');
    expect(o.subjects.map((s) => s.subjectId)).toEqual(['russian']);
    expect(o.subjects[0]!.targetScore).toBe('80_plus');
  });

  it('difficulty ratings enter the profile but never change correctness or mastery', async () => {
    const { cookie } = await student([{ subjectId: 'math', targetScore: '80_plus' }]);
    const tasks = await tasksOf('math', 3, 3);
    for (const t of tasks) await answer(cookie, t, t.correctAnswer);
    const before = skill(await get(cookie, '/me/learning/overview'), 'math.stereometry');
    for (const t of tasks) {
      await app.inject({
        method: 'PUT',
        url: `/api/v1/tasks/${t.id}/difficulty-rating`,
        headers: { cookie },
        payload: { rating: 9 },
      });
    }
    const after = skill(await get(cookie, '/me/learning/overview'), 'math.stereometry');
    expect(after.mastery).toBe(before.mastery);
    expect(after).toMatchObject({ myAverageRating: 9, hardButCorrect: 3 });
  });
});
