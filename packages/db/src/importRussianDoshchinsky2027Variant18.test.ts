import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from './schema.js';
import { importRussianVariant18 } from './importRussianDoshchinsky2027Variant18.js';
import { createTestDb } from './testing.js';

/**
 * Verifies the Вариант 18 Russian import in isolation, mirroring
 * importRussianDoshchinsky2027Variant1.test.ts. Tasks 5, 10 and 18 were
 * resolved during a third audit pass (confirmed against the source page
 * images: task 5's real paronym error, task 10's genuine row3 match via
 * "проатлантическая" read as "pro-Atlantic policy", and task 18's two
 * parallel "Знаешь" + elliptical что-clause constructions). All 27 tasks
 * are now `published`.
 */
describe('importRussianVariant18', () => {
  let testDb: Awaited<ReturnType<typeof createTestDb>>;

  beforeAll(async () => {
    testDb = await createTestDb();
  });

  afterAll(async () => {
    await testDb.close();
  });

  it('imports all 27 task numbers (1-27), including essay task 27', async () => {
    const { db } = testDb;
    const result = await importRussianVariant18(db);
    expect(result.total).toBe(27);

    const rows = await db
      .select()
      .from(schema.tasks)
      .where(and(eq(schema.tasks.subjectId, 'russian'), eq(schema.tasks.sourceVariant, 18)));
    expect(rows.length).toBe(27);
    const numbers = rows.map((r) => r.taskNumber).sort((a, b) => a - b);
    expect(numbers).toEqual(Array.from({ length: 27 }, (_, i) => i + 1));
  });

  it('marks all 27 tasks published, 0 needs_review', async () => {
    const { db } = testDb;
    const rows = await db
      .select()
      .from(schema.tasks)
      .where(and(eq(schema.tasks.subjectId, 'russian'), eq(schema.tasks.sourceVariant, 18)));
    const needsReviewNumbers = rows
      .filter((r) => r.status === 'needs_review')
      .map((r) => r.taskNumber)
      .sort((a, b) => a - b);
    expect(needsReviewNumbers).toEqual([]);
    expect(rows.filter((r) => r.status === 'published').length).toBe(27);
  });

  it('task 27 is a published essay task with empty correctAnswer, never auto-graded, with a genuine sampleEssayMd', async () => {
    const { db } = testDb;
    const [task27] = await db
      .select()
      .from(schema.tasks)
      .where(
        and(
          eq(schema.tasks.subjectId, 'russian'),
          eq(schema.tasks.sourceVariant, 18),
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
      .where(and(eq(schema.tasks.subjectId, 'russian'), eq(schema.tasks.sourceVariant, 18)));
    for (const row of rows) {
      if (row.status !== 'published') continue;
      // Essay tasks intentionally carry an empty correctAnswer — never graded (EssayNotGradableError).
      if (row.answerType !== 'essay') {
        expect(row.correctAnswer.length).toBeGreaterThan(0);
      }
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
      .filter((p) => p.slug.startsWith('variant18-'))
      .map((p) => p.slug);
    expect(variantPassageSlugs.length).toBe(2);
  });

  it('keeps full provenance, separate from other variants/subjects, for every imported task', async () => {
    const { db } = testDb;
    const rows = await db
      .select()
      .from(schema.tasks)
      .where(and(eq(schema.tasks.subjectId, 'russian'), eq(schema.tasks.sourceVariant, 18)));
    for (const row of rows) {
      expect(row.source).toBe('Дощинский ЕГЭ 2027. Типовые экзаменационные варианты');
      expect(row.sourceDocument).toBe('Русский ЕГЭ 2027 вариант 18');
      expect(row.rawStatement).toBeTruthy();
      expect(row.contentHash).toBeTruthy();
      expect(row.tags).toContain('ege-russian-2027-variant-18');
    }
  });

  it('is idempotent — re-running does not duplicate rows or passages', async () => {
    const { db } = testDb;
    await importRussianVariant18(db);
    const tasksAfter = await db
      .select()
      .from(schema.tasks)
      .where(and(eq(schema.tasks.subjectId, 'russian'), eq(schema.tasks.sourceVariant, 18)));
    expect(tasksAfter.length).toBe(27);
  });
});
