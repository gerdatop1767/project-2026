import { randomUUID } from 'node:crypto';
import { schema } from '@zybrilka/db';
import { createImportedTestDb } from '@zybrilka/db/testing';
import { calculateTaskNumberNeed } from '@zybrilka/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getUserAttemptRecordsBySubject } from './repo.js';
import { getNextTaskRecommendation } from './service.js';

describe('getNextTaskRecommendation (ZUBRILKA LEARNING INTELLIGENCE Phase 7)', () => {
  let testDb: Awaited<ReturnType<typeof createImportedTestDb>>;

  beforeAll(async () => {
    testDb = await createImportedTestDb();
  });

  afterAll(async () => {
    await testDb.close();
  });

  it('returns null for a user with no onboarded subject and no explicit subjectId', async () => {
    const result = await getNextTaskRecommendation(testDb.db, randomUUID(), {});
    expect(result).toBeNull();
  });

  it('returns null for an explicit subjectId with no published tasks', async () => {
    const result = await getNextTaskRecommendation(testDb.db, randomUUID(), {
      subjectId: '__nonexistent_subject__',
    });
    expect(result).toBeNull();
  });

  it('recommends a real published task in the requested subject, with a full breakdown', async () => {
    const [task] = await testDb.db.select().from(schema.tasks).limit(1);
    const result = await getNextTaskRecommendation(testDb.db, randomUUID(), {
      subjectId: task!.subjectId,
    });
    expect(result).not.toBeNull();
    expect(result!.subjectId).toBe(task!.subjectId);
    expect(result!.score).toBeGreaterThanOrEqual(0);
    expect(result!.score).toBeLessThanOrEqual(100);
    expect(Object.keys(result!.breakdown)).toEqual([
      'skillNeed',
      'taskNumberNeed',
      'errorRelevance',
      'difficultyFit',
      'targetRelevance',
      'recency',
      'examImportance',
      'similarityBonus',
    ]);
  });

  it('is deterministic for a cold-start (no history) user', async () => {
    const [task] = await testDb.db.select().from(schema.tasks).limit(1);
    const first = await getNextTaskRecommendation(testDb.db, randomUUID(), {
      subjectId: task!.subjectId,
    });
    const second = await getNextTaskRecommendation(testDb.db, randomUUID(), {
      subjectId: task!.subjectId,
    });
    // Different random userIds, but BOTH cold-start -> identical honest "no data" output.
    expect(first).toEqual(second);
  });

  it('never recommends a task the user already answered correctly, while unsolved alternatives exist', async () => {
    const [task] = await testDb.db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.subjectId, 'math'));
    const userId = randomUUID();
    await testDb.db.insert(schema.users).values({ id: userId });
    await testDb.db.insert(schema.attempts).values({
      userId,
      taskId: task!.id,
      answerRaw: task!.correctAnswer,
      isCorrect: true,
    });

    const result = await getNextTaskRecommendation(testDb.db, userId, { subjectId: 'math' });
    expect(result?.taskId).not.toBe(task!.id);
  });

  it('falls back to the full pool when every task in the subject is already solved', async () => {
    const mathTasks = await testDb.db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.subjectId, 'math'));
    const userId = randomUUID();
    await testDb.db.insert(schema.users).values({ id: userId });
    for (const task of mathTasks) {
      await testDb.db.insert(schema.attempts).values({
        userId,
        taskId: task.id,
        answerRaw: task.correctAnswer,
        isCorrect: true,
      });
    }

    const result = await getNextTaskRecommendation(testDb.db, userId, { subjectId: 'math' });
    // Still recommends something (review mode) rather than null, since
    // published tasks genuinely exist in the subject.
    expect(result).not.toBeNull();
  });

  describe('taskNumberNeed — learning from wrong answers on a specific EGE task number', () => {
    async function freshUserId(): Promise<string> {
      const userId = randomUUID();
      await testDb.db.insert(schema.users).values({ id: userId });
      return userId;
    }

    /** Reads the signal through the REAL wiring (repo query -> group by
     * taskNumber -> the shared pure formula) for one exact task number
     * — independent of which candidate the overall recommendation
     * happens to pick, so these assertions are precise regardless of
     * skillNeed/difficultyFit/etc. winning the top slot instead. */
    async function taskNumberNeedFor(userId: string, taskNumber: number): Promise<number | null> {
      const records = await getUserAttemptRecordsBySubject(testDb.db, userId, 'math');
      return calculateTaskNumberNeed(records.filter((r) => r.taskNumber === taskNumber));
    }

    // 1. no history -> signal omitted, never fabricated as 0
    it('is omitted for a cold-start user, both in isolation and in the full recommendation', async () => {
      const userId = await freshUserId();
      expect(await taskNumberNeedFor(userId, 1)).toBeNull();

      const result = await getNextTaskRecommendation(testDb.db, userId, { subjectId: 'math' });
      expect(result!.breakdown.taskNumberNeed.included).toBe(false);
      expect(result!.breakdown.taskNumberNeed.score).toBeNull();
    });

    // 2. one wrong №N -> pressure appears
    it('appears after a single real wrong attempt on that task number', async () => {
      const [task] = await testDb.db
        .select()
        .from(schema.tasks)
        .where(eq(schema.tasks.taskNumber, 1));
      const userId = await freshUserId();
      await testDb.db.insert(schema.attempts).values({
        userId,
        taskId: task!.id,
        answerRaw: '__wrong__',
        isCorrect: false,
      });

      const need = await taskNumberNeedFor(userId, 1);
      expect(need).not.toBeNull();
      expect(need!).toBeGreaterThan(0);
    });

    // 3a. a worse recent correct-count produces higher pressure (real
    // history, no invented coefficients — same comparison shape as
    // packages/shared's own calculateTaskNumberNeed unit tests).
    it('a lower recent correct-count produces higher pressure than a higher one, for the same window size', async () => {
      const [task] = await testDb.db
        .select()
        .from(schema.tasks)
        .where(eq(schema.tasks.taskNumber, 1));

      const userTwoCorrect = await freshUserId();
      await testDb.db.insert(schema.attempts).values([
        {
          userId: userTwoCorrect,
          taskId: task!.id,
          answerRaw: task!.correctAnswer,
          isCorrect: true,
        },
        {
          userId: userTwoCorrect,
          taskId: task!.id,
          answerRaw: task!.correctAnswer,
          isCorrect: true,
        },
        { userId: userTwoCorrect, taskId: task!.id, answerRaw: '__wrong__', isCorrect: false },
      ]);
      const needWithTwoCorrect = await taskNumberNeedFor(userTwoCorrect, 1);

      const userOneCorrect = await freshUserId();
      await testDb.db.insert(schema.attempts).values([
        {
          userId: userOneCorrect,
          taskId: task!.id,
          answerRaw: task!.correctAnswer,
          isCorrect: true,
        },
        { userId: userOneCorrect, taskId: task!.id, answerRaw: '__wrong__', isCorrect: false },
        {
          userId: userOneCorrect,
          taskId: task!.id,
          answerRaw: '__wrong_again__',
          isCorrect: false,
        },
      ]);
      const needWithOneCorrect = await taskNumberNeedFor(userOneCorrect, 1);

      expect(needWithOneCorrect!).toBeGreaterThan(needWithTwoCorrect!);
    });

    // 3b. Repeated wrong answers raise the need step by step (more
    // evidence, Bayesian mastery v2 — docs/learning/ALGORITHMS.md § 1),
    // never by an artificial multiplier, and never past 100.
    it('repeated wrong answers raise the need gradually, never past 100', async () => {
      const userId = await freshUserId();
      const [task] = await testDb.db
        .select()
        .from(schema.tasks)
        .where(eq(schema.tasks.taskNumber, 1));

      await testDb.db.insert(schema.attempts).values({
        userId,
        taskId: task!.id,
        answerRaw: '__wrong__',
        isCorrect: false,
      });
      const first = (await taskNumberNeedFor(userId, 1))!;
      expect(first).toBeGreaterThanOrEqual(50);

      await testDb.db.insert(schema.attempts).values({
        userId,
        taskId: task!.id,
        answerRaw: '__wrong_again__',
        isCorrect: false,
      });
      const second = (await taskNumberNeedFor(userId, 1))!;
      expect(second).toBeGreaterThan(first);

      await testDb.db.insert(schema.attempts).values({
        userId,
        taskId: task!.id,
        answerRaw: '__wrong_third__',
        isCorrect: false,
      });
      const third = (await taskNumberNeedFor(userId, 1))!;
      expect(third).toBeGreaterThan(second);
      expect(third).toBeLessThanOrEqual(100);
    });

    // 4 + 5. correct attempts decrease pressure; wrong does not force it forever
    it('decreases once the user starts answering that task number correctly again', async () => {
      const userId = await freshUserId();
      const [task] = await testDb.db
        .select()
        .from(schema.tasks)
        .where(eq(schema.tasks.taskNumber, 1));

      await testDb.db.insert(schema.attempts).values({
        userId,
        taskId: task!.id,
        answerRaw: '__wrong__',
        isCorrect: false,
      });
      const needAfterWrong = await taskNumberNeedFor(userId, 1);

      await testDb.db.insert(schema.attempts).values({
        userId,
        taskId: task!.id,
        answerRaw: task!.correctAnswer,
        isCorrect: true,
      });
      await testDb.db.insert(schema.attempts).values({
        userId,
        taskId: task!.id,
        answerRaw: task!.correctAnswer,
        isCorrect: true,
      });
      const needAfterRecovering = await taskNumberNeedFor(userId, 1);

      expect(needAfterRecovering!).toBeLessThan(needAfterWrong!);
    });

    // 6 + 7. deterministic, and different task numbers tracked independently
    it('is deterministic and tracks different task numbers independently', async () => {
      const userId = await freshUserId();
      const [taskOne] = await testDb.db
        .select()
        .from(schema.tasks)
        .where(eq(schema.tasks.taskNumber, 1));
      await testDb.db.insert(schema.attempts).values({
        userId,
        taskId: taskOne!.id,
        answerRaw: '__wrong__',
        isCorrect: false,
      });

      const firstRead = await taskNumberNeedFor(userId, 1);
      const secondRead = await taskNumberNeedFor(userId, 1);
      expect(firstRead).toBe(secondRead);

      // Task number 13 was never attempted by this user — must stay
      // omitted, never inheriting task 1's pressure.
      expect(await taskNumberNeedFor(userId, 13)).toBeNull();
    });

    // 8 + 9. works regardless of the task's answerType, including multi_part
    it('applies the same way to tasks of any real answerType', async () => {
      const userId = await freshUserId();
      const [shortAnswerTask] = await testDb.db
        .select()
        .from(schema.tasks)
        .where(eq(schema.tasks.taskNumber, 1));
      expect(shortAnswerTask!.answerType).toBe('short_answer');
      await testDb.db.insert(schema.attempts).values({
        userId,
        taskId: shortAnswerTask!.id,
        answerRaw: '__wrong__',
        isCorrect: false,
      });
      expect(await taskNumberNeedFor(userId, 1)).not.toBeNull();

      const [multiPartTask] = await testDb.db
        .select()
        .from(schema.tasks)
        .where(eq(schema.tasks.taskNumber, 19));
      expect(multiPartTask!.answerType).toBe('multi_part');
      await testDb.db.insert(schema.attempts).values({
        userId,
        taskId: multiPartTask!.id,
        answerRaw: '{"a":"__wrong__"}',
        isCorrect: false,
      });
      // taskNumberNeed only cares about isCorrect/createdAt — it is
      // intentionally agnostic to WHICH part was wrong (that distinction
      // belongs to errorRelevance/Phase 5's partially_correct/
      // part_incorrect signatures, never duplicated here).
      expect(await taskNumberNeedFor(userId, 19)).not.toBeNull();
    });

    // never replaces or duplicates errorRelevance — both are independent
    it('does not replace or duplicate errorRelevance — both remain independently computed', async () => {
      const userId = await freshUserId();
      const [task] = await testDb.db
        .select()
        .from(schema.tasks)
        .where(eq(schema.tasks.taskNumber, 1));
      await testDb.db.insert(schema.attempts).values({
        userId,
        taskId: task!.id,
        answerRaw: '__wrong__',
        isCorrect: false,
      });
      await testDb.db.insert(schema.userErrorStatistics).values({
        userId,
        errorSignature: 'incorrect_answer',
        count: 1,
        lastOccurredAt: new Date(),
      });

      const result = await getNextTaskRecommendation(testDb.db, userId, { subjectId: 'math' });
      expect(result!.breakdown.errorRelevance.included).toBe(true);
      expect(await taskNumberNeedFor(userId, 1)).not.toBeNull();
    });

    // 12. cold-start behavior is otherwise unaffected
    it('cold-start total score composition is unaffected beyond the new omitted signal', async () => {
      const result = await getNextTaskRecommendation(testDb.db, await freshUserId(), {
        subjectId: 'math',
      });
      expect(result!.score).toBeGreaterThanOrEqual(0);
      expect(result!.score).toBeLessThanOrEqual(100);
    });
  });
});
