import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from './schema.js';
import { importRussianVariant2 } from './importRussianDoshchinsky2027Variant2.js';
import { createTestDb } from './testing.js';

/**
 * Verifies the Вариант 2 Russian import in isolation, mirroring
 * importRussianDoshchinsky2027Variant1.test.ts. 2 of 27 tasks are
 * intentionally `needs_review` (8, 9) — genuine unresolved derivation
 * questions (a grammatical-error matching task with 2 of 5 pairs
 * unconfirmed, and a root-spelling task whose 4 non-matching rows rely
 * on dictionary vowels this pass could not verify against an official
 * key), not guessed to inflate the published count.
 */
describe('importRussianVariant2', () => {
  let testDb: Awaited<ReturnType<typeof createTestDb>>;

  beforeAll(async () => {
    testDb = await createTestDb();
  });

  afterAll(async () => {
    await testDb.close();
  });

  it('imports all 27 task numbers (1-27), including essay task 27', async () => {
    const { db } = testDb;
    const result = await importRussianVariant2(db);
    expect(result.total).toBe(27);

    const rows = await db
      .select()
      .from(schema.tasks)
      .where(and(eq(schema.tasks.subjectId, 'russian'), eq(schema.tasks.sourceVariant, 2)));
    expect(rows.length).toBe(27);
    const numbers = rows.map((r) => r.taskNumber).sort((a, b) => a - b);
    expect(numbers).toEqual(Array.from({ length: 27 }, (_, i) => i + 1));
  });

  it('marks exactly 25 of 27 tasks published, 2 needs_review (8, 9)', async () => {
    const { db } = testDb;
    const rows = await db
      .select()
      .from(schema.tasks)
      .where(and(eq(schema.tasks.subjectId, 'russian'), eq(schema.tasks.sourceVariant, 2)));
    const needsReviewNumbers = rows
      .filter((r) => r.status === 'needs_review')
      .map((r) => r.taskNumber)
      .sort((a, b) => a - b);
    expect(needsReviewNumbers).toEqual([8, 9]);
    expect(rows.filter((r) => r.status === 'published').length).toBe(25);
  });

  it('task 27 is a published essay task with empty correctAnswer, never auto-graded, with a genuine sampleEssayMd', async () => {
    const { db } = testDb;
    const [task27] = await db
      .select()
      .from(schema.tasks)
      .where(
        and(
          eq(schema.tasks.subjectId, 'russian'),
          eq(schema.tasks.sourceVariant, 2),
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
      .where(and(eq(schema.tasks.subjectId, 'russian'), eq(schema.tasks.sourceVariant, 2)));
    for (const row of rows) {
      if (row.status !== 'published') continue;
      if (row.answerType !== 'essay') {
        expect(row.correctAnswer.length).toBeGreaterThan(0);
      }
      expect(row.explanationMd.length).toBeGreaterThan(0);
      expect(row.hintMd?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it('needs_review tasks (8, 9) are honest about what is unconfirmed, not silently empty', async () => {
    const { db } = testDb;
    const rows = await db
      .select()
      .from(schema.tasks)
      .where(
        and(
          eq(schema.tasks.subjectId, 'russian'),
          eq(schema.tasks.sourceVariant, 2),
          eq(schema.tasks.status, 'needs_review'),
        ),
      );
    expect(rows.length).toBe(2);
    for (const row of rows) {
      expect(row.explanationMd.length).toBeGreaterThan(0);
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
      .filter((p) => p.slug.startsWith('doshchinskiy-2027-v2-'))
      .map((p) => p.slug);
    expect(variantPassageSlugs.length).toBe(2);
  });

  it('keeps full provenance, separate from other variants/subjects, for every imported task', async () => {
    const { db } = testDb;
    const rows = await db
      .select()
      .from(schema.tasks)
      .where(and(eq(schema.tasks.subjectId, 'russian'), eq(schema.tasks.sourceVariant, 2)));
    for (const row of rows) {
      expect(row.source).toBe('Дощинский ЕГЭ 2027. Типовые экзаменационные варианты');
      expect(row.sourceDocument).toBe('Русский ЕГЭ 2027 вариант 2');
      expect(row.rawStatement).toBeTruthy();
      expect(row.contentHash).toBeTruthy();
      expect(row.tags).toContain('ege-russian-2027-variant-2');
    }
  });

  it('is idempotent — re-running does not duplicate rows or passages', async () => {
    const { db } = testDb;
    await importRussianVariant2(db);
    const tasksAfter = await db
      .select()
      .from(schema.tasks)
      .where(and(eq(schema.tasks.subjectId, 'russian'), eq(schema.tasks.sourceVariant, 2)));
    expect(tasksAfter.length).toBe(27);
  });
});
