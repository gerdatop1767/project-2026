import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  checkAnswer,
  checkIntervalAnswer,
  gradeMultiPart,
  parseMultiPartSpec,
} from '@zybrilka/shared';
import { and, asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from './schema.js';
import { COLLECTION_SLUG, SOURCE } from './ege2027Yashchenko.js';
import { importVariant1, variant1 } from './importEge2027YashchenkoVariant1.js';
import { importVariant2, variant2 } from './importEge2027YashchenkoVariant2.js';
import { importVariant1 as import2026Variant1 } from './importEge2026Variant1.js';
import { createTestDb } from './testing.js';

const publicDir = fileURLToPath(new URL('../../../apps/web/public', import.meta.url));

/** Every key must accept itself — and the forms a student is likely to type. */
function accepts(task: (typeof variant1.tasks)[number], answer: string | Record<string, string>) {
  if (task.answerType === 'multi_part') {
    const spec = parseMultiPartSpec(task.correctAnswer)!;
    return gradeMultiPart(spec, answer as Record<string, string>).status === 'all_correct';
  }
  if (task.answerType === 'interval')
    return checkIntervalAnswer(answer as string, task.correctAnswer);
  return checkAnswer(answer as string, task.correctAnswer);
}

describe('ЕГЭ 2027 Ященко — Вариант 1 и 2', () => {
  let testDb: Awaited<ReturnType<typeof createTestDb>>;

  beforeAll(async () => {
    testDb = await createTestDb();
  });

  afterAll(async () => {
    await testDb.close();
  });

  it('imports 20 + 20 tasks numbered 1..20 as in the book; №17 is held for review', async () => {
    const { db } = testDb;
    const r1 = await importVariant1(db);
    const r2 = await importVariant2(db);
    for (const r of [r1, r2]) {
      expect(r.total).toBe(20);
      expect(r.published).toBe(19);
      expect(r.needsReview).toBe(1);
    }
    for (const variant of [1, 2]) {
      const rows = await db
        .select()
        .from(schema.tasks)
        .where(and(eq(schema.tasks.source, SOURCE), eq(schema.tasks.sourceVariant, variant)))
        .orderBy(asc(schema.tasks.taskNumber));
      expect(rows.map((r) => r.taskNumber)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
      expect(rows.every((r) => r.sourceTaskNumber === r.taskNumber)).toBe(true);
      expect(
        rows.every((r) => r.sourceYear === 2027 && r.tags.includes(`ege-2027-variant-${variant}`)),
      ).toBe(true);
      expect(rows.filter((r) => r.status === 'needs_review').map((r) => r.taskNumber)).toEqual([
        17,
      ]);
      expect(rows.find((r) => r.taskNumber === 17)!.reviewNote).toMatch(/параметр n/);
      // Max primary points come from the 2027 project scoring rules: 33 in all.
      expect(rows.reduce((s, r) => s + r.maxPrimaryScore!, 0)).toBe(33);
      expect(rows.find((r) => r.taskNumber === 19)!.maxPrimaryScore).toBe(4);
      // The explanations are ours and say so.
      expect(rows.every((r) => r.explanationMd!.includes('не авторское решение сборника'))).toBe(
        true,
      );
    }
  });

  it('registers a separate collection kept out of «Все источники», with the 2027 exam format', async () => {
    const { db } = testDb;
    const [collection] = await db
      .select()
      .from(schema.collections)
      .where(eq(schema.collections.slug, COLLECTION_SLUG));
    expect(collection).toMatchObject({
      year: 2027,
      inAllSources: false,
      examFormat: 'ege-math-profile-2027',
    });
    const variants = await db
      .select()
      .from(schema.variants)
      .where(eq(schema.variants.collectionId, collection!.id))
      .orderBy(asc(schema.variants.variantNumber));
    expect(variants.map((v) => [v.variantNumber, v.sourcePageStart, v.sourcePageEnd])).toEqual([
      [1, 1, 4],
      [2, 5, 8],
    ]);
    for (const v of variants) {
      const links = await db
        .select()
        .from(schema.variantTasks)
        .where(eq(schema.variantTasks.variantId, v.id));
      expect(links.map((l) => l.position).sort((a, b) => a - b)).toEqual(
        Array.from({ length: 20 }, (_, i) => i + 1),
      );
    }
  });

  it('attaches the cropped scan figures to exactly tasks 1, 3, 9, 12, and the files exist', () => {
    for (const [data, n] of [
      [variant1, 1],
      [variant2, 2],
    ] as const) {
      const withImage = data.tasks.filter((t) => t.imageUrl).map((t) => t.taskNumber);
      expect(withImage).toEqual([1, 3, 9, 12]);
      for (const t of data.tasks.filter((t) => t.imageUrl)) {
        expect(t.imageUrl).toMatch(
          new RegExp(`^/tasks/imports/ege-2027-variant-${n}/task-\\d{2}-`),
        );
        expect(existsSync(`${publicDir}${t.imageUrl}`)).toBe(true);
      }
    }
  });

  it('every answer key accepts itself and its usual equivalent forms', () => {
    for (const t of [...variant1.tasks, ...variant2.tasks]) {
      if (t.answerType === 'multi_part') {
        const spec = parseMultiPartSpec(t.correctAnswer)!;
        const own = Object.fromEntries(spec.parts.map((p) => [p.id, p.correctAnswer]));
        expect(accepts(t, own)).toBe(true);
      } else {
        expect(accepts(t, t.correctAnswer)).toBe(true);
      }
    }
    const v1 = (n: number) => variant1.tasks[n - 1]!;
    const v2 = (n: number) => variant2.tasks[n - 1]!;
    expect(accepts(v1(1), '1,5')).toBe(true);
    expect(accepts(v1(12), '0,125')).toBe(true);
    expect(accepts(v1(14), '-5π; -11π/2')).toBe(true);
    expect(accepts(v1(14), '-5,5π; -5π')).toBe(true);
    expect(accepts(v1(14), '-11π/2')).toBe(false);
    expect(accepts(v2(15), '2√21/√103')).toBe(true);
    expect(accepts(v2(15), '0,9')).toBe(false);
    expect(accepts(v1(16), 'x∈[1;1,5)∪[16;+∞)')).toBe(true);
    expect(accepts(v1(16), '[1;1,5]∪[16;+∞)')).toBe(false);
    expect(accepts(v2(16), '[0;2,5) U [16;81]')).toBe(true);
    expect(accepts(v1(19), '[-4,5;-√8) ∪ {-89/18}')).toBe(true);
    expect(accepts(v1(19), '[-4,5;-2√2)')).toBe(false);
    expect(accepts(v2(19), '{-50}; [12,5;+∞)')).toBe(true);
    expect(accepts(v2(19), '[12,5;+∞)')).toBe(false);
    expect(accepts(v1(20), { a: 'Да', b: 'нет', c: '580' })).toBe(true);
    expect(accepts(v2(20), { a: 'да', b: 'нет', c: '640' })).toBe(false);
  });

  it('re-running is idempotent: same ids, no duplicates', async () => {
    const { db } = testDb;
    const before = await db
      .select({ id: schema.tasks.id })
      .from(schema.tasks)
      .where(eq(schema.tasks.source, SOURCE));
    const again = await importVariant1(db);
    await importVariant2(db);
    const after = await db
      .select({ id: schema.tasks.id })
      .from(schema.tasks)
      .where(eq(schema.tasks.source, SOURCE));
    expect(after.map((r) => r.id).sort()).toEqual(before.map((r) => r.id).sort());
    expect(after).toHaveLength(40);
    expect(again.taskIds).toHaveLength(20);
  });
});

describe('ЕГЭ 2027 next to the 2026 variants', () => {
  it('leaves the 2026 tasks, their numbering and the shared topic names untouched', async () => {
    const testDb = await createTestDb();
    try {
      const { db } = testDb;
      await import2026Variant1(db);
      const snapshot = async () =>
        await db
          .select({
            id: schema.tasks.id,
            n: schema.tasks.taskNumber,
            hash: schema.tasks.contentHash,
            answer: schema.tasks.correctAnswer,
            topicId: schema.tasks.topicId,
            status: schema.tasks.status,
          })
          .from(schema.tasks)
          .orderBy(asc(schema.tasks.id));
      const topics = async () =>
        db
          .select({ slug: schema.topics.slug, name: schema.topics.name })
          .from(schema.topics)
          .orderBy(asc(schema.topics.slug));
      const tasksBefore = await snapshot();
      const topicsBefore = await topics();

      await importVariant1(db);
      await importVariant2(db);

      const tasksAfter = (await snapshot()).filter((r) => tasksBefore.some((b) => b.id === r.id));
      expect(tasksAfter).toEqual(tasksBefore);
      const topicsAfter = await topics();
      for (const t of topicsBefore) expect(topicsAfter).toContainEqual(t);
      const [c2026] = await db
        .select()
        .from(schema.collections)
        .where(eq(schema.collections.slug, 'ege-2026-yashchenko'));
      expect(c2026).toMatchObject({ inAllSources: true, examFormat: 'ege-math-profile-2026' });
    } finally {
      await testDb.close();
    }
  });
});
