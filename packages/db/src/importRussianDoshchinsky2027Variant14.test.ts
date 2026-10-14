import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from './schema.js';
import { importRussianVariant14 } from './importRussianDoshchinsky2027Variant14.js';
import { createTestDb } from './testing.js';

/**
 * Verifies the Вариант 14 Russian import in isolation, mirroring
 * importRussianDoshchinsky2027Variant1.test.ts. 1 of 27 tasks are
 * intentionally `needs_review` (27) — genuine unresolved
 * derivation questions (and the essay task 27, which this variant does not
 * carry a sampleEssayMd for), not guessed to inflate the published count.
 * See variant14-audit2-report.md for the full per-task reasoning.
 */
describe('importRussianVariant14', () => {
  let testDb: Awaited<ReturnType<typeof createTestDb>>;

  beforeAll(async () => {
    testDb = await createTestDb();
  });

  afterAll(async () => {
    await testDb.close();
  });

  it('imports all 27 task numbers (1-27), including essay task 27', async () => {
    const { db } = testDb;
    const result = await importRussianVariant14(db);
    expect(result.total).toBe(27);

    const rows = await db
      .select()
      .from(schema.tasks)
      .where(and(eq(schema.tasks.subjectId, 'russian'), eq(schema.tasks.sourceVariant, 14)));
    expect(rows.length).toBe(27);
    const numbers = rows.map((r) => r.taskNumber).sort((a, b) => a - b);
    expect(numbers).toEqual(Array.from({ length: 27 }, (_, i) => i + 1));
  });

  it('marks exactly 26 of 27 tasks published, 1 needs_review (27)', async () => {
    const { db } = testDb;
    const rows = await db
      .select()
      .from(schema.tasks)
      .where(and(eq(schema.tasks.subjectId, 'russian'), eq(schema.tasks.sourceVariant, 14)));
    const needsReviewNumbers = rows
      .filter((r) => r.status === 'needs_review')
      .map((r) => r.taskNumber)
      .sort((a, b) => a - b);
    expect(needsReviewNumbers).toEqual([27]);
    expect(rows.filter((r) => r.status === 'published').length).toBe(26);
  });

  it('task 27 is an essay task with empty correctAnswer, never auto-graded', async () => {
    const { db } = testDb;
    const [task27] = await db
      .select()
      .from(schema.tasks)
      .where(
        and(
          eq(schema.tasks.subjectId, 'russian'),
          eq(schema.tasks.sourceVariant, 14),
          eq(schema.tasks.taskNumber, 27),
        ),
      );
    expect(task27).toBeDefined();
    expect(task27!.answerType).toBe('essay');
    expect(task27!.correctAnswer).toBe('');
    expect(task27!.status).toBe('needs_review');
    expect(task27!.passageId).not.toBeNull();
  });

  it('every published task has a non-empty correctAnswer and explanationMd', async () => {
    const { db } = testDb;
    const rows = await db
      .select()
      .from(schema.tasks)
      .where(and(eq(schema.tasks.subjectId, 'russian'), eq(schema.tasks.sourceVariant, 14)));
    for (const row of rows) {
      if (row.status !== 'published') continue;
      expect(row.correctAnswer.length).toBeGreaterThan(0);
      expect(row.explanationMd.length).toBeGreaterThan(0);
      expect(row.hintMd?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it('stores each shared passage body exactly once, not duplicated per task', async () => {
    const { db } = testDb;
    const passages = await db
      .select()
      .from(schema.passages)
      .where(eq(schema.passages.subjectId, 'russian'));
    const variantPassageSlugs = passages
      .filter((p) => p.slug.startsWith('variant14-'))
      .map((p) => p.slug);
    expect(variantPassageSlugs.length).toBe(2);
  });

  it('keeps full provenance, separate from other variants/subjects, for every imported task', async () => {
    const { db } = testDb;
    const rows = await db
      .select()
      .from(schema.tasks)
      .where(and(eq(schema.tasks.subjectId, 'russian'), eq(schema.tasks.sourceVariant, 14)));
    for (const row of rows) {
      expect(row.source).toBe('Дощинский ЕГЭ 2027. Типовые экзаменационные варианты');
      expect(row.sourceDocument).toBe('Русский ЕГЭ 2027 вариант 14');
      expect(row.rawStatement).toBeTruthy();
      expect(row.contentHash).toBeTruthy();
      expect(row.tags).toContain('ege-russian-2027-variant-14');
    }
  });

  it('is idempotent — re-running does not duplicate rows or passages', async () => {
    const { db } = testDb;
    await importRussianVariant14(db);
    const tasksAfter = await db
      .select()
      .from(schema.tasks)
      .where(and(eq(schema.tasks.subjectId, 'russian'), eq(schema.tasks.sourceVariant, 14)));
    expect(tasksAfter.length).toBe(27);
  });
});
