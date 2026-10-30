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
  SOURCE_FILE_V10_V17,
  SOURCE_FILE_V18_V25,
  importYashchenko2027Variant,
  type VariantData,
} from './ege2027Yashchenko.js';
import { variant1 } from './importEge2027YashchenkoVariant1.js';
import { variant2 } from './importEge2027YashchenkoVariant2.js';
import { variant3 } from './importEge2027YashchenkoVariant3.js';
import { variant4 } from './importEge2027YashchenkoVariant4.js';
import { variant5 } from './importEge2027YashchenkoVariant5.js';
import { variant6 } from './importEge2027YashchenkoVariant6.js';
import { variant7 } from './importEge2027YashchenkoVariant7.js';
import { variant8 } from './importEge2027YashchenkoVariant8.js';
import { variant9 } from './importEge2027YashchenkoVariant9.js';
import { variant10 } from './importEge2027YashchenkoVariant10.js';
import { variant11 } from './importEge2027YashchenkoVariant11.js';
import { variant12 } from './importEge2027YashchenkoVariant12.js';
import { variant13 } from './importEge2027YashchenkoVariant13.js';
import { variant14 } from './importEge2027YashchenkoVariant14.js';
import { variant15 } from './importEge2027YashchenkoVariant15.js';
import { variant16 } from './importEge2027YashchenkoVariant16.js';
import { variant17 } from './importEge2027YashchenkoVariant17.js';
import { variant18 } from './importEge2027YashchenkoVariant18.js';
import { variant19 } from './importEge2027YashchenkoVariant19.js';
import { createTestDb } from './testing.js';

const publicDir = fileURLToPath(new URL('../../../apps/web/public', import.meta.url));

/** Варианты 11–25: scans of Варианты 10–17 and 18–25, four pages per variant. */
const NEW: readonly VariantData[] = [
  variant11,
  variant12,
  variant13,
  variant14,
  variant15,
  variant16,
  variant17,
  variant18,
  variant19,
];
const EARLIER: readonly VariantData[] = [
  variant1,
  variant2,
  variant3,
  variant4,
  variant5,
  variant6,
  variant7,
  variant8,
  variant9,
  variant10,
];

const scanOf = (n: number) =>
  n <= 17
    ? { file: SOURCE_FILE_V10_V17, start: 4 * (n - 10) + 1 }
    : { file: SOURCE_FILE_V18_V25, start: 4 * (n - 18) + 1 };

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

const task = (v: VariantData, n: number) => v.tasks[n - 1]!;

describe('ЕГЭ 2027 Ященко — Варианты 11–25 (сканы вариантов 10–17 и 18–25)', () => {
  it.each(NEW.map((v) => [v.variant, v] as const))(
    'Вариант %i: 20 tasks in book order, on its own four scan pages',
    (n, v) => {
      const scan = scanOf(n);
      expect(v.sourceFile).toBe(scan.file);
      expect([v.sourcePageStart, v.sourcePageEnd]).toEqual([scan.start, scan.start + 3]);
      expect(v.tasks.map((t) => t.taskNumber)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
      for (const t of v.tasks) {
        expect(t.sourcePage).toBeGreaterThanOrEqual(v.sourcePageStart);
        expect(t.sourcePage).toBeLessThanOrEqual(v.sourcePageEnd);
        expect(t.rawStatement.length).toBeGreaterThan(20);
        expect(t.explanationMd).toMatch(/Ответ/);
        expect(t.solutionSteps.length).toBeGreaterThan(0);
        if (t.status === 'needs_review') expect(t.reviewNote).toBeTruthy();
      }
      const pages = v.tasks.map((t) => t.sourcePage);
      expect([...pages].sort((a, b) => a - b)).toEqual(pages);
    },
  );

  it('every answer key accepts itself', () => {
    for (const v of NEW) {
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
    for (const v of NEW) {
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
    for (const v of [...EARLIER, ...NEW]) {
      for (const t of v.tasks) {
        // A statement the book repeats with another figure is told apart by that figure.
        const key = `${t.rawStatement.replace(/\s+/g, ' ').trim().toLowerCase()}|${t.figureFingerprint ?? ''}`;
        expect(seen.get(key), `В${v.variant} №${t.taskNumber}`).toBeUndefined();
        seen.set(key, `В${v.variant} №${t.taskNumber}`);
      }
    }
  });

  it('accepts the usual equivalent forms of the part-2 keys', () => {
    const v11 = (n: number) => task(variant11, n);
    expect(accepts(v11(14), '-8π/3; -3π; -4π')).toBe(true);
    expect(accepts(v11(14), '-4π; -3π')).toBe(false);
    expect(accepts(v11(15), 'arccos(√10/5)')).toBe(true);
    expect(accepts(v11(16), '(log_5(2);log_5(8))∪(log_5(8);log_3(8)]')).toBe(true);
    expect(accepts(v11(16), '(log_5(2);log_3(8)]')).toBe(false);
    expect(accepts(v11(17), '3,105·10^-21')).toBe(true);
    expect(accepts(v11(17), '3,1·10^-21')).toBe(false);
    expect(accepts(v11(18), '3(2-√2)')).toBe(false); // outside the bound grammar
    expect(accepts(v11(18), '6-3√2')).toBe(true);
    expect(accepts(v11(19), '{36/25}∪(√13-2;4)')).toBe(true);
    expect(accepts(v11(19), '(√13-2;4)')).toBe(false);
    expect(accepts(v11(20), { a: 'нет', b: '607', c: '1066' })).toBe(true);
    const v12 = (n: number) => task(variant12, n);
    expect(accepts(v12(14), '11π/2; 29π/6; 31π/6')).toBe(true);
    expect(accepts(v12(14), '29π/6; 31π/6')).toBe(false);
    expect(accepts(v12(15), 'arccos(17/35)')).toBe(true);
    expect(accepts(v12(16), '(log_3(2);log_3(2,2))∪(log_3(2,2);log_2(5)]')).toBe(true);
    expect(accepts(v12(16), '(log_3(2);log_2(5)]')).toBe(false);
    expect(accepts(v12(17), '5,52·10^(-22)')).toBe(true);
    expect(accepts(v12(18), '√(36-18√2)')).toBe(true);
    expect(accepts(v12(18), '3√(4+2√2)')).toBe(false);
    expect(accepts(v12(19), '(2;√13-1)')).toBe(true);
    expect(accepts(v12(19), '[2;√13-1]')).toBe(false);
    expect(accepts(v12(20), { a: 'нет', b: '833', c: '1001' })).toBe(true);
    const v13 = (n: number) => task(variant13, n);
    expect(accepts(v13(14), '-2/3')).toBe(true);
    expect(accepts(v13(14), '-2/3; -log_2(5)/6')).toBe(false);
    expect(accepts(v13(15), '18,8√5')).toBe(true);
    expect(accepts(v13(16), '(-∞;-3-4√2]∪(3;+∞)')).toBe(true);
    expect(accepts(v13(16), '(-∞;-3-4√2)∪(3;+∞)')).toBe(false);
    expect(accepts(v13(18), '√7-√2')).toBe(true);
    expect(accepts(v13(19), '{2/3}∪{1}∪[3;+∞)')).toBe(true);
    expect(accepts(v13(19), '{1}∪[3;+∞)')).toBe(false);
    expect(accepts(v13(20), { a: 'да', b: 'да', c: '-3329' })).toBe(true);
    expect(accepts(v13(20), { a: 'да', b: 'нет', c: '-3329' })).toBe(false);
    const v14 = (n: number) => task(variant14, n);
    expect(accepts(v14(14), '-log_2(25)/10; -0,2')).toBe(true);
    expect(accepts(v14(14), '-0,2')).toBe(false);
    expect(accepts(v14(15), '118√7/7')).toBe(true);
    expect(accepts(v14(16), '(-∞;-2)∪[(8+√2)/4;+∞)')).toBe(true);
    expect(accepts(v14(16), '(-∞;-2)∪(2;+∞)')).toBe(false);
    expect(v14(18).status).toBe('needs_review');
    expect(accepts(v14(19), '(-3;-(5+√13)/6)∪((√13-5)/6;0)')).toBe(true);
    expect(accepts(v14(19), '(-3;0)')).toBe(false);
    expect(accepts(v14(20), { a: 'да', b: 'да', c: '-4624' })).toBe(true);
    const v15 = (n: number) => task(variant15, n);
    expect(accepts(v15(14), '-1,5')).toBe(true);
    expect(accepts(v15(14), '-1,75; -1,5')).toBe(false);
    expect(accepts(v15(15), '√6/3')).toBe(true);
    expect(accepts(v15(16), '(-3;-1)∪(1;3)∪{4}')).toBe(true);
    expect(accepts(v15(16), '(-3;-1)∪(1;3)')).toBe(false);
    expect(v15(17).status).toBe('needs_review');
    expect(accepts(v15(18), '15√97/4')).toBe(true);
    expect(accepts(v15(19), '(-∞;-3)∪(-3;-1)∪(1;3)∪(3;+∞)')).toBe(true);
    expect(accepts(v15(19), '(-∞;-1)∪(1;+∞)')).toBe(false);
    expect(accepts(v15(20), { a: 'да', b: 'нет', c: '111' })).toBe(true);
    const v16 = (n: number) => task(variant16, n);
    expect(accepts(v16(14), '6')).toBe(true);
    expect(accepts(v16(14), '6; 12')).toBe(false);
    expect(accepts(v16(16), '[-5;-3)∪(-√3;√3)∪(3;+∞)')).toBe(true);
    expect(accepts(v16(16), '(-5;-3)∪(-√3;√3)∪(3;+∞)')).toBe(false);
    expect(v16(17).status).toBe('needs_review');
    expect(accepts(v16(18), '10√73/3')).toBe(true);
    expect(accepts(v16(19), '(0;0,5)∪(0,5;2/3)∪(2/3;1)∪(1;2)∪(2;1+√6/2)')).toBe(true);
    expect(accepts(v16(19), '(0;(2+√6)/2)')).toBe(false);
    expect(accepts(v16(20), { a: 'да', b: 'нет', c: '37/27' })).toBe(true);
    const v17 = (n: number) => task(variant17, n);
    expect(accepts(v17(14), '4π; 7π/2; 5π/2; 2π; 3π/2; π; π/2; 0')).toBe(true);
    expect(accepts(v17(14), '0; π/2; π; 3π/2; 2π; 5π/2; 3π; 7π/2; 4π')).toBe(false);
    expect(accepts(v17(15), 'arctg(√102/3)')).toBe(true);
    expect(accepts(v17(16), '(-4√2;-4)∪(-4;-√7]∪[√7;4)∪(4;4√2)')).toBe(true);
    expect(accepts(v17(16), '(-4√2;-√7]∪[√7;4√2)')).toBe(false);
    expect(v17(17).status).toBe('needs_review');
    expect(accepts(v17(18), '150√3')).toBe(true);
    expect(
      accepts(
        v17(19),
        '(-2-arccos(0,6)/(6π);-2+arccos(0,6)/(6π)]∪[2-arccos(0,6)/(6π);2+arccos(0,6)/(6π))',
      ),
    ).toBe(true);
    expect(accepts(v17(19), '[2-arccos(0,6)/(6π);2+arccos(0,6)/(6π))')).toBe(false);
    expect(accepts(v17(20), { a: 'да', b: 'нет', c: '880' })).toBe(true);
    const v18 = (n: number) => task(variant18, n);
    expect(accepts(v18(14), '4π; 3π; 5π/2; 2π; 3π/2; π')).toBe(true);
    expect(accepts(v18(14), 'π; 3π/2; 2π; 5π/2; 3π; 7π/2; 4π')).toBe(false);
    expect(accepts(v18(15), 'arctg(√15)')).toBe(true);
    expect(accepts(v18(16), '(-∞;-3)∪(-3;-√6)∪(√6;3)∪(3;+∞)')).toBe(true);
    expect(accepts(v18(16), '(-∞;-√6)∪(√6;+∞)')).toBe(false);
    expect(v18(17).status).toBe('needs_review');
    expect(
      accepts(
        v18(19),
        '(-2-arccos(0,4)/(4π);-2+arccos(0,4)/(4π)]∪[2-arccos(0,4)/(4π);2+arccos(0,4)/(4π))',
      ),
    ).toBe(true);
    expect(accepts(v18(20), { a: 'да', b: 'нет', c: '385' })).toBe(true);
    const v19 = (n: number) => task(variant19, n);
    expect(accepts(v19(14), '-17π/8; -19π/8; -31π/12; -21π/8; -23π/8; -35π/12')).toBe(true);
    expect(accepts(v19(14), '-23π/8; -21π/8; -19π/8; -17π/8')).toBe(false);
    expect(accepts(v19(15), 'arccos(√21/7)')).toBe(true);
    expect(accepts(v19(16), '(-∞;-10)∪[-4√2;-√2/8]∪[√2/8;4√2]∪(10;+∞)')).toBe(true);
    expect(accepts(v19(16), '(-∞;-10)∪(-4√2;-√2/8)∪(√2/8;4√2)∪(10;+∞)')).toBe(false);
    expect(accepts(v19(18), '√11(√5-1)')).toBe(false); // outside the bound grammar
    expect(accepts(v19(18), '√55-√11')).toBe(true);
    expect(accepts(v19(19), '(-∞;0)∪(0;6-2√6]∪[6+2√6;+∞)')).toBe(true);
    expect(accepts(v19(19), '(-∞;0)∪(0;6-2√6)∪(6+2√6;+∞)')).toBe(false);
    expect(accepts(v19(20), { a: 'да', b: 'нет', c: '12' })).toBe(true);
  });

  it('a repeated statement is only allowed with its own figure', () => {
    const repeated = [...EARLIER, ...NEW].flatMap((v) =>
      v.tasks.filter((t) => t.figureFingerprint).map((t) => [v.variant, t.taskNumber]),
    );
    expect(repeated).toEqual([
      [16, 12],
      [18, 12],
    ]);
    expect(task(variant16, 12).rawStatement).toBe(task(variant15, 12).rawStatement);
    expect(task(variant16, 12).imageUrl).not.toBe(task(variant15, 12).imageUrl);
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
      for (const v of NEW) {
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
        NEW.map((v) => [v.variant, scanOf(v.variant).file, v.sourcePageStart]),
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
      for (const v of NEW) await importYashchenko2027Variant(db, v);
      expect(await ids()).toEqual(before);
      expect(before).toHaveLength(20 * NEW.length);
    });
  });
});
