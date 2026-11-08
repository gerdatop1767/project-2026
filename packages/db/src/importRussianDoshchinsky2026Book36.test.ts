import { checkAnswer } from '@zybrilka/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { R36_SOURCE, importRussianDoshchinsky36 } from './importRussianDoshchinsky2027Book36.js';
import {
  importRussianDoshchinsky2026Book36,
  R26_COLLECTION_SLUG,
  R26_SOURCE,
  validateR26Variants,
} from './importRussianDoshchinsky2026Book36.js';
import { r26Variants } from './russianDoshchinsky2026/index.js';
import * as schema from './schema.js';
import { createTestDb } from './testing.js';

/** A copy of the prepared data: the importer requires all 36 variants only for its own default data. */
const prepared = [...r26Variants];
const reusedCount = prepared.flatMap((v) => v.tasks).filter((t) => t.sameAs).length;
const sentenceNumbers = (md: string) => [...md.matchAll(/\((\d+)\)/g)].map((m) => Number(m[1]));

describe('«36 вариантов» 2026 data (static checks)', () => {
  it('has prepared variants', () => {
    expect(prepared.length).toBeGreaterThan(0);
    expect(() => validateR26Variants(prepared)).not.toThrow();
  });

  it('every prepared variant has tasks 1–27 exactly once, with an explanation and a hint', () => {
    for (const v of prepared) {
      expect(v.tasks.map((t) => t.taskNumber)).toEqual(Array.from({ length: 27 }, (_, i) => i + 1));
      for (const t of v.tasks) {
        const where = `В${v.variant} №${t.taskNumber}`;
        expect(t.conditionMd.length, where).toBeGreaterThan(40);
        expect(t.explanationMd.length, where).toBeGreaterThan(80);
        expect(t.hintMd.length, where).toBeGreaterThan(10);
        expect(t.sourcePage, where).toBeGreaterThanOrEqual(v.sourcePageStart);
        expect(t.sourcePage, where).toBeLessThanOrEqual(v.sourcePageEnd);
        if (t.status === 'needs_review') expect(t.reviewReason, where).toBeTruthy();
      }
    }
  });

  it('task 27 is an ungraded essay with the book’s problem, criteria and a labelled example essay', () => {
    for (const v of prepared) {
      const essay = v.tasks.find((t) => t.taskNumber === 27)!;
      const where = `В${v.variant} №27`;
      expect(essay.answerType, where).toBe('essay');
      expect(essay.correctAnswer, where).toBe('');
      expect(essay.acceptedAnswers, where).toEqual([]);
      expect(essay.passage, where).toBe('B');
      expect(essay.explanationMd, where).toContain('**Проблема:**');
      expect(essay.explanationMd, where).toContain('**Авторская позиция (по учебнику):**');
      expect(essay.explanationMd, where).toContain('максимум 22 балла');
      expect(essay.sampleEssayMd, where).toMatch(/^\*Это один из возможных примеров сочинения/);
      // The example essay must be long enough to count (150 words and more).
      expect(essay.sampleEssayMd!.split(/\s+/).length, where).toBeGreaterThanOrEqual(150);
      for (const t of v.tasks.filter((x) => x.taskNumber !== 27))
        expect(t.sampleEssayMd ?? null, `В${v.variant} №${t.taskNumber}`).toBeNull();
    }
  });

  it('answers of tasks 1–26 have the format of their task number', () => {
    for (const v of prepared) {
      for (const t of v.tasks.filter((x) => x.taskNumber <= 26)) {
        const where = `В${v.variant} №${t.taskNumber}`;
        const all = [t.correctAnswer, ...t.acceptedAnswers];
        if (t.taskNumber === 8 || t.taskNumber === 22) {
          expect(t.answerType, where).toBe('multi_part');
          expect(
            t.multiPart?.map((c) => c.label),
            where,
          ).toEqual(['А', 'Б', 'В', 'Г', 'Д']);
          expect(new Set(t.correctAnswer).size, where).toBe(5);
        } else if ([1, 5, 6, 7, 25].includes(t.taskNumber)) {
          for (const a of all) expect(a, where).toMatch(/^[а-яё-]+$/);
        } else {
          for (const a of all) expect(a, where).toMatch(/^\d+$/);
        }
      }
    }
  });

  it('the main answer and every accepted alternative pass the real answer checker', () => {
    for (const v of prepared) {
      for (const t of v.tasks) {
        if (t.answerType !== 'short_answer') continue;
        for (const a of [t.correctAnswer, ...t.acceptedAnswers]) {
          const ok = [t.correctAnswer, ...t.acceptedAnswers].some((key) =>
            checkAnswer(a, key, { digitSetOrderInsensitive: t.digitSetOrderInsensitive }),
          );
          expect(ok, `В${v.variant} №${t.taskNumber}: ${a}`).toBe(true);
        }
      }
    }
  });

  it('a repeated task points to an earlier variant with the same condition and answer', () => {
    for (const v of prepared) {
      for (const t of v.tasks) {
        if (!t.sameAs) continue;
        const where = `В${v.variant} №${t.taskNumber}`;
        const original = prepared
          .find((x) => x.variant === t.sameAs!.variant)
          ?.tasks.find((x) => x.taskNumber === t.sameAs!.taskNumber);
        expect(original, where).toBeDefined();
        expect(original!.sameAs, where).toBeUndefined();
        expect(original!.conditionMd, where).toBe(t.conditionMd);
        expect(original!.correctAnswer, where).toBe(t.correctAnswer);
        expect(original!.acceptedAnswers, where).toEqual(t.acceptedAnswers);
        expect(original!.passage, where).toBeNull();
      }
    }
  });

  it('text B is numbered (1)…(N) without gaps; tasks 24 and 26 refer to existing sentences', () => {
    for (const v of prepared) {
      const nums = sentenceNumbers(v.passages.B.bodyMd);
      expect(nums, `В${v.variant}`).toEqual(Array.from({ length: nums.length }, (_, i) => i + 1));
      for (const n of [24, 26]) {
        const t = v.tasks.find((x) => x.taskNumber === n)!;
        for (const m of t.conditionMd.matchAll(/\b(\d{1,2})\b/g))
          expect(Number(m[1]), `В${v.variant} №${n}`).toBeLessThanOrEqual(nums.length);
      }
    }
  });
});

describe('importRussianDoshchinsky2026Book36 (database)', { timeout: 60_000 }, () => {
  let testDb: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    testDb = await createTestDb();
  });
  afterAll(async () => {
    await testDb.close();
  });

  const bookTasks = () =>
    testDb.db
      .select()
      .from(schema.tasks)
      .where(and(eq(schema.tasks.subjectId, 'russian'), eq(schema.tasks.source, R26_SOURCE)));

  it('refuses an incomplete default data set only for its own data, and invalid data always', async () => {
    const broken = prepared.map((v, i) =>
      i === 0 ? { ...v, tasks: v.tasks.filter((t) => t.taskNumber !== 27) } : v,
    );
    await expect(importRussianDoshchinsky2026Book36(testDb.db, broken)).rejects.toThrow(
      /tasks are not 1–27/,
    );
    expect(await bookTasks()).toHaveLength(0);
  });

  it('imports the prepared variants into their own 2026 collection, idempotently', async () => {
    const first = await importRussianDoshchinsky2026Book36(testDb.db, prepared);
    expect(first.variants).toBe(prepared.length);
    expect(first.total).toBe(prepared.length * 27);
    expect(first.unique).toBe(prepared.length * 27 - reusedCount);
    expect(first.created).toBe(first.unique);

    const rows = await bookTasks();
    expect(rows).toHaveLength(first.unique);
    expect(new Set(rows.map((r) => r.sourceYear))).toEqual(new Set([2026]));
    const essays = rows.filter((r) => r.taskNumber === 27);
    expect(essays).toHaveLength(prepared.length);
    for (const e of essays) {
      expect(e.answerType).toBe('essay');
      expect(e.sampleEssayMd).toBeTruthy();
    }

    const [collection] = await testDb.db
      .select()
      .from(schema.collections)
      .where(eq(schema.collections.slug, R26_COLLECTION_SLUG));
    expect(collection?.year).toBe(2026);
    const variants = await testDb.db
      .select()
      .from(schema.variants)
      .where(eq(schema.variants.collectionId, collection!.id));
    expect(variants).toHaveLength(prepared.length);
    for (const v of variants) {
      const links = await testDb.db
        .select()
        .from(schema.variantTasks)
        .where(eq(schema.variantTasks.variantId, v.id));
      expect(links.map((l) => l.position).sort((a, b) => a - b)).toEqual(
        Array.from({ length: 27 }, (_, i) => i + 1),
      );
    }

    const before = rows.map((r) => [r.id, r.updatedAt.toISOString()]).sort();
    const second = await importRussianDoshchinsky2026Book36(testDb.db, prepared);
    expect(second.created).toBe(0);
    expect(second.updated).toBe(0);
    expect(second.unchanged).toBe(first.unique);
    const after = (await bookTasks()).map((r) => [r.id, r.updatedAt.toISOString()]).sort();
    expect(after).toEqual(before);
  });

  it('keeps the 2027 book untouched: separate source, rows and collection', async () => {
    await importRussianDoshchinsky36(testDb.db);
    const book27 = await testDb.db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.source, R36_SOURCE));
    const before = book27.map((r) => [r.id, r.updatedAt.toISOString(), r.contentHash]).sort();

    await importRussianDoshchinsky2026Book36(testDb.db, prepared);
    const after = (
      await testDb.db.select().from(schema.tasks).where(eq(schema.tasks.source, R36_SOURCE))
    )
      .map((r) => [r.id, r.updatedAt.toISOString(), r.contentHash])
      .sort();
    expect(after).toEqual(before);
    expect(new Set(book27.map((r) => r.sourceYear))).toEqual(new Set([2027]));
    // No 2026 row is shared with the 2027 book, even where a task is printed in both books.
    const ids26 = new Set((await bookTasks()).map((r) => r.id));
    expect(book27.filter((r) => ids26.has(r.id))).toHaveLength(0);
  });
});
