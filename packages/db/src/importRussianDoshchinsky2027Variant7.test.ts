import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from './schema.js';
import { importRussianVariant7 } from './importRussianDoshchinsky2027Variant7.js';
import { createTestDb } from './testing.js';

/**
 * Verifies the Вариант 7 Russian import in isolation, mirroring
 * importRussianDoshchinsky2027Variant1.test.ts. 1 of 27 tasks is
 * intentionally `needs_review` (21) — no two of its 9 candidate
 * sentences shared a clearly identical punctuation rule, so no answer
 * is forced to inflate the published count.
 */
describe('importRussianVariant7', () => {
  let testDb: Awaited<ReturnType<typeof createTestDb>>;

  beforeAll(async () => {
    testDb = await createTestDb();
  });

  afterAll(async () => {
    await testDb.close();
  });

  it('imports all 27 task numbers (1-27), including essay task 27', async () => {
    const { db } = testDb;
    const result = await importRussianVariant7(db);
    expect(result.total).toBe(27);

    const rows = await db
      .select()
      .from(schema.tasks)
      .where(and(eq(schema.tasks.subjectId, 'russian'), eq(schema.tasks.sourceVariant, 7)));
    expect(rows.length).toBe(27);
    const numbers = rows.map((r) => r.taskNumber).sort((a, b) => a - b);
    expect(numbers).toEqual(Array.from({ length: 27 }, (_, i) => i + 1));
  });

  it('marks exactly 26 of 27 tasks published, 1 needs_review (21)', async () => {
    const { db } = testDb;
    const rows = await db
      .select()
      .from(schema.tasks)
      .where(and(eq(schema.tasks.subjectId, 'russian'), eq(schema.tasks.sourceVariant, 7)));
    const needsReviewNumbers = rows
      .filter((r) => r.status === 'needs_review')
      .map((r) => r.taskNumber)
      .sort((a, b) => a - b);
    expect(needsReviewNumbers).toEqual([21]);
    expect(rows.filter((r) => r.status === 'published').length).toBe(26);
  });

  it('task 27 is a published essay task with empty correctAnswer, never auto-graded, with a genuine sampleEssayMd', async () => {
    const { db } = testDb;
    const [task27] = await db
      .select()
      .from(schema.tasks)
      .where(
        and(
          eq(schema.tasks.subjectId, 'russian'),
          eq(schema.tasks.sourceVariant, 7),
          eq(schema.tasks.taskNumber, 27),
        ),
      );
    expect(task27).toBeDefined();
    expect(task27!.answerType).toBe('essay');
    expect(task27!.correctAnswer).toBe('');
    expect(task27!.status).toBe('published');
    expect(task27!.passageId).not.toBeNull();
    expect(task27!.sampleEssayMd).toBeTruthy();
    expect(task27!.sampleEssayMd).toContain('пример');
  });

  it('every published task has a non-empty correctAnswer and explanationMd', async () => {
    const { db } = testDb;
    const rows = await db
      .select()
      .from(schema.tasks)
      .where(and(eq(schema.tasks.subjectId, 'russian'), eq(schema.tasks.sourceVariant, 7)));
    for (const row of rows) {
      if (row.status !== 'published') continue;
      if (row.answerType !== 'essay') {
        expect(row.correctAnswer.length).toBeGreaterThan(0);
      }
      expect(row.explanationMd.length).toBeGreaterThan(0);
      expect(row.hintMd?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it('needs_review task (21) is honest about what is unconfirmed, not silently empty', async () => {
    const { db } = testDb;
    const [task21] = await db
      .select()
      .from(schema.tasks)
      .where(
        and(
          eq(schema.tasks.subjectId, 'russian'),
          eq(schema.tasks.sourceVariant, 7),
          eq(schema.tasks.taskNumber, 21),
        ),
      );
    expect(task21).toBeDefined();
    expect(task21!.explanationMd.length).toBeGreaterThan(0);
    expect(task21!.explanationMd).not.toContain('`');
  });

  it('no explanationMd contains a backtick (code-span markdown MathText does not render)', async () => {
    const { db } = testDb;
    const rows = await db
      .select()
      .from(schema.tasks)
      .where(and(eq(schema.tasks.subjectId, 'russian'), eq(schema.tasks.sourceVariant, 7)));
    for (const row of rows) {
      expect(row.explanationMd).not.toContain('`');
    }
  });

  it('stores each shared passage body exactly once, not duplicated per task', async () => {
    const { db } = testDb;
    const passages = await db
      .select()
      .from(schema.passages)
      .where(eq(schema.passages.subjectId, 'russian'));
    const variantPassageSlugs = passages
      .filter((p) => p.slug.startsWith('doshchinskiy-2027-v7-'))
      .map((p) => p.slug);
    expect(variantPassageSlugs.length).toBe(2);
  });

  it('keeps full provenance, separate from other variants/subjects, for every imported task', async () => {
    const { db } = testDb;
    const rows = await db
      .select()
      .from(schema.tasks)
      .where(and(eq(schema.tasks.subjectId, 'russian'), eq(schema.tasks.sourceVariant, 7)));
    for (const row of rows) {
      expect(row.source).toBe('Дощинский ЕГЭ 2027. Типовые экзаменационные варианты');
      expect(row.sourceDocument).toBe('Русский ЕГЭ 2027 вариант 7');
      expect(row.rawStatement).toBeTruthy();
      expect(row.contentHash).toBeTruthy();
      expect(row.tags).toContain('ege-russian-2027-variant-7');
    }
  });

  it('is idempotent — re-running does not duplicate rows or passages', async () => {
    const { db } = testDb;
    await importRussianVariant7(db);
    const tasksAfter = await db
      .select()
      .from(schema.tasks)
      .where(and(eq(schema.tasks.subjectId, 'russian'), eq(schema.tasks.sourceVariant, 7)));
    expect(tasksAfter.length).toBe(27);
  });
});
