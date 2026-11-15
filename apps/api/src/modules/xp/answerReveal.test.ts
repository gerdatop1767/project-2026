import { randomUUID } from 'node:crypto';
import { schema } from '@zybrilka/db';
import { createSeededTestDb } from '@zybrilka/db/testing';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { ANSWER_SHOWN_SHARE, answerShownXpValue, decideTaskXp, taskXpValue } from './rules.js';

type TaskRow = typeof schema.tasks.$inferSelect;

/**
 * «Показать ответ» halves the XP of a first correct solve (docs/XP.md).
 * Production setup (`authConfig`, session cookies); everything is decided
 * on the server from what it recorded itself.
 */
describe('XP after «Показать ответ»', () => {
  let testDb: Awaited<ReturnType<typeof createSeededTestDb>>;
  let app: ReturnType<typeof buildApp>;
  let pool: TaskRow[];
  let next = 0;

  beforeAll(async () => {
    testDb = await createSeededTestDb();
    app = buildApp({
      version: 'test',
      db: testDb.db,
      authConfig: loadConfig({ NODE_ENV: 'test' }),
    });
    pool = await testDb.db
      .select()
      .from(schema.tasks)
      .where(
        and(eq(schema.tasks.answerType, 'short_answer'), eq(schema.tasks.status, 'published')),
      );
  });
  afterAll(async () => {
    await app.close();
    await testDb.close();
  });

  /** A fresh task for each scenario, so one test never sees another's history. */
  const freshTask = () => pool[next++]!;

  async function account() {
    const [user] = await testDb.db.insert(schema.users).values({}).returning();
    const sessionId = randomUUID();
    await testDb.db
      .insert(schema.authSessions)
      .values({ id: sessionId, userId: user!.id, expiresAt: new Date(Date.now() + 3_600_000) });
    return { userId: user!.id, cookie: `session_id=${sessionId}` };
  }

  const attempt = (task: TaskRow, cookie: string | null, answer: string, extra = {}) =>
    app.inject({
      method: 'POST',
      url: `/api/v1/tasks/${task.id}/attempt`,
      headers: cookie ? { cookie } : {},
      payload: { answer, ...extra },
    });
  const reveal = (task: TaskRow, cookie: string | null) =>
    app.inject({
      method: 'POST',
      url: `/api/v1/tasks/${task.id}/reveal`,
      headers: cookie ? { cookie } : {},
    });

  const totalXp = async (userId: string) =>
    (
      await testDb.db
        .select({ total: sql<number>`coalesce(sum(${schema.xpEvents.amount}), 0)::int` })
        .from(schema.xpEvents)
        .where(eq(schema.xpEvents.userId, userId))
    )[0]!.total;

  const full = (task: TaskRow) => taskXpValue(task).amount;
  const half = (task: TaskRow) => answerShownXpValue(task);

  it('the rule itself: 50% of the value, rounded, never below 1 XP', () => {
    expect(ANSWER_SHOWN_SHARE).toBe(0.5);
    const task = { id: 't', subjectId: 'math', taskNumber: 1, difficulty: 1 };
    const base = {
      task,
      correct: true,
      lastAwardAt: null,
      now: new Date(),
      moscowDate: '2026-11-14',
    };
    const own = decideTaskXp(base)!;
    const shown = decideTaskXp({ ...base, answerShown: true })!;
    expect(shown.amount).toBe(Math.max(1, Math.round(own.amount / 2)));
    expect(shown.kind).toBe('task_first_solve');
    expect(shown.dedupKey).toBe(own.dedupKey); // one first-solve award per task, full or half
    expect(decideTaskXp({ ...base, correct: false, answerShown: true })).toBeNull();
  });

  it('a correct answer solved on one’s own earns 100%', async () => {
    const { userId, cookie } = await account();
    const task = freshTask();
    const res = await attempt(task, cookie, task.correctAnswer);
    expect(res.json().correct).toBe(true);
    expect(res.json().xp.awarded).toBe(full(task));
    expect(await totalXp(userId)).toBe(full(task));
  });

  it('after «Показать ответ» the correct answer earns 50%', async () => {
    const { userId, cookie } = await account();
    const task = freshTask();
    const shown = await reveal(task, cookie);
    expect(shown.statusCode).toBe(200);
    expect(shown.json().correctAnswer).toBe(task.correctAnswer);
    const res = await attempt(task, cookie, task.correctAnswer);
    expect(res.json().xp.awarded).toBe(half(task));
    expect(await totalXp(userId)).toBe(half(task));
    const [event] = await testDb.db
      .select()
      .from(schema.xpEvents)
      .where(eq(schema.xpEvents.userId, userId));
    expect(event!.metadata).toMatchObject({ answerShown: true, share: 0.5 });
  });

  it('opening the answer again adds no XP and keeps one record', async () => {
    const { userId, cookie } = await account();
    const task = freshTask();
    for (let i = 0; i < 3; i++) expect((await reveal(task, cookie)).statusCode).toBe(200);
    expect(await totalXp(userId)).toBe(0);
    const rows = await testDb.db
      .select()
      .from(schema.taskAnswerReveals)
      .where(eq(schema.taskAnswerReveals.userId, userId));
    expect(rows).toHaveLength(1);
    await attempt(task, cookie, task.correctAnswer);
    await reveal(task, cookie);
    expect(await totalXp(userId)).toBe(half(task));
  });

  it('repeating the request cannot farm XP or top a half award up to full', async () => {
    const { userId, cookie } = await account();
    const task = freshTask();
    await reveal(task, cookie);
    const first = await attempt(task, cookie, task.correctAnswer);
    expect(first.json().xp.awarded).toBe(half(task));
    const again = await Promise.all([
      attempt(task, cookie, task.correctAnswer),
      attempt(task, cookie, task.correctAnswer),
    ]);
    for (const res of again) expect(res.json().xp.awarded).toBe(0);
    expect(await totalXp(userId)).toBe(half(task));
  });

  it('request parameters cannot claim a full award', async () => {
    const { userId, cookie } = await account();
    const task = freshTask();
    await reveal(task, cookie);
    const res = await attempt(task, cookie, task.correctAnswer, {
      answerShown: false,
      share: 1,
      xp: 999,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().xp.awarded).toBe(half(task));
    expect(await totalXp(userId)).toBe(half(task));
  });

  it('a wrong answer earns nothing, and the correct one after it (answer was shown) earns 50%', async () => {
    const { userId, cookie } = await account();
    const task = freshTask();
    const wrong = await attempt(task, cookie, '__definitely_wrong__');
    expect(wrong.json().correct).toBe(false);
    expect(wrong.json().xp.awarded).toBe(0);
    // The wrong answer's response already carried the correct one.
    expect(wrong.json().correctAnswer).toBe(task.correctAnswer);
    const right = await attempt(task, cookie, task.correctAnswer);
    expect(right.json().xp.awarded).toBe(half(task));
    expect(await totalXp(userId)).toBe(half(task));
  });

  it('attempt history and statistics stay intact; a reveal is not an attempt', async () => {
    const { userId, cookie } = await account();
    const task = freshTask();
    await reveal(task, cookie);
    const attemptsAfterReveal = await testDb.db
      .select()
      .from(schema.attempts)
      .where(eq(schema.attempts.userId, userId));
    expect(attemptsAfterReveal).toHaveLength(0);
    await attempt(task, cookie, task.correctAnswer);
    const attempts = await testDb.db
      .select()
      .from(schema.attempts)
      .where(eq(schema.attempts.userId, userId));
    expect(attempts.map((a) => a.isCorrect)).toEqual([true]);
    // After a reveal the task itself opens with its solution, as after an attempt.
    const opened = await app.inject({
      method: 'GET',
      url: `/api/v1/tasks/${task.id}`,
      headers: { cookie },
    });
    expect(opened.json().correctAnswer).toBe(task.correctAnswer);
  });

  it('a guest can see the answer, but nothing is stored and no XP is awarded', async () => {
    const task = freshTask();
    const before = await testDb.db.select().from(schema.taskAnswerReveals);
    const shown = await reveal(task, null);
    expect(shown.statusCode).toBe(200);
    expect(shown.json().correctAnswer).toBe(task.correctAnswer);
    expect(await testDb.db.select().from(schema.taskAnswerReveals)).toHaveLength(before.length);
    const res = await attempt(task, null, task.correctAnswer);
    expect(res.json().correct).toBe(true);
    expect(res.json().xp ?? null).toBeNull();
  });

  it('another account’s reveal does not touch my award', async () => {
    const other = await account();
    const me = await account();
    const task = freshTask();
    await reveal(task, other.cookie);
    const res = await attempt(task, me.cookie, task.correctAnswer);
    expect(res.json().xp.awarded).toBe(full(task));
  });

  it('the rule is the same in every subject', async () => {
    const subjectIds = (
      await testDb.db.select({ id: schema.subjects.id }).from(schema.subjects)
    ).map((r) => r.id);
    expect(subjectIds).toEqual(expect.arrayContaining(['math', 'russian']));
    for (const subjectId of subjectIds) {
      const [own, shownTask] = await testDb.db
        .insert(schema.tasks)
        .values(
          [1, 2].map((n) => ({
            subjectId,
            taskNumber: n,
            difficulty: 2,
            conditionMd: `XP subject test ${subjectId} ${n}`,
            correctAnswer: '42',
            explanationMd: 'Объяснение.',
            source: 'test',
            status: 'published' as const,
          })),
        )
        .returning();
      const { cookie } = await account();
      expect((await attempt(own!, cookie, '42')).json().xp.awarded).toBe(full(own!));
      await reveal(shownTask!, cookie);
      expect((await attempt(shownTask!, cookie, '42')).json().xp.awarded).toBe(half(shownTask!));
    }
  });

  it('XP already awarded is never changed by the new rule', async () => {
    const { userId, cookie } = await account();
    const task = freshTask();
    await attempt(task, cookie, task.correctAnswer);
    const before = await totalXp(userId);
    await reveal(task, cookie);
    await attempt(task, cookie, task.correctAnswer);
    expect(await totalXp(userId)).toBe(before);
  });
});
