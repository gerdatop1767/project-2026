import { parseMultiPartSpec } from '@zybrilka/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from './schema.js';
import { importVariant1 } from './importEge2026Variant1.js';
import { importRussianVariant1 } from './importRussianDoshchinsky2027Variant1.js';
import { createTestDb } from './testing.js';

/**
 * EXPERIMENTAL: verifies the single-variant Russian pilot import in
 * isolation. Deliberately does NOT use `createImportedVariantsTestDb()`
 * (that helper is the math-only matrix used by production-facing
 * tests) — this file proves the Russian importer works correctly and
 * coexists safely with the existing math data, without adding Russian
 * to any shared/production test fixture.
 */
describe('importRussianVariant1 (experimental pilot)', () => {
  let testDb: Awaited<ReturnType<typeof createTestDb>>;

  beforeAll(async () => {
    testDb = await createTestDb();
  });

  afterAll(async () => {
    await testDb.close();
  });

  it('imports all 27 task numbers (1-27), including essay task 27', async () => {
    const { db } = testDb;
    const result = await importRussianVariant1(db);
    expect(result.total).toBe(27);
    expect(result.essayTaskNumber).toBe(27);

    const rows = await db
      .select()
      .from(schema.tasks)
      .where(and(eq(schema.tasks.subjectId, 'russian'), eq(schema.tasks.sourceVariant, 1)));
    expect(rows.length).toBe(27);
    const numbers = rows.map((r) => r.taskNumber).sort((a, b) => a - b);
    expect(numbers).toEqual(Array.from({ length: 27 }, (_, i) => i + 1));
  });

  it('marks all 27 tasks published — no needs_review left in this variant', async () => {
    const { db } = testDb;
    const rows = await db
      .select()
      .from(schema.tasks)
      .where(and(eq(schema.tasks.subjectId, 'russian'), eq(schema.tasks.sourceVariant, 1)));
    const needsReview = rows.filter((r) => r.status === 'needs_review');
    expect(needsReview).toHaveLength(0);
    expect(rows.filter((r) => r.status === 'published').length).toBe(27);
  });

  it('tasks 3 and 8 (formerly needs_review) are now published with a confirmed correctAnswer', async () => {
    const { db } = testDb;
    const rows = await db
      .select()
      .from(schema.tasks)
      .where(and(eq(schema.tasks.subjectId, 'russian'), eq(schema.tasks.sourceVariant, 1)));
    const task3 = rows.find((r) => r.taskNumber === 3);
    const task8 = rows.find((r) => r.taskNumber === 8);
    expect(task3?.status).toBe('published');
    expect(task3?.correctAnswer).toBe('234');
    expect(task3?.digitSetOrderInsensitive).toBe(true);
    expect(task8?.status).toBe('published');
    const spec8 = parseMultiPartSpec(task8!.correctAnswer);
    expect(spec8?.parts.map((p) => p.correctAnswer)).toEqual(['9', '5', '3', '4', '7']);
  });

  it('tasks 11 and 12 are independently re-derived, published, with a non-empty correctAnswer', async () => {
    const { db } = testDb;
    const rows = await db
      .select()
      .from(schema.tasks)
      .where(and(eq(schema.tasks.subjectId, 'russian'), eq(schema.tasks.sourceVariant, 1)));
    const task11 = rows.find((r) => r.taskNumber === 11);
    const task12 = rows.find((r) => r.taskNumber === 12);
    expect(task11?.status).toBe('published');
    expect(task11?.correctAnswer).toBe('145');
    expect(task11?.digitSetOrderInsensitive).toBe(true);
    expect(task12?.status).toBe('published');
    expect(task12?.correctAnswer).toBe('234');
    expect(task12?.digitSetOrderInsensitive).toBe(true);
  });

  it('task 27 is a published essay task: essay answerType, empty correctAnswer, linked to the Osorgin passage', async () => {
    const { db } = testDb;
    const [task27] = await db
      .select()
      .from(schema.tasks)
      .where(
        and(
          eq(schema.tasks.subjectId, 'russian'),
          eq(schema.tasks.sourceVariant, 1),
          eq(schema.tasks.taskNumber, 27),
        ),
      );
    expect(task27).toBeDefined();
    expect(task27!.answerType).toBe('essay');
    expect(task27!.status).toBe('published');
    expect(task27!.correctAnswer).toBe('');
    expect(task27!.conditionMd).toContain('старинные вещи');
    expect(task27!.conditionMd).toContain('не менее 150 слов');
    expect(task27!.passageId).not.toBeNull();

    const [osorginPassage] = await db
      .select()
      .from(schema.passages)
      .where(
        and(eq(schema.passages.subjectId, 'russian'), eq(schema.passages.id, task27!.passageId!)),
      );
    expect(osorginPassage!.slug).toContain('osorgin');
  });

  it('task 27 has a genuine sampleEssayMd grounded in the Osorgin text — every other task has sampleEssayMd null', async () => {
    const { db } = testDb;
    const rows = await db
      .select({ taskNumber: schema.tasks.taskNumber, sampleEssayMd: schema.tasks.sampleEssayMd })
      .from(schema.tasks)
      .where(and(eq(schema.tasks.subjectId, 'russian'), eq(schema.tasks.sourceVariant, 1)));
    const byNumber = new Map(rows.map((r) => [r.taskNumber, r.sampleEssayMd]));
    expect(byNumber.get(27)).toBeTruthy();
    expect(byNumber.get(27)).toContain('Татьяна Егоровна');
    for (const [taskNumber, sampleEssayMd] of byNumber) {
      if (taskNumber !== 27) expect(sampleEssayMd).toBeNull();
    }
  });

  it('links tasks 1-3 to the shared "train ticket" passage and 23-26 to the shared Osorgin passage', async () => {
    const { db } = testDb;
    const rows = await db
      .select({ taskNumber: schema.tasks.taskNumber, passageId: schema.tasks.passageId })
      .from(schema.tasks)
      .where(and(eq(schema.tasks.subjectId, 'russian'), eq(schema.tasks.sourceVariant, 1)));
    const byNumber = new Map(rows.map((r) => [r.taskNumber, r.passageId]));

    const passageATasks = [1, 2, 3].map((n) => byNumber.get(n));
    expect(passageATasks.every((id) => id !== null && id !== undefined)).toBe(true);
    expect(new Set(passageATasks).size).toBe(1); // same passage row for all three

    const passageBTasks = [23, 24, 25, 26, 27].map((n) => byNumber.get(n));
    expect(passageBTasks.every((id) => id !== null && id !== undefined)).toBe(true);
    expect(new Set(passageBTasks).size).toBe(1); // essay task 27 reads the same text

    expect(passageATasks[0]).not.toBe(passageBTasks[0]);

    // Tasks without a shared passage (e.g. task 4, orthoepy) stay null.
    expect(byNumber.get(4)).toBeNull();
  });

  it('stores each shared passage body exactly once, not duplicated per task', async () => {
    const { db } = testDb;
    const passages = await db
      .select()
      .from(schema.passages)
      .where(eq(schema.passages.subjectId, 'russian'));
    expect(passages).toHaveLength(2);
    const osorgin = passages.find((p) => p.slug.includes('osorgin'));
    expect(osorgin).toBeDefined();
    expect(osorgin!.bodyMd).toContain('(1)Были у Татьяны Егоровны');
    expect(osorgin!.bodyMd).toContain('(43)Бьют часы пять');
  });

  it('tasks 8 and 22 (matching type) are well-formed multi_part specs with 5 parts', async () => {
    const { db } = testDb;
    const rows = await db
      .select()
      .from(schema.tasks)
      .where(and(eq(schema.tasks.subjectId, 'russian'), eq(schema.tasks.sourceVariant, 1)));
    for (const taskNumber of [8, 22]) {
      const task = rows.find((r) => r.taskNumber === taskNumber);
      expect(task?.answerType).toBe('multi_part');
      const spec = parseMultiPartSpec(task!.correctAnswer);
      expect(spec).not.toBeNull();
      expect(spec!.parts).toHaveLength(5);
      expect(spec!.parts.map((p) => p.label)).toEqual(['А', 'Б', 'В', 'Г', 'Д']);
    }
  });

  it('keeps full provenance, separate from the math Ященко source, for every imported task', async () => {
    const { db } = testDb;
    const rows = await db
      .select()
      .from(schema.tasks)
      .where(and(eq(schema.tasks.subjectId, 'russian'), eq(schema.tasks.sourceVariant, 1)));
    for (const row of rows) {
      expect(row.source).toBe('Дощинский ЕГЭ 2027. Типовые экзаменационные варианты');
      expect(row.source).not.toContain('Ященко');
      expect(row.sourceDocument).toBe('Русский ЕГЭ 2027 вариант 1');
      expect(row.rawStatement).toBeTruthy();
      expect(row.contentHash).toBeTruthy();
      expect(row.tags).toContain('ege-russian-2027-variant-1');
    }
  });

  it('is idempotent — re-running does not duplicate rows or passages', async () => {
    const { db } = testDb;
    await importRussianVariant1(db);
    const tasksAfter = await db
      .select()
      .from(schema.tasks)
      .where(and(eq(schema.tasks.subjectId, 'russian'), eq(schema.tasks.sourceVariant, 1)));
    expect(tasksAfter.length).toBe(27);
    const passagesAfter = await db
      .select()
      .from(schema.passages)
      .where(eq(schema.passages.subjectId, 'russian'));
    expect(passagesAfter).toHaveLength(2);
  });

  it('coexists with the existing math catalog without interference (backward compatibility)', async () => {
    const { db } = testDb;
    const mathResult = await importVariant1(db);
    expect(mathResult.total).toBe(19);

    const mathRows = await db
      .select()
      .from(schema.tasks)
      .where(and(eq(schema.tasks.subjectId, 'math'), eq(schema.tasks.sourceVariant, 1)));
    expect(mathRows).toHaveLength(19);
    expect(mathRows.every((r) => r.passageId === null)).toBe(true);

    const russianRows = await db
      .select()
      .from(schema.tasks)
      .where(and(eq(schema.tasks.subjectId, 'russian'), eq(schema.tasks.sourceVariant, 1)));
    expect(russianRows).toHaveLength(27);

    const subjects = await db.select().from(schema.subjects);
    const ids = subjects.map((s) => s.id).sort();
    expect(ids).toContain('math');
    expect(ids).toContain('russian');
  });
});
