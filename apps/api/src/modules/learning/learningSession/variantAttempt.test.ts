import { randomUUID } from 'node:crypto';
import { schema } from '@zybrilka/db';
import { createImportedTestDb } from '@zybrilka/db/testing';
import type { VariantAttemptDetail } from '@zybrilka/shared';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../../app.js';
import { loadConfig } from '../../../config.js';
import { submitAttempt } from '../../tasks/service.js';
import {
  advanceLearningSession,
  getVariantAttemptDetail,
  getVariantProgress,
  startVariantSession,
} from './service.js';

/**
 * One variant, several attempts: each attempt's statistics are its own —
 * the answers are linked to the attempt they were given in.
 */
describe('variant attempts — per-attempt results', () => {
  let testDb: Awaited<ReturnType<typeof createImportedTestDb>>;
  let app: ReturnType<typeof buildApp>;
  let variantId: string;
  let ordered: { id: string; correctAnswer: string; answerType: string }[];

  beforeAll(async () => {
    testDb = await createImportedTestDb();
    app = buildApp({
      version: 'test',
      db: testDb.db,
      authConfig: loadConfig({ NODE_ENV: 'test' }),
    });
    const [variant] = await testDb.db
      .select()
      .from(schema.variants)
      .where(eq(schema.variants.variantNumber, 1));
    variantId = variant!.id;
    const links = await testDb.db
      .select()
      .from(schema.variantTasks)
      .where(eq(schema.variantTasks.variantId, variantId))
      .orderBy(schema.variantTasks.position);
    const tasks = await testDb.db
      .select()
      .from(schema.tasks)
      .where(
        inArray(
          schema.tasks.id,
          links.map((l) => l.taskId),
        ),
      );
    ordered = links.map((l) => tasks.find((t) => t.id === l.taskId)!);
    // The first two tasks are answered by text in these tests.
    for (const t of ordered.slice(0, 2))
      expect(['short_answer', 'multiple_choice']).toContain(t.answerType);
  });
  afterAll(async () => {
    await app.close();
    await testDb.close();
  });

  const newUser = async () => {
    const id = randomUUID();
    await testDb.db.insert(schema.users).values({ id });
    return id;
  };
  const start = async (userId: string) => {
    const s = await startVariantSession(testDb.db, userId, variantId);
    if (!s || s.status !== 'active') throw new Error('not started');
    return s.sessionId;
  };
  const answer = (userId: string, index: number, right: boolean, sessionId?: string) =>
    submitAttempt(testDb.db, ordered[index]!.id, userId, {
      answer: right ? ordered[index]!.correctAnswer : 'заведомо неверно',
      timeSpentMs: 30_000,
      sessionId,
    });
  const detail = async (userId: string, sessionId: string) =>
    (await getVariantAttemptDetail(testDb.db, userId, sessionId)) as VariantAttemptDetail;

  it('two attempts of one variant keep their own answers', async () => {
    const user = await newUser();
    const first = await start(user);
    await answer(user, 0, false, first);
    await advanceLearningSession(testDb.db, user, first);
    await answer(user, 1, true, first);

    const second = await start(user);
    await answer(user, 0, true, second);

    const a = await detail(user, first);
    const b = await detail(user, second);
    expect(a.attribution).toBe('exact');
    expect(a.tasks.slice(0, 2).map((t) => t.outcome)).toEqual(['incorrect', 'correct']);
    expect(a.tasks[0]!.userAnswer).toBe('заведомо неверно');
    expect(a.tasks[0]!.correctAnswer).toBeTruthy();
    expect(a.tasks[0]!.explanationMd).toBeTruthy();
    expect(b.tasks.slice(0, 2).map((t) => t.outcome)).toEqual(['correct', 'not_reached']);
    expect([a.correctCount, a.incorrectCount]).toEqual([1, 1]);
    expect([b.correctCount, b.incorrectCount]).toEqual([1, 0]);

    // The history list agrees with each attempt's own detail.
    const list = await getVariantProgress(testDb.db, user);
    const item = (id: string) => list.items.find((i) => i.sessionId === id)!;
    expect([item(first).correctCount, item(first).incorrectCount]).toEqual([1, 1]);
    expect([item(second).correctCount, item(second).incorrectCount]).toEqual([1, 0]);
    expect(item(first).totalTimeMs).toBe(60_000);
  });

  it('the first answer decides; skipped and unreached tasks are told apart; time only when measured', async () => {
    const user = await newUser();
    const s = await start(user);
    await answer(user, 0, false, s);
    await answer(user, 0, true, s); // a re-try does not change the result
    await advanceLearningSession(testDb.db, user, s); // task 2 served, never answered
    await advanceLearningSession(testDb.db, user, s); // task 3 served

    const d = await detail(user, s);
    expect(d.status).toBe('active');
    expect(d.tasks[0]).toMatchObject({ outcome: 'incorrect', answers: 2, timeSpentMs: 30_000 });
    expect(d.tasks[1]!.outcome).toBe('skipped');
    expect(d.tasks[2]!.outcome).toBe('skipped');
    expect(d.tasks[3]!.outcome).toBe('not_reached');
    expect(d.skippedCount).toBe(2);
    expect(d.notReachedCount).toBe(ordered.length - 3);
    expect(d.accuracyPercent).toBe(0);
    expect([d.totalTimeMs, d.timedCount]).toEqual([30_000, 1]);
    expect(d.toRepeat.map((t) => t.taskId)).toEqual(ordered.slice(0, 3).map((t) => t.id));
    const byNumber = d.byTaskNumber.find((g) => g.key === String(d.tasks[0]!.taskNumber))!;
    expect(byNumber.correct).toBe(0);
    expect(d.plannedCount).toBe(ordered.length);
  });

  it('an answer claiming someone else’s, a finished, or an unrelated session is not linked to it', async () => {
    const owner = await newUser();
    const intruder = await newUser();
    const s = await start(owner);
    await answer(intruder, 0, true, s);
    expect((await detail(owner, s)).correctCount).toBe(0);
    // A task the session never served.
    await answer(owner, 5, true, s);
    const [row] = await testDb.db
      .select()
      .from(schema.attempts)
      .where(eq(schema.attempts.userId, owner));
    expect(row!.learningSessionId).toBeNull();
    const rows = await testDb.db
      .select()
      .from(schema.attempts)
      .where(eq(schema.attempts.learningSessionId, s));
    expect(rows).toHaveLength(0);
  });

  it('older attempts (no linked answers) use their own time window only', async () => {
    const user = await newUser();
    const s = await start(user);
    await answer(user, 0, false); // an old client: no session id
    await testDb.db
      .update(schema.learningSessions)
      .set({ status: 'completed', completedAt: new Date() })
      .where(eq(schema.learningSessions.id, s));
    await new Promise((r) => setTimeout(r, 5));
    await answer(user, 0, true); // after the attempt finished: not part of it
    const d = await detail(user, s);
    expect(d.attribution).toBe('time_window');
    expect(d.tasks[0]).toMatchObject({ outcome: 'incorrect', answers: 1 });
  });

  describe('HTTP', () => {
    async function cookieFor(userId: string) {
      const id = randomUUID();
      await testDb.db
        .insert(schema.authSessions)
        .values({ id, userId, expiresAt: new Date(Date.now() + 3_600_000) });
      return `session_id=${id}`;
    }

    it('only the owner opens an attempt; the session id from the client links answers', async () => {
      const owner = await newUser();
      const s = await start(owner);
      const cookie = await cookieFor(owner);
      const submit = await app.inject({
        method: 'POST',
        url: `/api/v1/tasks/${ordered[0]!.id}/attempt`,
        headers: { cookie },
        payload: { answer: ordered[0]!.correctAnswer, sessionId: s },
      });
      expect(submit.statusCode).toBe(200);
      const url = `/api/v1/progress/variants/${s}`;
      const mine = await app.inject({ method: 'GET', url, headers: { cookie } });
      expect(mine.statusCode).toBe(200);
      expect(mine.headers['cache-control']).toBe('no-store');
      expect((mine.json() as VariantAttemptDetail).tasks[0]!.outcome).toBe('correct');

      const other = await app.inject({
        method: 'GET',
        url,
        headers: { cookie: await cookieFor(await newUser()) },
      });
      expect(other.statusCode).toBe(404);
      expect((await app.inject({ method: 'GET', url })).statusCode).toBe(401);
      for (const bad of ['not-a-uuid', randomUUID()]) {
        const res = await app.inject({
          method: 'GET',
          url: `/api/v1/progress/variants/${bad}`,
          headers: { cookie },
        });
        expect(res.statusCode).toBe(404);
      }
      const badSession = await app.inject({
        method: 'POST',
        url: `/api/v1/tasks/${ordered[0]!.id}/attempt`,
        headers: { cookie },
        payload: { answer: '1', sessionId: 'nope' },
      });
      expect(badSession.statusCode).toBe(400);
    });
  });
});
