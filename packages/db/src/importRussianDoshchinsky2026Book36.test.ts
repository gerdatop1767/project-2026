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

  it('В32 №4 is published with the key 34 and an explanation that follows the FIPI 2026 list', () => {
    const t = prepared.find((v) => v.variant === 32)!.tasks.find((x) => x.taskNumber === 4)!;
    expect(t.status).toBe('published');
    expect(t.reviewReason).toBeNull();
    expect(t.correctAnswer).toBe('34');
    expect(t.digitSetOrderInsensitive).toBe(true);
    expect(checkAnswer('34', t.correctAnswer, { digitSetOrderInsensitive: true })).toBe(true);
    expect(checkAnswer('345', t.correctAnswer, { digitSetOrderInsensitive: true })).toBe(false);
    // «Орфоэпический список – 2026» (docs/sources/fipi-orthoepic-2026.json): зАсветло, нОгтя.
    expect(t.explanationMd).toContain('зАсветло');
    expect(t.explanationMd).toContain('нОгтя');
    expect(t.explanationMd).not.toContain('засветлО');
    expect(t.explanationMd).not.toMatch(/ногтЯ/);
    expect(t.explanationMd).toMatch(/Ответ: 34\.$/);
  });

  it('В10 №14 keeps the key 14 and its explanation now ends with that answer', () => {
    const t = prepared.find((v) => v.variant === 10)!.tasks.find((x) => x.taskNumber === 14)!;
    expect(t.status).toBe('published');
    expect(t.correctAnswer).toBe('14');
    expect(t.conditionMd).toContain('4) Водолазы погрузились (В)ГЛУБЬ моря');
    expect(t.explanationMd).toMatch(/Ответ: 14\.$/);
    expect(t.explanationMd).toContain('4) «в глубь моря» — раздельно');
    expect(t.explanationMd).not.toMatch(/«вглубь»[^.]*— слитно/);
  });

  it('В8 №10 keeps the key 235; the explanation reads row 3 as сЫзнова, изЫмать, сЫграть', () => {
    const t = prepared.find((v) => v.variant === 8)!.tasks.find((x) => x.taskNumber === 10)!;
    expect(t.status).toBe('published');
    expect(t.correctAnswer).toBe('235');
    expect(t.digitSetOrderInsensitive).toBe(true);
    expect(t.conditionMd).toContain('3) с..знова, из..мать, с..грать');
    expect(checkAnswer('523', t.correctAnswer, { digitSetOrderInsensitive: true })).toBe(true);
    expect(checkAnswer('25', t.correctAnswer, { digitSetOrderInsensitive: true })).toBe(false);
    expect(t.explanationMd).toContain('3) сЫзнова, изЫмать, сЫграть — везде Ы');
    expect(t.explanationMd).not.toMatch(/изЪять|изъять/i);
    expect(t.explanationMd).toMatch(/Ответ: 235\.$/);
  });

  const task = (variant: number, n: number) =>
    prepared.find((v) => v.variant === variant)!.tasks.find((x) => x.taskNumber === n)!;
  const accepts = (t: ReturnType<typeof task>, a: string) =>
    [t.correctAnswer, ...t.acceptedAnswers].some((key) =>
      checkAnswer(a, key, { digitSetOrderInsensitive: t.digitSetOrderInsensitive }),
    );

  it('no task of the book is left under review', () => {
    const review = prepared.flatMap((v) =>
      v.tasks.filter((t) => t.status !== 'published').map((t) => `В${v.variant} №${t.taskNumber}`),
    );
    expect(review).toEqual([]);
  });

  it('В34 №14: «в глубь моря» is the noun «глубь» (ROS: «в глубь океана»), answer 12', () => {
    const t = task(34, 14);
    expect(t.status).toBe('published');
    expect(t.reviewReason).toBeNull();
    expect(t.correctAnswer).toBe('12');
    expect(accepts(t, '21')).toBe(true);
    expect(accepts(t, '2')).toBe(false);
    expect(t.conditionMd).toContain('1) Водолазы погрузились (В)ГЛУБЬ моря');
    expect(t.explanationMd).toContain('в глубь океана, в глубь веков');
    expect(t.explanationMd).not.toMatch(/«вглубь моря» пишется слитно/);
    expect(t.explanationMd).toMatch(/Ответ: 12\.$/);
  });

  it('В10 №14 explains «в глубь моря» the same way as В34 №14, answer 14', () => {
    const t = task(10, 14);
    expect(t.correctAnswer).toBe('14');
    expect(t.explanationMd).toContain('в глубь океана, в глубь веков');
    expect(t.explanationMd).toMatch(/Ответ: 14\.$/);
  });

  it('В2 №15: the fourth gap is numbered (4) (the book prints (3) twice), answer 3', () => {
    const t = task(2, 15);
    expect(t.status).toBe('published');
    expect(t.conditionMd).toContain('на си(3)ей стекля(4)ой табличке.');
    expect(t.conditionMd.match(/\(3\)/g)).toHaveLength(1);
    expect(t.correctAnswer).toBe('3');
    expect(t.explanationMd).toContain('(4) «стеклянной»');
    expect(t.explanationMd).toMatch(/Ответ: 3\.$/);
  });

  it('В19 №6: the word written out is «действительные» (the key misprints «действительно»)', () => {
    const t = task(19, 6);
    expect(t.status).toBe('published');
    expect(t.conditionMd).toContain('современные действительные реалии');
    expect(t.correctAnswer).toBe('действительные');
    expect(t.acceptedAnswers).toEqual([]);
    expect(accepts(t, 'действительные')).toBe(true);
    expect(accepts(t, 'действительно')).toBe(false);
    expect(t.explanationMd).toMatch(/Ответ: действительные\.$/);
  });

  it('В21 №3: statement 5 contradicts the text, answer 234 in any order', () => {
    const t = task(21, 3);
    expect(t.status).toBe('published');
    expect(t.correctAnswer).toBe('234');
    expect(t.digitSetOrderInsensitive).toBe(true);
    expect(accepts(t, '432')).toBe(true);
    expect(accepts(t, '2345')).toBe(false);
    expect(prepared.find((v) => v.variant === 21)!.passages.A.bodyMd).toContain(
      'являются, безусловно, огромным вкладом в науку',
    );
    expect(t.explanationMd).toContain('5) Неверно');
    expect(t.explanationMd).toMatch(/Ответ: 234\.$/);
  });

  it('В32 №16: sentence 1 stays as printed (no «и»), so it needs two commas; answer 25', () => {
    const t = task(32, 16);
    expect(t.status).toBe('published');
    expect(t.conditionMd).toContain('устанавливают в алмазные пилы резцы превращают');
    expect(t.correctAnswer).toBe('25');
    expect(accepts(t, '52')).toBe(true);
    expect(accepts(t, '125')).toBe(false);
    expect(t.explanationMd).toContain('1) Две запятые');
    expect(t.explanationMd).toMatch(/Ответ: 25\.$/);
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

  it('a corrected explanation or status updates only its own row and keeps its id', async () => {
    // Re-create the state before the fix (В32 №4 under review with the old
    // explanation, В10 №14 ending with «Ответ: 1»), then import the fixed data.
    const patch = (variant: number, taskNumber: number, change: object) =>
      prepared.map((v) =>
        v.variant !== variant
          ? v
          : {
              ...v,
              tasks: v.tasks.map((t) => (t.taskNumber === taskNumber ? { ...t, ...change } : t)),
            },
      );
    const old = patch(32, 4, {
      status: 'needs_review',
      reviewReason: 'old reason',
      explanationMd: 'old explanation. Ответ по ключу: 34.',
    }).map((v) =>
      v.variant !== 10
        ? v
        : {
            ...v,
            tasks: v.tasks.map((t) =>
              t.taskNumber === 14 ? { ...t, explanationMd: 'old explanation. Ответ: 1.' } : t,
            ),
          },
    );
    await importRussianDoshchinsky2026Book36(testDb.db, old);
    const before = new Map((await bookTasks()).map((r) => [r.id, r.updatedAt.toISOString()]));

    const fixed = await importRussianDoshchinsky2026Book36(testDb.db, prepared);
    expect(fixed.created).toBe(0);
    expect(fixed.updated).toBe(2);

    const rows = await bookTasks();
    expect(new Set(rows.map((r) => r.id))).toEqual(new Set(before.keys()));
    const changed = rows.filter((r) => r.updatedAt.toISOString() !== before.get(r.id));
    expect(changed.map((r) => [r.sourceVariant, r.taskNumber]).sort()).toEqual([
      [10, 14],
      [32, 4],
    ]);
    const v32n4 = changed.find((r) => r.sourceVariant === 32)!;
    expect(v32n4.status).toBe('published');
    expect(v32n4.correctAnswer).toBe('34');
    expect(v32n4.explanationMd).toContain('нОгтя');
    const v10n14 = changed.find((r) => r.sourceVariant === 10)!;
    expect(v10n14.correctAnswer).toBe('14');
    expect(v10n14.explanationMd).toMatch(/Ответ: 14\.$/);

    const again = await importRussianDoshchinsky2026Book36(testDb.db, prepared);
    expect(again.updated).toBe(0);
    expect(again.unchanged).toBe(rows.length);
  });

  it('resolving the five reviewed tasks updates exactly those rows and keeps their ids', async () => {
    // The state before this fix: the five tasks under review with the key's
    // answers and the old В2 №15 numbering, and the old В10 №14 explanation.
    const old: Partial<Record<string, object>> = {
      '2/15': {
        status: 'needs_review',
        reviewReason: 'old',
        conditionMd: 'Надпись… си(3)ей стекля(3)ой табличке.',
      },
      '19/6': { status: 'needs_review', reviewReason: 'old', correctAnswer: 'действительно' },
      '21/3': { status: 'needs_review', reviewReason: 'old', correctAnswer: '2345' },
      '32/16': { status: 'needs_review', reviewReason: 'old', correctAnswer: '125' },
      '34/14': {
        status: 'needs_review',
        reviewReason: 'old',
        explanationMd: 'old. Ответ по ключу: 12.',
      },
      '10/14': { explanationMd: 'old. Ответ: 14.' },
    };
    const before = prepared.map((v) => ({
      ...v,
      tasks: v.tasks.map((t) => ({ ...t, ...old[`${v.variant}/${t.taskNumber}`] })),
    }));
    await importRussianDoshchinsky2026Book36(testDb.db, before);
    const rowsBefore = await bookTasks();
    const dates = new Map(rowsBefore.map((r) => [r.id, r.updatedAt.toISOString()]));
    expect(rowsBefore.filter((r) => r.status === 'needs_review')).toHaveLength(5);

    const fixed = await importRussianDoshchinsky2026Book36(testDb.db, prepared);
    expect(fixed.created).toBe(0);
    expect(fixed.updated).toBe(6);
    const rows = await bookTasks();
    expect(new Set(rows.map((r) => r.id))).toEqual(new Set(dates.keys()));
    const changed = rows.filter((r) => r.updatedAt.toISOString() !== dates.get(r.id));
    expect(changed.map((r) => `${r.sourceVariant}/${r.taskNumber}`).sort()).toEqual(
      Object.keys(old).sort(),
    );
    expect(rows.filter((r) => r.status !== 'published')).toHaveLength(0);
    const answer = (key: string) =>
      changed.find((r) => `${r.sourceVariant}/${r.taskNumber}` === key)!.correctAnswer;
    expect(answer('19/6')).toBe('действительные');
    expect(answer('21/3')).toBe('234');
    expect(answer('32/16')).toBe('25');
    expect(answer('34/14')).toBe('12');
    expect(answer('2/15')).toBe('3');

    const again = await importRussianDoshchinsky2026Book36(testDb.db, prepared);
    expect(again.updated).toBe(0);
    expect(again.unchanged).toBe(rows.length);
  });

  it('the В8 №10 explanation fix updates only that row and keeps the answer 235', async () => {
    const old = prepared.map((v) =>
      v.variant !== 8
        ? v
        : {
            ...v,
            tasks: v.tasks.map((t) =>
              t.taskNumber === 10
                ? { ...t, explanationMd: '3) сЫзнова, изЪять — разные. Ответ: 25.' }
                : t,
            ),
          },
    );
    await importRussianDoshchinsky2026Book36(testDb.db, old);
    const before = new Map((await bookTasks()).map((r) => [r.id, r.updatedAt.toISOString()]));

    const fixed = await importRussianDoshchinsky2026Book36(testDb.db, prepared);
    expect(fixed.created).toBe(0);
    expect(fixed.updated).toBe(1);
    const rows = await bookTasks();
    expect(new Set(rows.map((r) => r.id))).toEqual(new Set(before.keys()));
    const changed = rows.filter((r) => r.updatedAt.toISOString() !== before.get(r.id));
    expect(changed.map((r) => [r.sourceVariant, r.taskNumber])).toEqual([[8, 10]]);
    expect(changed[0]!.correctAnswer).toBe('235');
    expect(changed[0]!.status).toBe('published');
    expect(changed[0]!.explanationMd).toMatch(/изЫмать.*Ответ: 235\.$/);

    const again = await importRussianDoshchinsky2026Book36(testDb.db, prepared);
    expect(again.updated).toBe(0);
  });
});
