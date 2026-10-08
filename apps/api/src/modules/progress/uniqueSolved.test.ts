import { randomUUID } from 'node:crypto';
import { schema } from '@zybrilka/db';
import { createImportedVariantsTestDb, createSeededTestDb } from '@zybrilka/db/testing';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { submitAttempt } from '../tasks/service.js';
import { getSummary } from './service.js';

/**
 * Statistics bugfix regression: "Решено" (`bySubject[].uniqueSolved`)
 * must count DISTINCT tasks (by `taskId`) with at least one correct
 * attempt — never attempt rows (the old `solved` field, which this
 * stays additive to — see progress.ts's doc comment). Re-solving the
 * same task any number of times, correctly or not, only ever counts
 * once in `uniqueSolved`; it requires at least one correct attempt to
 * count at all.
 */
describe('uniqueSolved — distinct correctly-solved tasks, not attempt rows', () => {
  let testDb: Awaited<ReturnType<typeof createSeededTestDb>>;

  beforeAll(async () => {
    testDb = await createSeededTestDb();
  });

  afterAll(async () => {
    await testDb.close();
  });

  async function freshUserId(): Promise<string> {
    const userId = randomUUID();
    await testDb.db.insert(schema.users).values({ id: userId });
    return userId;
  }

  async function mathTask(taskNumber: number) {
    const [task] = await testDb.db
      .select()
      .from(schema.tasks)
      .where(and(eq(schema.tasks.subjectId, 'math'), eq(schema.tasks.taskNumber, taskNumber)));
    if (!task) throw new Error(`no seeded math task #${taskNumber}`);
    return task;
  }

  async function uniqueSolvedForMath(userId: string): Promise<number> {
    const summary = await getSummary(testDb.db, userId);
    return summary.bySubject.find((s) => s.subjectId === 'math')?.uniqueSolved ?? 0;
  }

  it('A: 100 incorrect attempts on one task => uniqueSolved = 0', async () => {
    const userId = await freshUserId();
    const task = await mathTask(1);
    for (let i = 0; i < 100; i++) {
      await submitAttempt(testDb.db, task.id, userId, { answer: 'wrong' });
    }
    expect(await uniqueSolvedForMath(userId)).toBe(0);
  });

  it('B: incorrect then correct on one task => uniqueSolved = 1', async () => {
    const userId = await freshUserId();
    const task = await mathTask(1);
    await submitAttempt(testDb.db, task.id, userId, { answer: 'wrong' });
    await submitAttempt(testDb.db, task.id, userId, { answer: task.correctAnswer });
    expect(await uniqueSolvedForMath(userId)).toBe(1);
  });

  it('C: 100 correct attempts on the same task => uniqueSolved = 1, never 100', async () => {
    const userId = await freshUserId();
    const task = await mathTask(1);
    for (let i = 0; i < 100; i++) {
      await submitAttempt(testDb.db, task.id, userId, { answer: task.correctAnswer });
    }
    expect(await uniqueSolvedForMath(userId)).toBe(1);
  });

  it('D: correct, incorrect, correct on one task => uniqueSolved = 1', async () => {
    const userId = await freshUserId();
    const task = await mathTask(1);
    await submitAttempt(testDb.db, task.id, userId, { answer: task.correctAnswer });
    await submitAttempt(testDb.db, task.id, userId, { answer: 'wrong' });
    await submitAttempt(testDb.db, task.id, userId, { answer: task.correctAnswer });
    expect(await uniqueSolvedForMath(userId)).toBe(1);
  });

  it('E: a single correct attempt => uniqueSolved = 1', async () => {
    const userId = await freshUserId();
    const task = await mathTask(2);
    await submitAttempt(testDb.db, task.id, userId, { answer: task.correctAnswer });
    expect(await uniqueSolvedForMath(userId)).toBe(1);
  });

  it('two different tasks both solved correctly => uniqueSolved = 2', async () => {
    const userId = await freshUserId();
    const task1 = await mathTask(1);
    const task2 = await mathTask(2);
    await submitAttempt(testDb.db, task1.id, userId, { answer: task1.correctAnswer });
    await submitAttempt(testDb.db, task2.id, userId, { answer: task2.correctAnswer });
    expect(await uniqueSolvedForMath(userId)).toBe(2);
  });

  it('old attempt-based fields keep their existing meaning: solved counts attempt rows, correct counts correct attempt rows', async () => {
    const userId = await freshUserId();
    const task = await mathTask(1);
    await submitAttempt(testDb.db, task.id, userId, { answer: 'wrong' });
    await submitAttempt(testDb.db, task.id, userId, { answer: 'wrong' });
    await submitAttempt(testDb.db, task.id, userId, { answer: task.correctAnswer });

    const summary = await getSummary(testDb.db, userId);
    const mathRow = summary.bySubject.find((s) => s.subjectId === 'math')!;
    // 3 attempt rows total, 1 correct — the pre-existing attempt-based
    // semantics other screens (Statistics/Profile/Home) rely on, must
    // stay exactly as before this fix.
    expect(mathRow.solved).toBe(3);
    expect(mathRow.correct).toBe(1);
    expect(mathRow.accuracyPercent).toBeCloseTo((1 / 3) * 100, 1);
    // And the new field, on the same row, correctly dedupes to 1.
    expect(mathRow.uniqueSolved).toBe(1);
  });
});

/**
 * F: the specific real-data scenario from the bugfix request — two
 * DIFFERENT real EGE tasks (Вариант 1's №7 and Вариант 2's №7,
 * different taskIds, same taskNumber) both solved correctly must count
 * as uniqueSolved = 2, never collapsed to 1 by taskNumber.
 */
describe('uniqueSolved — real V1/V2 Вариант data, counted by taskId never taskNumber', () => {
  let testDb: Awaited<ReturnType<typeof createImportedVariantsTestDb>>;

  beforeAll(async () => {
    testDb = await createImportedVariantsTestDb();
  });

  afterAll(async () => {
    await testDb.close();
  });

  it('V1 #7 and V2 #7 (different taskIds) both correct => uniqueSolved = 2', async () => {
    const userId = randomUUID();
    await testDb.db.insert(schema.users).values({ id: userId });

    const [v1Task7] = await testDb.db
      .select()
      .from(schema.tasks)
      .where(
        and(
          eq(schema.tasks.subjectId, 'math'),
          eq(schema.tasks.taskNumber, 7),
          eq(schema.tasks.sourceVariant, 1),
        ),
      );
    const [v2Task7] = await testDb.db
      .select()
      .from(schema.tasks)
      .where(
        and(
          eq(schema.tasks.subjectId, 'math'),
          eq(schema.tasks.taskNumber, 7),
          eq(schema.tasks.sourceVariant, 2),
        ),
      );
    expect(v1Task7).toBeDefined();
    expect(v2Task7).toBeDefined();
    expect(v1Task7!.id).not.toBe(v2Task7!.id);

    await submitAttempt(testDb.db, v1Task7!.id, userId, { answer: v1Task7!.correctAnswer });
    await submitAttempt(testDb.db, v2Task7!.id, userId, { answer: v2Task7!.correctAnswer });

    const summary = await getSummary(testDb.db, userId);
    const mathRow = summary.bySubject.find((s) => s.subjectId === 'math')!;
    expect(mathRow.uniqueSolved).toBe(2);
  });
});
