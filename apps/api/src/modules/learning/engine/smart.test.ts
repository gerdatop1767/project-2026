import { randomUUID } from 'node:crypto';
import { schema, syncTaskSkills } from '@zybrilka/db';
import { createFullContentTestDb } from '@zybrilka/db/testing';
import { YASHCHENKO_2027_PROJECT_SOURCE, type SmartSetupResponse } from '@zybrilka/shared';
import { and, eq, inArray, ne } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../../app.js';
import { loadConfig } from '../../../config.js';

type TaskRow = typeof schema.tasks.$inferSelect;

/**
 * «Умная тренировка» с настройкой on the real content
 * (docs/learning/SMART-TRAINING.md): every mode serves tasks only from the
 * topics it may use, the number of tasks is real, «Проблемные темы» are the
 * student's own weak topics.
 */
describe('smart training set-up (real content)', () => {
  let testDb: Awaited<ReturnType<typeof createFullContentTestDb>>;
  let app: ReturnType<typeof buildApp>;

  beforeAll(async () => {
    testDb = await createFullContentTestDb();
    await syncTaskSkills(testDb.db);
    app = buildApp({
      version: 'test',
      db: testDb.db,
      authConfig: loadConfig({ NODE_ENV: 'test' }),
    });
  }, 300_000);
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
    return { cookie: `session_id=${sessionId}` };
  }
  const start = (cookie: string, payload: object) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/me/learning/sessions',
      headers: { cookie },
      payload,
    });
  const answer = (cookie: string, task: TaskRow, value: string, sessionId?: string) =>
    app.inject({
      method: 'POST',
      url: `/api/v1/tasks/${task.id}/attempt`,
      headers: { cookie },
      payload: sessionId ? { answer: value, sessionId } : { answer: value },
    });
  async function setup(cookie: string, subject = 'math') {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/me/learning/smart-setup?subject=${subject}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    return res.json() as SmartSetupResponse;
  }
  async function tasksOf(taskNumber: number, n: number) {
    return testDb.db
      .select()
      .from(schema.tasks)
      .where(
        and(
          eq(schema.tasks.subjectId, 'math'),
          eq(schema.tasks.taskNumber, taskNumber),
          eq(schema.tasks.status, 'published'),
          eq(schema.tasks.answerType, 'short_answer'),
          ne(schema.tasks.source, YASHCHENKO_2027_PROJECT_SOURCE),
        ),
      )
      .limit(n);
  }
  /** Plays a started session to the end; returns the served task ids. */
  async function play(
    cookie: string,
    first: { sessionId: string; status: string; task: { id: string } },
  ) {
    let res = first as { sessionId: string; status: string; task: { id: string } };
    const served: string[] = [];
    while (res.status === 'active') {
      served.push(res.task.id);
      const [row] = await testDb.db
        .select()
        .from(schema.tasks)
        .where(eq(schema.tasks.id, res.task.id));
      await answer(cookie, row!, row!.correctAnswer, res.sessionId);
      res = (
        await app.inject({
          method: 'GET',
          url: `/api/v1/me/learning/sessions/${res.sessionId}/next`,
          headers: { cookie },
        })
      ).json();
    }
    return served;
  }
  async function skillsOf(taskIds: readonly string[]) {
    const rows = await testDb.db
      .select({ taskId: schema.taskSkills.taskId, slug: schema.skills.slug })
      .from(schema.taskSkills)
      .innerJoin(schema.skills, eq(schema.skills.id, schema.taskSkills.skillId))
      .where(inArray(schema.taskSkills.taskId, [...taskIds]));
    const by = new Map<string, string[]>();
    for (const r of rows) by.set(r.taskId, [...(by.get(r.taskId) ?? []), r.slug]);
    return by;
  }

  it('the set-up lists the subject’s topics with real task counts; a new student has no problems', async () => {
    const { cookie } = await student();
    const s = await setup(cookie);
    expect(s.skills.length).toBeGreaterThan(10);
    expect(s.skills.every((k) => k.key.startsWith('math.') && k.availableTasks > 0)).toBe(true);
    expect(s.skills.every((k) => k.mastery === null && k.level === 'none')).toBe(true);
    expect(s.problemKeys).toEqual([]);
    expect(s.subjectTasks).toBeGreaterThan(100);
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/me/learning/smart-setup?subject=chemistry',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(400);
  });

  it('«Конкретные темы»: the chosen number of tasks, every one from the chosen topics only', async () => {
    const { cookie } = await student();
    const chosen = ['math.expressions', 'math.probability-basic'];
    const res = await start(cookie, {
      subjectId: 'math',
      limit: 7,
      smart: { mode: 'topics', skillKeys: chosen },
    });
    expect(res.statusCode).toBe(200);
    const served = await play(cookie, res.json());
    expect(served).toHaveLength(7);
    expect(new Set(served).size).toBe(7);
    const by = await skillsOf(served);
    for (const id of served)
      expect(
        by.get(id)!.some((k) => chosen.includes(k)),
        id,
      ).toBe(true);
  });

  it('«Проблемные темы»: only the student’s weak topics; a student without problems is told so', async () => {
    const { cookie } = await student();
    const none = await start(cookie, { subjectId: 'math', limit: 5, smart: { mode: 'problems' } });
    expect(none.statusCode).toBe(422);
    expect(none.json()).toMatchObject({ error: 'no_problem_topics' });
    for (const t of await tasksOf(6, 4)) await answer(cookie, t, '__wrong__');
    const s = await setup(cookie);
    expect(s.problemKeys.length).toBeGreaterThan(0);
    const problem = s.skills.find((k) => k.key === s.problemKeys[0])!;
    expect(problem.problem!.reasons.join(' ')).toMatch(/точность|ошибок/);
    const res = await start(cookie, { subjectId: 'math', limit: 5, smart: { mode: 'problems' } });
    expect(res.statusCode).toBe(200);
    const served = await play(cookie, res.json());
    expect(served).toHaveLength(5);
    const by = await skillsOf(served);
    for (const id of served) {
      expect(
        by.get(id)!.some((k) => s.problemKeys.includes(k)),
        id,
      ).toBe(true);
    }
  });

  it('«Весь предмет» spreads over many topics; «По статистике» and «Смешанная» start', async () => {
    const { cookie } = await student();
    const res = await start(cookie, { subjectId: 'math', limit: 8, smart: { mode: 'subject' } });
    expect(res.statusCode).toBe(200);
    const served = await play(cookie, res.json());
    expect(served).toHaveLength(8);
    const by = await skillsOf(served);
    const topics = new Set(served.map((id) => by.get(id)![0]));
    expect(topics.size).toBeGreaterThanOrEqual(6);
    for (const mode of ['stats', 'mixed'] as const) {
      const r = await start(cookie, { subjectId: 'math', limit: 5, smart: { mode } });
      expect(r.statusCode, mode).toBe(200);
      expect(r.json()).toMatchObject({ status: 'active', total: 5 });
    }
  });

  it('more tasks than the topics have: 409 with the real number available', async () => {
    const { cookie } = await student();
    const s = await setup(cookie);
    const small = [...s.skills].sort((a, b) => a.availableTasks - b.availableTasks)[0]!;
    const res = await start(cookie, {
      subjectId: 'math',
      limit: Math.min(50, small.availableTasks + 1),
      smart: { mode: 'topics', skillKeys: [small.key] },
    });
    if (small.availableTasks + 1 <= 50) {
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({
        error: 'not_enough_tasks',
        available: small.availableTasks,
      });
    }
  });

  it('difficulty: «лёгкие» serve easier tasks than «сложные»', async () => {
    const avg = async (difficulty: 'easy' | 'hard') => {
      const { cookie } = await student();
      const res = await start(cookie, {
        subjectId: 'math',
        limit: 10,
        smart: { mode: 'subject', difficulty },
      });
      const served = await play(cookie, res.json());
      const rows = await testDb.db
        .select({ d: schema.tasks.difficulty })
        .from(schema.tasks)
        .where(inArray(schema.tasks.id, served));
      return rows.reduce((s, r) => s + (r.d ?? 2), 0) / rows.length;
    };
    expect(await avg('easy')).toBeLessThan(await avg('hard'));
  });

  it('rejects topics of another subject, too few tasks and a mix with smart', async () => {
    const { cookie } = await student();
    const bad = [
      { subjectId: 'math', limit: 5, smart: { mode: 'topics', skillKeys: ['russian.15-n-nn'] } },
      { subjectId: 'math', limit: 2, smart: { mode: 'subject' } },
      { subjectId: 'math', limit: 51, smart: { mode: 'subject' } },
      { limit: 5, smart: { mode: 'subject' } },
      { subjectId: 'math', limit: 5, smart: { mode: 'nonsense' } },
    ];
    for (const payload of bad) {
      expect((await start(cookie, payload)).statusCode, JSON.stringify(payload)).toBe(400);
    }
    const topicsEmpty = await start(cookie, {
      subjectId: 'math',
      limit: 5,
      smart: { mode: 'topics', skillKeys: [] },
    });
    expect(topicsEmpty.statusCode).toBe(422);
  });
});
