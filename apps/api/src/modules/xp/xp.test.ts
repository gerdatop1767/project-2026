import { randomUUID } from 'node:crypto';
import { schema } from '@zybrilka/db';
import { createTestDb } from '@zybrilka/db/testing';
import { levelForXp, serializeMultiPartSpec } from '@zybrilka/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';

/**
 * XP (docs/XP.md), through the real HTTP routes in the production auth
 * setup: awarded only by the server for a graded correct answer, once per
 * result, the ledger and total always in step, level derived from total.
 */
describe('XP and levels', () => {
  let testDb: Awaited<ReturnType<typeof createTestDb>>;
  let app: ReturnType<typeof buildApp>;
  const tasks: Record<string, string> = {};

  async function addTask(key: string, values: Partial<typeof schema.tasks.$inferInsert>) {
    const [row] = await testDb.db
      .insert(schema.tasks)
      .values({
        subjectId: 'math',
        taskNumber: 1,
        difficulty: 2,
        conditionMd: `XP test task ${key}`,
        correctAnswer: '42',
        explanationMd: 'Объяснение.',
        source: 'test',
        status: 'published',
        ...values,
      })
      .returning();
    tasks[key] = row!.id;
  }

  async function signedIn(userId?: string) {
    let id = userId;
    if (!id) {
      const [user] = await testDb.db.insert(schema.users).values({}).returning();
      id = user!.id;
    }
    const sessionId = randomUUID();
    await testDb.db
      .insert(schema.authSessions)
      .values({ id: sessionId, userId: id, expiresAt: new Date(Date.now() + 3_600_000) });
    return { userId: id, cookie: `session_id=${sessionId}` };
  }

  const answer = (cookie: string | null, key: string, value: unknown) =>
    app.inject({
      method: 'POST',
      url: `/api/v1/tasks/${tasks[key]}/attempt`,
      headers: cookie ? { cookie } : {},
      payload: { answer: value },
    });
  const get = (cookie: string | null, url: string) =>
    app.inject({ method: 'GET', url, headers: cookie ? { cookie } : {} });
  const summary = async (cookie: string) => (await get(cookie, '/api/v1/progress/xp')).json();

  async function ledger(userId: string) {
    return testDb.db.select().from(schema.xpEvents).where(eq(schema.xpEvents.userId, userId));
  }

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
    await addTask('easy', { difficulty: 1 });
    await addTask('medium', { difficulty: 2, taskNumber: 5 });
    await addTask('hard', { difficulty: 3, taskNumber: 13 });
    await addTask('russian', { subjectId: 'russian', difficulty: 2, taskNumber: 9 });
    await addTask('unrated', { difficulty: 9, taskNumber: 7 });
    await addTask('race', { difficulty: 3, taskNumber: 14 });
    await addTask('review', { difficulty: 3, taskNumber: 16 });
    await addTask('multi', {
      difficulty: 3,
      taskNumber: 19,
      answerType: 'multi_part',
      correctAnswer: serializeMultiPartSpec({
        parts: [
          { id: 'a', label: 'а', answerType: 'short_answer', correctAnswer: '1' },
          { id: 'b', label: 'б', answerType: 'short_answer', correctAnswer: '2' },
        ],
      }),
    });
    for (let i = 0; i < 25; i++) await addTask(`bulk${i}`, { difficulty: 3, taskNumber: 18 });
  });

  afterAll(async () => {
    await app.close();
    await testDb.close();
  });

  it('a new account starts at level 1 with 0 XP', async () => {
    const me = await signedIn();
    expect(await summary(me.cookie)).toMatchObject({
      totalXp: 0,
      level: 1,
      nextLevelXp: 50,
      xpToNextLevel: 50,
      progress: 0,
      isMaxLevel: false,
    });
    expect((await get(me.cookie, '/api/v1/progress/xp/history')).json()).toEqual({
      items: [],
      nextCursor: null,
    });
  });

  it('awards XP by difficulty for a correct answer, nothing for a wrong one', async () => {
    const me = await signedIn();
    const wrong = (await answer(me.cookie, 'easy', '0')).json();
    expect(wrong.correct).toBe(false);
    expect(wrong.xp).toMatchObject({ awarded: 0, kind: null, totalXp: 0, level: 1 });

    expect((await answer(me.cookie, 'easy', '42')).json().xp).toMatchObject({
      awarded: 10,
      kind: 'task_first_solve',
      totalXp: 10,
    });
    expect((await answer(me.cookie, 'medium', '42')).json().xp.awarded).toBe(15);
    expect((await answer(me.cookie, 'hard', '42')).json().xp.awarded).toBe(25);
    expect((await summary(me.cookie)).totalXp).toBe(50);

    const events = await ledger(me.userId);
    expect(events).toHaveLength(3);
    expect(events.every((e) => e.attemptId !== null && e.sourceType === 'task')).toBe(true);
    const [total] = await testDb.db
      .select()
      .from(schema.userXp)
      .where(eq(schema.userXp.userId, me.userId));
    expect(total!.totalXp).toBe(events.reduce((s, e) => s + e.amount, 0));
  });

  it('gives no XP for answering the same task correctly again soon after', async () => {
    const me = await signedIn();
    await answer(me.cookie, 'medium', '42');
    const again = (await answer(me.cookie, 'medium', '42')).json();
    expect(again.correct).toBe(true);
    expect(again.xp).toMatchObject({ awarded: 0, totalXp: 15 });
    expect(await ledger(me.userId)).toHaveLength(1);
  });

  it('never double-counts concurrent submissions of the same result', async () => {
    const me = await signedIn();
    const results = await Promise.all(
      Array.from({ length: 6 }, () => answer(me.cookie, 'race', '42')),
    );
    const awarded = results.map((r) => r.json().xp.awarded as number);
    expect(awarded.filter((a) => a > 0)).toEqual([25]);
    expect((await summary(me.cookie)).totalXp).toBe(25);
    expect(await ledger(me.userId)).toHaveLength(1);
  });

  it('works the same for every subject', async () => {
    const me = await signedIn();
    const res = (await answer(me.cookie, 'russian', '42')).json();
    expect(res.xp.awarded).toBe(15);
    const history = (await get(me.cookie, '/api/v1/progress/xp/history')).json();
    expect(history.items[0]).toMatchObject({
      amount: 15,
      kind: 'task_first_solve',
      task: { subjectId: 'russian', subjectName: 'Русский язык', taskNumber: 9 },
    });
  });

  it('uses the transparent default for a task without a known difficulty', async () => {
    const me = await signedIn();
    expect((await answer(me.cookie, 'unrated', '42')).json().xp.awarded).toBe(15);
    const [event] = await ledger(me.userId);
    expect(event!.metadata).toMatchObject({ difficulty: 9, difficultyKnown: false });
  });

  it('a multi-part task earns XP only when every part is right', async () => {
    const me = await signedIn();
    const partial = (await answer(me.cookie, 'multi', { a: '1', b: '0' })).json();
    expect(partial.partStatus).toBe('partially_correct');
    expect(partial.xp.awarded).toBe(0);
    expect((await answer(me.cookie, 'multi', { a: '1', b: '2' })).json().xp.awarded).toBe(25);
  });

  it('rewards a later review with a capped share, once per day', async () => {
    const me = await signedIn();
    await answer(me.cookie, 'review', '42');
    // The first award was 8 days ago.
    await testDb.db
      .update(schema.xpEvents)
      .set({ createdAt: new Date(Date.now() - 8 * 86_400_000) })
      .where(eq(schema.xpEvents.userId, me.userId));
    const review = (await answer(me.cookie, 'review', '42')).json();
    expect(review.xp).toMatchObject({ awarded: 8, kind: 'task_review', totalXp: 33 });
    expect((await answer(me.cookie, 'review', '42')).json().xp.awarded).toBe(0);
  });

  it('crosses several levels at once and reports the level change', async () => {
    const me = await signedIn();
    // 24 earlier correct answers (from before XP existed) = 600 XP → level 5.
    for (let i = 0; i < 24; i++) {
      await testDb.db.insert(schema.attempts).values({
        userId: me.userId,
        taskId: tasks[`bulk${i}`]!,
        answerRaw: '42',
        isCorrect: true,
        createdAt: new Date(Date.now() - (30 - i) * 86_400_000),
      });
    }
    const first = await summary(me.cookie);
    expect(first).toMatchObject({ totalXp: 600, level: 5, levelStartXp: 420, nextLevelXp: 650 });
    expect(first.level).toBe(levelForXp(600));
    // Imported once: reading again changes nothing, the history keeps the real dates.
    expect((await summary(me.cookie)).totalXp).toBe(600);
    const history = (await get(me.cookie, '/api/v1/progress/xp/history')).json();
    expect(history.items).toHaveLength(20);
    expect(history.nextCursor).toEqual(expect.any(String));
    const page2 = (
      await get(me.cookie, `/api/v1/progress/xp/history?cursor=${history.nextCursor}`)
    ).json();
    expect(page2.items).toHaveLength(4);
    expect(page2.nextCursor).toBeNull();
    // An imported task solved 30 days ago counts as a review now (once).
    expect((await answer(me.cookie, 'bulk0', '42')).json().xp).toMatchObject({
      awarded: 8,
      kind: 'task_review',
    });
    expect((await answer(me.cookie, 'bulk0', '42')).json().xp.awarded).toBe(0);
    expect((await answer(me.cookie, 'bulk24', '42')).json().xp).toMatchObject({
      awarded: 25,
      totalXp: 633,
      previousLevel: 5,
      level: 5,
    });
    // The next one crosses into level 6.
    expect((await answer(me.cookie, 'hard', '42')).json().xp).toMatchObject({
      totalXp: 658,
      previousLevel: 5,
      level: 6,
    });
    expect((await summary(me.cookie)).level).toBe(6);
  });

  it('imports earlier history before grading, so the current answer is not lost', async () => {
    const me = await signedIn();
    await testDb.db.insert(schema.attempts).values({
      userId: me.userId,
      taskId: tasks.easy!,
      answerRaw: '42',
      isCorrect: true,
      createdAt: new Date(Date.now() - 86_400_000),
    });
    // First XP-aware request is an answer, not a summary read.
    const res = (await answer(me.cookie, 'hard', '42')).json();
    expect(res.xp).toMatchObject({ awarded: 25, totalXp: 35 });
  });

  it('keeps XP across sign-ins (a new session sees the same total)', async () => {
    const me = await signedIn();
    await answer(me.cookie, 'hard', '42');
    const again = await signedIn(me.userId);
    expect((await summary(again.cookie)).totalXp).toBe(25);
  });

  it('is private: guests get 401 and a guest answer carries no XP', async () => {
    expect((await get(null, '/api/v1/progress/xp')).statusCode).toBe(401);
    expect((await get(null, '/api/v1/progress/xp/history')).statusCode).toBe(401);
    const guest = await answer(null, 'easy', '42');
    expect(guest.json().correct).toBe(true);
    expect(guest.json().xp).toBeUndefined();
  });

  it('rejects a malformed history cursor', async () => {
    const me = await signedIn();
    const res = await get(me.cookie, '/api/v1/progress/xp/history?cursor=bm9wZQ');
    expect(res.statusCode).toBe(400);
  });

  it('never stores a non-positive event (database guard)', async () => {
    const me = await signedIn();
    await expect(
      testDb.db.insert(schema.xpEvents).values({
        userId: me.userId,
        amount: 0,
        kind: 'task_first_solve',
        sourceType: 'task',
        dedupKey: 'manual',
      }),
    ).rejects.toThrow();
    const rows = await testDb.db
      .select()
      .from(schema.xpEvents)
      .where(and(eq(schema.xpEvents.userId, me.userId), eq(schema.xpEvents.dedupKey, 'manual')));
    expect(rows).toHaveLength(0);
  });
});
