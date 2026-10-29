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
import {
  COLLECTION_SLUG,
  SOURCE,
  SOURCE_FILE_V2_V15,
  importYashchenko2027Variant,
  type VariantData,
} from './ege2027Yashchenko.js';
import { variant1 } from './importEge2027YashchenkoVariant1.js';
import { variant2 } from './importEge2027YashchenkoVariant2.js';
import { variant3 } from './importEge2027YashchenkoVariant3.js';
import { variant4 } from './importEge2027YashchenkoVariant4.js';
import { variant5 } from './importEge2027YashchenkoVariant5.js';
import { variant6 } from './importEge2027YashchenkoVariant6.js';
import { createTestDb } from './testing.js';

const publicDir = fileURLToPath(new URL('../../../apps/web/public', import.meta.url));

/** Варианты 3–10 of the scan of Варианты 2–15: Вариант N on its pages 4N−7…4N−4. */
const LATER: readonly VariantData[] = [variant3, variant4, variant5, variant6];

type Task = VariantData['tasks'][number];

function accepts(task: Task, answer: string | Record<string, string>) {
  if (task.answerType === 'multi_part') {
    const spec = parseMultiPartSpec(task.correctAnswer)!;
    return gradeMultiPart(spec, answer as Record<string, string>).status === 'all_correct';
  }
  if (task.answerType === 'interval')
    return checkIntervalAnswer(answer as string, task.correctAnswer);
  return checkAnswer(answer as string, task.correctAnswer);
}

describe('ЕГЭ 2027 Ященко — Варианты 3–10 (скан вариантов 2–15)', () => {
  it.each(LATER.map((v) => [v.variant, v] as const))(
    'Вариант %i: 20 tasks in book order, on its own four scan pages',
    (n, v) => {
      expect(v.sourceFile).toBe(SOURCE_FILE_V2_V15);
      expect([v.sourcePageStart, v.sourcePageEnd]).toEqual([4 * n - 7, 4 * n - 4]);
      expect(v.tasks.map((t) => t.taskNumber)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
      for (const t of v.tasks) {
        expect(t.sourcePage).toBeGreaterThanOrEqual(v.sourcePageStart);
        expect(t.sourcePage).toBeLessThanOrEqual(v.sourcePageEnd);
        expect(t.rawStatement.length).toBeGreaterThan(20);
        expect(t.explanationMd).toMatch(/Ответ/);
        expect(t.solutionSteps.length).toBeGreaterThan(0);
        // A held task always says why.
        if (t.status === 'needs_review') expect(t.reviewNote).toBeTruthy();
      }
      // Pages never go backwards through the variant.
      const pages = v.tasks.map((t) => t.sourcePage);
      expect([...pages].sort((a, b) => a - b)).toEqual(pages);
    },
  );

  it('every answer key accepts itself', () => {
    for (const v of LATER) {
      for (const t of v.tasks) {
        if (t.answerType === 'multi_part') {
          const spec = parseMultiPartSpec(t.correctAnswer)!;
          expect(spec, `В${v.variant} №${t.taskNumber}`).not.toBeNull();
          const own = Object.fromEntries(spec.parts.map((p) => [p.id, p.correctAnswer]));
          expect(accepts(t, own), `В${v.variant} №${t.taskNumber}`).toBe(true);
        } else {
          expect(accepts(t, t.correctAnswer), `В${v.variant} №${t.taskNumber}`).toBe(true);
        }
      }
    }
  });

  it('figures: each image is this variant’s own file, and it exists', () => {
    for (const v of LATER) {
      for (const t of v.tasks.filter((t) => t.imageUrl)) {
        expect(t.imageUrl).toMatch(
          new RegExp(
            `^/tasks/imports/ege-2027-variant-${v.variant}/task-${String(t.taskNumber).padStart(2, '0')}-`,
          ),
        );
        expect(existsSync(`${publicDir}${t.imageUrl}`), t.imageUrl!).toBe(true);
      }
    }
  });

  it('no statement repeats another variant’s (no copied tasks)', () => {
    const seen = new Map<string, string>();
    for (const v of [variant1, variant2, ...LATER]) {
      for (const t of v.tasks) {
        const key = t.rawStatement.replace(/\s+/g, ' ').trim().toLowerCase();
        expect(seen.get(key), `В${v.variant} №${t.taskNumber}`).toBeUndefined();
        seen.set(key, `В${v.variant} №${t.taskNumber}`);
      }
    }
  });

  it('accepts the usual equivalent forms of the part-2 keys', () => {
    const v3 = (n: number) => variant3.tasks[n - 1]!;
    expect(accepts(v3(7), '2,6')).toBe(true);
    expect(accepts(v3(15), '11/(2√31)')).toBe(false); // not in the bound grammar
    expect(accepts(v3(16), 'x∈(-√24;-√23,75]∪[-√20;√20]∪[√23,75;√24)')).toBe(true);
    expect(accepts(v3(16), '[-2√5;2√5]')).toBe(false);
    expect(accepts(v3(18), '2 : 3')).toBe(true);
    expect(accepts(v3(18), '3:2')).toBe(false);
    expect(accepts(v3(19), '(-2/3; -0,4] ∪ {-(18+4√69)/65}')).toBe(true);
    expect(accepts(v3(19), '(-2/3; -0,4]')).toBe(false);
    expect(accepts(v3(20), { a: 'да', b: 'нет', c: '33' })).toBe(true);
    expect(accepts(v3(20), { a: 'да', b: 'нет', c: '32' })).toBe(false);
    const v4 = (n: number) => variant4.tasks[n - 1]!;
    expect(accepts(v4(14), '-0,5; -2,5')).toBe(true);
    expect(accepts(v4(14), '-2,5')).toBe(false);
    expect(accepts(v4(15), '97/99')).toBe(true);
    expect(accepts(v4(16), '[-√7,96;-√7,8]∪[-√3;√3]∪[√7,8;√7,96]')).toBe(true);
    expect(accepts(v4(16), '[-√3;√3]')).toBe(false);
    expect(accepts(v4(18), '5 : 9')).toBe(true);
    expect(accepts(v4(19), '(-∞;-1,25) ∪ {-(5+9√5)/40} ∪ (1;+∞)')).toBe(true);
    expect(accepts(v4(19), '(-∞;-1,25] ∪ {-(5+9√5)/40} ∪ (1;+∞)')).toBe(false);
    expect(accepts(v4(20), { a: 'да', b: 'нет', c: '30' })).toBe(true);
    const v5 = (n: number) => variant5.tasks[n - 1]!;
    expect(accepts(v5(2), '-4,8')).toBe(true);
    expect(accepts(v5(14), 'arctg(11/2) - 3π; arctg 0,5 - 3π')).toBe(true);
    expect(accepts(v5(14), 'arctg(1/2) - 3π')).toBe(false);
    expect(accepts(v5(15), '1/3')).toBe(true);
    expect(accepts(v5(16), '(2,5;2,52)∪(15;+∞)')).toBe(true);
    expect(accepts(v5(16), '(2,5;2,52]∪(15;+∞)')).toBe(false);
    expect(accepts(v5(18), '√(325/3)')).toBe(false); // outside the bound grammar
    expect(accepts(v5(18), '5√39/3')).toBe(true);
    expect(accepts(v5(19), '(0;6)∪(6;6,25)')).toBe(true);
    expect(accepts(v5(19), '(0;6,25)')).toBe(false);
    expect(accepts(v5(20), { a: 'да', b: 'нет', c: '2,5' })).toBe(true);
    expect(v5(17).status).toBe('needs_review');
    expect(v5(17).reviewNote).toMatch(/R/);
    const v6 = (n: number) => variant6.tasks[n - 1]!;
    expect(accepts(v6(14), '3π - arctg(2/11); 2π + arctg 2')).toBe(true);
    expect(accepts(v6(14), '2π + arctg 2')).toBe(false);
    expect(accepts(v6(15), '√8')).toBe(true);
    expect(accepts(v6(16), '(-∞;-0,8]∪[31/40;0,8)')).toBe(true);
    expect(accepts(v6(16), '(-∞;-0,8)∪[0,775;0,8)')).toBe(false);
    expect(accepts(v6(18), '5√21/3')).toBe(true);
    expect(accepts(v6(19), '(-1/4;0)∪(0;6)∪(6;+∞)')).toBe(true);
    expect(accepts(v6(19), '(-1/4;+∞)')).toBe(false);
    expect(accepts(v6(20), { a: 'да', b: 'нет', c: '1497,5' })).toBe(true);
    expect(v6(17).status).toBe('needs_review');
  });

  describe('import', () => {
    let testDb: Awaited<ReturnType<typeof createTestDb>>;

    beforeAll(async () => {
      testDb = await createTestDb();
    });

    afterAll(async () => {
      await testDb.close();
    });

    it('imports each variant into the 2027 collection, tagged, with its scan recorded', async () => {
      const { db } = testDb;
      for (const v of LATER) {
        const r = await importYashchenko2027Variant(db, v);
        expect(r.total).toBe(20);
        const rows = await db
          .select()
          .from(schema.tasks)
          .where(and(eq(schema.tasks.source, SOURCE), eq(schema.tasks.sourceVariant, v.variant)))
          .orderBy(asc(schema.tasks.taskNumber));
        expect(rows.map((t) => t.taskNumber)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
        expect(rows.every((t) => t.tags.includes(`ege-2027-variant-${v.variant}`))).toBe(true);
        expect(
          rows.every((t) => t.sourceYear === 2027 && t.sourceTaskNumber === t.taskNumber),
        ).toBe(true);
        expect(rows.reduce((s, t) => s + t.maxPrimaryScore!, 0)).toBe(33);
      }
      const [collection] = await db
        .select()
        .from(schema.collections)
        .where(eq(schema.collections.slug, COLLECTION_SLUG));
      const variants = await db
        .select()
        .from(schema.variants)
        .where(eq(schema.variants.collectionId, collection!.id))
        .orderBy(asc(schema.variants.variantNumber));
      expect(variants.map((v) => [v.variantNumber, v.sourceFile, v.sourcePageStart])).toEqual(
        LATER.map((v) => [v.variant, SOURCE_FILE_V2_V15, v.sourcePageStart]),
      );
    });

    it('re-running keeps the same ids and adds nothing', async () => {
      const { db } = testDb;
      const ids = async () =>
        (
          await db
            .select({ id: schema.tasks.id })
            .from(schema.tasks)
            .where(eq(schema.tasks.source, SOURCE))
        )
          .map((r) => r.id)
          .sort();
      const before = await ids();
      for (const v of LATER) await importYashchenko2027Variant(db, v);
      expect(await ids()).toEqual(before);
      expect(before).toHaveLength(20 * LATER.length);
    });
  });
});
