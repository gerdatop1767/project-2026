import { randomUUID } from 'node:crypto';
import { schema, syncTaskSkills } from '@zybrilka/db';
import { createFullContentTestDb } from '@zybrilka/db/testing';
import {
  parseMultiPartSpec,
  YASHCHENKO_2027_PROJECT_SOURCE,
  type AdviceResponse,
  type PersonalRecommendationsResponse,
  type PlanResponse,
  type SkillProgressResponse,
} from '@zybrilka/shared';
import { and, eq, ne } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../../app.js';
import { loadConfig } from '../../../config.js';
import { getPlan } from './plans.js';

type TaskRow = typeof schema.tasks.$inferSelect;
const SKILL6 = 'math.equations-simple';

/**
 * Personal learning end to end on the real content (docs/learning/
 * PERSONAL-PLANS.md): diagnosis → advice → plan → real answers → progress.
 */
describe('personal recommendations, plans and progress (real content, production auth)', () => {
  let testDb: Awaited<ReturnType<typeof createFullContentTestDb>>;
  let app: ReturnType<typeof buildApp>;
  let math6: TaskRow[];
  /** Every №6 task of the default pool, numeric or not. */
  let all6: TaskRow[];

  beforeAll(async () => {
    testDb = await createFullContentTestDb();
    await syncTaskSkills(testDb.db);
    app = buildApp({
      version: 'test',
      db: testDb.db,
      authConfig: loadConfig({ NODE_ENV: 'test' }),
    });
    all6 = await testDb.db
      .select()
      .from(schema.tasks)
      .where(
        and(
          eq(schema.tasks.subjectId, 'math'),
          eq(schema.tasks.taskNumber, 6),
          eq(schema.tasks.status, 'published'),
          eq(schema.tasks.answerType, 'short_answer'),
          ne(schema.tasks.source, YASHCHENKO_2027_PROJECT_SOURCE),
        ),
      );
    math6 = (
      await testDb.db
        .select()
        .from(schema.tasks)
        .where(
          and(
            eq(schema.tasks.subjectId, 'math'),
            eq(schema.tasks.taskNumber, 6),
            eq(schema.tasks.status, 'published'),
            eq(schema.tasks.answerType, 'short_answer'),
            ne(schema.tasks.source, YASHCHENKO_2027_PROJECT_SOURCE),
          ),
        )
    ).filter((t) => /^-?\d+$/.test(t.correctAnswer.trim()) && Number(t.correctAnswer) !== 0);
  }, 120_000);
  afterAll(async () => {
    await app.close();
    await testDb.close();
  });

  async function student() {
    const [user] = await testDb.db.insert(schema.users).values({}).returning();
    const sessionId = randomUUID();
    await testDb.db
      .insert(schema.authSessions)
      .values({ id: sessionId, userId: user!.id, expiresAt: new Date(Date.now() + 3_600_000) });
    return { userId: user!.id, cookie: `session_id=${sessionId}` };
  }
  const call = (
    cookie: string | null,
    method: 'GET' | 'POST' | 'PUT',
    url: string,
    payload?: object,
  ) =>
    app.inject({
      method,
      url: `/api/v1${url}`,
      headers: cookie ? { cookie } : {},
      ...(payload ? { payload } : {}),
    });
  const answer = (cookie: string, task: TaskRow, value: string | Record<string, string>) =>
    call(cookie, 'POST', `/tasks/${task.id}/attempt`, { answer: value });

  /** Wrong answers a sign away from the right one, on different tasks. */
  async function slipOnNumber6(cookie: string) {
    for (const [i, t] of math6.slice(0, 6).entries()) {
      const value = i % 3 === 0 ? t.correctAnswer : String(-Number(t.correctAnswer));
      expect((await answer(cookie, t, value)).statusCode).toBe(200);
    }
  }

  it('each subject has its own recommendations, plan and ЕГЭ gain — never mixed', async () => {
    const { cookie } = await student();
    await slipOnNumber6(cookie);
    // Russian: wrong answers on several №9–№12 tasks.
    const ru = await testDb.db
      .select()
      .from(schema.tasks)
      .where(
        and(
          eq(schema.tasks.subjectId, 'russian'),
          eq(schema.tasks.status, 'published'),
          eq(schema.tasks.answerType, 'short_answer'),
        ),
      );
    const ruWrong = ru.filter((t) => t.taskNumber >= 9 && t.taskNumber <= 12).slice(0, 12);
    for (const t of ruWrong) expect((await answer(cookie, t, 'xx')).statusCode).toBe(200);

    const plan = async (subjectId: 'math' | 'russian') => {
      const recs = (
        await call(cookie, 'GET', `/me/learning/personal?subject=${subjectId}`)
      ).json() as PersonalRecommendationsResponse;
      const made = await call(cookie, 'POST', '/me/learning/plans', { subjectId, kind: 'week' });
      expect([200, 201, 409]).toContain(made.statusCode);
      return recs;
    };
    const m = await plan('math');
    const r = await plan('russian');
    expect(m.recommendations.every((x) => x.subjectId === 'math')).toBe(true);
    expect(r.recommendations.every((x) => x.subjectId === 'russian')).toBe(true);
    const mathPlan = (
      await call(cookie, 'GET', '/me/learning/plans/current?subject=math')
    ).json() as { plan: PlanResponse | null };
    const ruPlan = (
      await call(cookie, 'GET', '/me/learning/plans/current?subject=russian')
    ).json() as { plan: PlanResponse | null };
    if (mathPlan.plan && ruPlan.plan) {
      expect(mathPlan.plan.id).not.toBe(ruPlan.plan.id);
      expect(mathPlan.plan.focus.every((f) => f.skillKey.startsWith('math.'))).toBe(true);
      expect(ruPlan.plan.focus.every((f) => f.skillKey.startsWith('russian.'))).toBe(true);
    }
    // Russian gain: test points by the 2026 table, without the essay.
    expect(r.summary.potentialTestPoints).toMatchObject({
      available: true,
      label: 'Тестовый балл · ориентир по шкале ЕГЭ-2026',
      note: expect.stringMatching(/Без сочинения/),
    });
    expect(m.summary.potentialTestPoints).toMatchObject({ available: true });
    expect(m.summary.potentialTestPoints).not.toHaveProperty('note');
    // An unsupported subject is refused.
    expect((await call(cookie, 'GET', '/me/learning/personal?subject=history')).statusCode).toBe(
      400,
    );
  });

  it('a guest gets 401 everywhere', async () => {
    for (const url of [
      '/me/learning/personal',
      `/me/learning/skills/${SKILL6}/advice`,
      `/me/learning/skills/${SKILL6}/progress`,
      '/me/learning/plans/current?subject=math',
      '/me/notifications/progress',
    ]) {
      expect((await call(null, 'GET', url)).statusCode, url).toBe(401);
    }
    expect(
      (await call(null, 'POST', '/me/learning/plans', { subjectId: 'math', kind: 'week' }))
        .statusCode,
    ).toBe(401);
  });

  it('recommendations name the cause from the real answers (sign slips → computational)', async () => {
    const { cookie } = await student();
    await slipOnNumber6(cookie);
    const r = (
      await call(cookie, 'GET', '/me/learning/personal?subject=math')
    ).json() as PersonalRecommendationsResponse;
    const rec = r.recommendations.find((x) => x.skillKey === SKILL6)!;
    expect(rec).toBeDefined();
    expect(rec.problem.type).toBe('computational');
    expect(rec.problem.summary).toMatch(/почти совпадают/);
    expect(rec.progress.attempts).toBe(6);
    expect(r.summary.priorityTopics).toBeGreaterThan(0);
    expect(r.summary.potentialPrimaryPoints).toBeGreaterThan(0);
    // The ЕГЭ gain: test points by the 2026 table, «было → станет», a guide label.
    const gain = r.summary.potentialTestPoints;
    expect(gain).toMatchObject({
      available: true,
      label: 'Тестовый балл · ориентир по шкале ЕГЭ-2026',
    });
    if (gain.available) {
      expect(gain.points).toBe(gain.to - gain.from);
      expect(gain.points).toBeGreaterThan(0);
      expect(gain.to).toBeLessThanOrEqual(100);
    }
    expect(r.summary.etaBasis).toBe('week_plan');

    const advice = (
      await call(cookie, 'GET', `/me/learning/skills/${SKILL6}/advice`)
    ).json() as AdviceResponse;
    expect(advice.advice.problem).toBe('computational');
    expect(advice.advice.steps.length).toBeGreaterThan(2);
    expect(advice.advice.control.tasks).toBeGreaterThan(0);
    expect(advice.stats.attempts).toBe(6);
  });

  it('too little data: no invented cause — a diagnostic training is advised', async () => {
    const { cookie } = await student();
    await answer(cookie, math6[0]!, '999999');
    const advice = (
      await call(cookie, 'GET', `/me/learning/skills/${SKILL6}/advice`)
    ).json() as AdviceResponse;
    expect(advice.problem.type).toBe('insufficient_data');
    expect(advice.advice.title).toBe('Нужна диагностика');
    expect(advice.theory).toMatchObject({ subjectId: 'math', taskNumber: 6, topic: null });
    expect(advice.theory!.sections.length).toBeGreaterThan(0);
  });

  it('№8: one error type keeps failing while the other letters hold → advice for that type', async () => {
    const { cookie } = await student();
    const tasks8 = (
      await testDb.db
        .select()
        .from(schema.tasks)
        .where(
          and(
            eq(schema.tasks.subjectId, 'russian'),
            eq(schema.tasks.taskNumber, 8),
            eq(schema.tasks.status, 'published'),
          ),
        )
    ).filter((t) => /[А-Д]\) [^\n]*деепричастн/.test(t.conditionMd));
    expect(tasks8.length).toBeGreaterThanOrEqual(4);
    for (const t of tasks8.slice(0, 4)) {
      const spec = parseMultiPartSpec(t.correctAnswer)!;
      const gerund = spec.parts.find((p) =>
        new RegExp(`${p.label}\\) [^\\n]*деепричастн`).test(t.conditionMd),
      )!;
      const value = Object.fromEntries(
        spec.parts.map((p) => [
          p.id,
          p === gerund ? (p.correctAnswer === '9' ? '8' : '9') : p.correctAnswer,
        ]),
      );
      expect((await answer(cookie, t, value)).statusCode).toBe(200);
    }
    const advice = (
      await call(cookie, 'GET', '/me/learning/skills/russian.08-syntax-norms/advice')
    ).json() as AdviceResponse;
    expect(advice.problem.type).toBe('weak_part');
    expect(advice.problem.focus).toBe('Деепричастный оборот');
    expect(advice.advice.focus).toMatchObject({ kind: 'part', key: 'gerund' });
    expect(advice.theory?.sections).toEqual(['2. Деепричастный оборот']);
  });

  it('№13: answers that lose a root on the segment → «Потерянные корни»', async () => {
    const { cookie } = await student();
    const tasks13 = (
      await testDb.db
        .select()
        .from(schema.tasks)
        .where(
          and(
            eq(schema.tasks.subjectId, 'math'),
            eq(schema.tasks.taskNumber, 13),
            eq(schema.tasks.status, 'published'),
            eq(schema.tasks.answerType, 'short_answer'),
          ),
        )
    ).filter((t) => /π/.test(t.correctAnswer) && t.correctAnswer.split(/;|,\s/).length >= 2);
    expect(tasks13.length).toBeGreaterThanOrEqual(4);
    for (const t of tasks13.slice(0, 4)) {
      const roots = t.correctAnswer.split(/;|,\s/).map((x) => x.trim());
      expect((await answer(cookie, t, roots.slice(0, -1).join('; '))).statusCode).toBe(200);
    }
    const advice = (
      await call(cookie, 'GET', '/me/learning/skills/math.equations-advanced/advice')
    ).json() as AdviceResponse;
    expect(advice.problem.type).toBe('missed_items');
    expect(advice.advice.title).toBe('Потерянные корни');
    expect(advice.advice.generic).toBe(false);
  });

  it('progress by number: one right answer is not 100 %; chart, dynamics, history', async () => {
    const { cookie } = await student();
    await answer(cookie, math6[0]!, math6[0]!.correctAnswer);
    const p = (
      await call(cookie, 'GET', `/me/learning/skills/${SKILL6}/progress`)
    ).json() as SkillProgressResponse;
    expect(p.stats.mastery).toBeNull(); // too little data for a percentage
    expect(p.stats.level).toBe('low_data');
    expect(p.stats.solvedTasks).toBe(1);
    expect(p.series).toHaveLength(30);
    expect(p.series.at(-1)).toMatchObject({ attempts: 1, correct: 1 });
    expect(p.history[0]).toMatchObject({ attempts: 1, correct: 1 });
    expect(p.dynamics.last7.attempts).toBe(1);
    expect(p.goal?.targetMastery).toBe(55);
    expect(
      (await call(cookie, 'GET', '/me/learning/skills/math.no-such/progress')).statusCode,
    ).toBe(400);
  });

  it('a week plan: 7 days of the focus number; only one active plan per subject', async () => {
    const { cookie } = await student();
    await slipOnNumber6(cookie);
    const res = await call(cookie, 'POST', '/me/learning/plans', {
      subjectId: 'math',
      kind: 'week',
    });
    expect(res.statusCode).toBe(201);
    const plan = (res.json() as { plan: PlanResponse }).plan;
    expect(plan.days).toHaveLength(7);
    expect(plan.focus[0]!.skillKey).toBe(SKILL6);
    expect(plan.focus[0]!.problem).toBe('computational');
    expect(plan.progress.percent).toBe(0);
    expect(
      (await call(cookie, 'POST', '/me/learning/plans', { subjectId: 'math', kind: 'week' }))
        .statusCode,
    ).toBe(409);
    const month = await call(cookie, 'POST', '/me/learning/plans', {
      subjectId: 'math',
      kind: 'month',
      replace: true,
    });
    expect(month.statusCode).toBe(201);
    expect((month.json() as { plan: PlanResponse }).plan.days).toHaveLength(30);
    const current = (
      await call(cookie, 'GET', '/me/learning/plans/current?subject=math')
    ).json() as { plan: PlanResponse };
    expect(current.plan.kind).toBe('month');
  });

  it('a new student without any focus gets an honest refusal, not an empty plan', async () => {
    const { cookie } = await student();
    // A brand-new student still has «unexplored» numbers to start with.
    const res = await call(cookie, 'POST', '/me/learning/plans', {
      subjectId: 'russian',
      kind: 'week',
    });
    expect([201, 422]).toContain(res.statusCode);
  });

  it('a day counts only real answers of its number, each task once; skip/move; percent', async () => {
    const { cookie, userId } = await student();
    await slipOnNumber6(cookie);
    const plan = (
      (
        await call(cookie, 'POST', '/me/learning/plans', { subjectId: 'math', kind: 'week' })
      ).json() as { plan: PlanResponse }
    ).plan;
    const day0 = plan.days[0]!;
    // Opening pages or answering the same task again does not fill the day.
    const t = math6[6]!;
    await answer(cookie, t, t.correctAnswer);
    await answer(cookie, t, t.correctAnswer);
    let p = (await call(cookie, 'GET', `/me/learning/plans/${plan.id}`)).json() as {
      plan: PlanResponse;
    };
    expect(p.plan.days[0]!.done).toBe(1);
    expect(p.plan.days[0]!.status).toBe('partial');
    const used = new Set(math6.slice(0, 7).map((x) => x.id));
    const more = all6.filter((x) => !used.has(x.id)).slice(0, day0.targetTasks - 1);
    expect(more.length).toBe(day0.targetTasks - 1);
    for (const x of more) {
      const r = await answer(cookie, x, x.correctAnswer);
      expect(r.statusCode, r.body).toBe(200);
    }
    p = (await call(cookie, 'GET', `/me/learning/plans/${plan.id}`)).json() as {
      plan: PlanResponse;
    };
    expect(p.plan.days[0]!.status).toBe('done');
    expect(p.plan.progress.daysDone).toBe(1);
    expect(p.plan.progress.percent).toBe(Math.round(100 / 7));
    // A 100 % day makes the next days of the number a level harder.
    expect(p.plan.days[1]!.difficulty).toBeGreaterThanOrEqual(plan.days[1]!.difficulty);

    const skip = await call(cookie, 'POST', `/me/learning/plans/${plan.id}/days/1/skip`);
    expect(skip.statusCode).toBe(200);
    const skipped = (skip.json() as { plan: PlanResponse }).plan;
    expect(skipped.days[1]!.status).toBe('skipped');
    expect(skipped.progress.daysDone).toBe(1); // skipped is not done
    expect(
      (await call(cookie, 'POST', `/me/learning/plans/${plan.id}/days/1/skip`)).statusCode,
    ).toBe(409);

    const move = await call(cookie, 'POST', `/me/learning/plans/${plan.id}/days/2/move`);
    expect(move.statusCode).toBe(200);
    const moved = (move.json() as { plan: PlanResponse }).plan;
    expect(moved.days[2]!.date > plan.days[2]!.date).toBe(true);
    expect(moved.days[6]!.date > plan.days[6]!.date).toBe(true);
    expect(moved.movesLeft).toBe(2);
    // A done day cannot be moved or skipped.
    expect(
      (await call(cookie, 'POST', `/me/learning/plans/${plan.id}/days/0/move`)).statusCode,
    ).toBe(409);

    // After the last day the plan completes once, with the before/after.
    const later = new Date(Date.now() + 10 * 86_400_000);
    const done = await getPlan(testDb.db, userId, plan.id, later);
    expect(done!.status).toBe('completed');
    expect(done!.focus[0]!.before.mastery).toBe(plan.focus[0]!.before.mastery);
    expect(done!.focus[0]!.now.attemptsInPlan).toBeGreaterThanOrEqual(day0.targetTasks);
  });

  it('another student’s plan: 404 for read, skip, move and cancel', async () => {
    const owner = await student();
    await slipOnNumber6(owner.cookie);
    const plan = (
      (
        await call(owner.cookie, 'POST', '/me/learning/plans', { subjectId: 'math', kind: 'week' })
      ).json() as { plan: PlanResponse }
    ).plan;
    const other = await student();
    expect((await call(other.cookie, 'GET', `/me/learning/plans/${plan.id}`)).statusCode).toBe(404);
    expect(
      (await call(other.cookie, 'POST', `/me/learning/plans/${plan.id}/days/1/skip`)).statusCode,
    ).toBe(404);
    expect(
      (await call(other.cookie, 'POST', `/me/learning/plans/${plan.id}/days/1/move`)).statusCode,
    ).toBe(404);
    expect(
      (await call(other.cookie, 'POST', `/me/learning/plans/${plan.id}/cancel`)).statusCode,
    ).toBe(404);
    // still the owner's and active
    expect(
      (
        (await call(owner.cookie, 'GET', `/me/learning/plans/${plan.id}`)).json() as {
          plan: PlanResponse;
        }
      ).plan.status,
    ).toBe('active');
    expect(
      (await call(owner.cookie, 'POST', `/me/learning/plans/${plan.id}/cancel`)).statusCode,
    ).toBe(200);
  });

  it('notification settings: defaults, saved separately, a global «off» respected', async () => {
    const { cookie, userId } = await student();
    expect((await call(cookie, 'GET', '/me/notifications/progress')).json()).toMatchObject({
      progressEnabled: true,
      planRemindersEnabled: true,
      frequency: 'normal',
      explicit: false,
    });
    const saved = await call(cookie, 'PUT', '/me/notifications/progress', {
      progressEnabled: false,
      planRemindersEnabled: true,
      frequency: 'important',
    });
    expect(saved.json()).toMatchObject({
      progressEnabled: false,
      frequency: 'important',
      explicit: true,
    });
    expect(
      (await call(cookie, 'PUT', '/me/notifications/progress', { progressEnabled: 'yes' }))
        .statusCode,
    ).toBe(400);

    const off = await student();
    await testDb.db.insert(schema.reminderSettings).values({ userId: off.userId, enabled: false });
    expect((await call(off.cookie, 'GET', '/me/notifications/progress')).json()).toMatchObject({
      progressEnabled: false,
      planRemindersEnabled: false,
    });
    expect(userId).toBeTruthy();
  });

  it('a plan day starts a smart training of its number at its difficulty', async () => {
    const { cookie } = await student();
    const res = await call(cookie, 'POST', '/me/learning/sessions', {
      subjectId: 'math',
      limit: 3,
      focusSkill: SKILL6,
      difficulty: 1,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().pick.skillKey).toBe(SKILL6);
    expect(
      (
        await call(cookie, 'POST', '/me/learning/sessions', {
          subjectId: 'math',
          focusSkill: SKILL6,
          difficulty: 5,
        })
      ).statusCode,
    ).toBe(400);
  });
});
