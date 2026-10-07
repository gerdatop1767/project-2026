import { schema } from '@zybrilka/db';
import { createImportedVariantsTestDb } from '@zybrilka/db/testing';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getSimilarTasks } from './service.js';

/**
 * Block D (import EGE 2026 variants 2-5): proves the taskNumber hard
 * filter (commit 7b311ca, apps/api/src/modules/learning/taskSimilarity/
 * repo.ts) still holds on REAL imported rows spanning four real exam
 * variants (Вариант 1, 2, 3 and 4 of the same Ященко collection), not
 * just the synthetic adversarial fixture in sameTaskNumber.test.ts.
 * Each variant's task №N is a genuinely different task (different
 * topic/skills/condition) — Similar Tasks for one must only ever
 * surface same-numbered tasks from the other variants, never a
 * different-numbered one from any variant.
 */
describe('getSimilarTasks — real imported data (Вариант 1 + 2 + 3 + 4), same taskNumber only', () => {
  let testDb: Awaited<ReturnType<typeof createImportedVariantsTestDb>>;

  beforeAll(async () => {
    testDb = await createImportedVariantsTestDb();
  });

  afterAll(async () => {
    await testDb.close();
  });

  it('Вариант 1 task №7 only ever surfaces другого taskNumber=7 task, never a different number', async () => {
    const { db } = testDb;
    const [v1task7] = await db
      .select()
      .from(schema.tasks)
      .where(
        and(
          eq(schema.tasks.subjectId, 'math'),
          eq(schema.tasks.taskNumber, 7),
          eq(schema.tasks.sourceVariant, 1),
        ),
      );
    expect(v1task7).toBeDefined();

    const similar = await getSimilarTasks(db, v1task7!.id, 20);
    expect(similar.length).toBeGreaterThan(0);
    expect(similar.every((r) => r.taskNumber === 7)).toBe(true);
    expect(similar.every((r) => r.taskId !== v1task7!.id)).toBe(true);
  });

  it('Вариант 2 task №7 surfaces both Вариант 1 and Вариант 3 task №7 as candidates, never a different number', async () => {
    const { db } = testDb;
    const [v1task7] = await db
      .select()
      .from(schema.tasks)
      .where(
        and(
          eq(schema.tasks.subjectId, 'math'),
          eq(schema.tasks.taskNumber, 7),
          eq(schema.tasks.sourceVariant, 1),
        ),
      );
    const [v2task7] = await db
      .select()
      .from(schema.tasks)
      .where(
        and(
          eq(schema.tasks.subjectId, 'math'),
          eq(schema.tasks.taskNumber, 7),
          eq(schema.tasks.sourceVariant, 2),
        ),
      );
    const [v3task7] = await db
      .select()
      .from(schema.tasks)
      .where(
        and(
          eq(schema.tasks.subjectId, 'math'),
          eq(schema.tasks.taskNumber, 7),
          eq(schema.tasks.sourceVariant, 3),
        ),
      );

    const similar = await getSimilarTasks(db, v2task7!.id, 20);
    const ids = similar.map((r) => r.taskId);
    expect(ids).toContain(v1task7!.id);
    expect(ids).toContain(v3task7!.id);
    expect(similar.every((r) => r.taskNumber === 7)).toBe(true);
  });

  it.each([1, 10, 19])(
    'Вариант 4 task №%i only ever surfaces same-numbered tasks from V1-V3, never a different number',
    async (taskNumber) => {
      const { db } = testDb;
      const [v4task] = await db
        .select()
        .from(schema.tasks)
        .where(
          and(
            eq(schema.tasks.subjectId, 'math'),
            eq(schema.tasks.taskNumber, taskNumber),
            eq(schema.tasks.sourceVariant, 4),
          ),
        );
      expect(v4task).toBeDefined();

      const similar = await getSimilarTasks(db, v4task!.id, 20);
      expect(similar.length).toBeGreaterThan(0);
      expect(similar.every((r) => r.taskNumber === taskNumber)).toBe(true);
      expect(similar.every((r) => r.taskId !== v4task!.id)).toBe(true);
    },
  );

  it('every real task number 1-19 that exists in both variants only ever cross-links within its own number', async () => {
    const { db } = testDb;
    const allTasks = await db
      .select({ id: schema.tasks.id, taskNumber: schema.tasks.taskNumber })
      .from(schema.tasks)
      .where(eq(schema.tasks.subjectId, 'math'));

    for (const task of allTasks) {
      const similar = await getSimilarTasks(db, task.id, 20);
      for (const candidate of similar) {
        expect(candidate.taskNumber).toBe(task.taskNumber);
      }
    }
  });
});
