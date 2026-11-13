import { checkAnswer, gradeMultiPart, parseMultiPartSpec } from '@zybrilka/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { importRussianDoshchinsky2026Book36 } from './importRussianDoshchinsky2026Book36.js';
import { importRussianDoshchinsky36 } from './importRussianDoshchinsky2027Book36.js';
import * as schema from './schema.js';
import { createImportedRussian2027TestDb } from './testing.js';
import { importRussianVariant14 } from './importRussianDoshchinsky2027Variant14.js';

/**
 * Fixes from the quality audit of the Russian collections
 * (docs/reports/2026-11-russian-quality-audit.md). Each block names the
 * registry entry it covers. The two book collections are imported too, so
 * the collection-wide invariants (gaps, «\n», mixed scripts, hints) are
 * checked for all three sets.
 */
const R18 = 'ege-2027-doshchinskiy-russian';
const R36 = 'ege-2027-doshchinskiy-russian-36';
const R26 = 'ege-2026-doshchinskiy-russian-36';

type Row = typeof schema.tasks.$inferSelect & {
  collection: string;
  variant: number;
  passageBody: string | null;
};

describe('Russian quality audit fixes', () => {
  let testDb: Awaited<ReturnType<typeof createImportedRussian2027TestDb>>;
  let rows: Row[];

  const task = (collection: string, variant: number, taskNumber: number) => {
    const row = rows.find(
      (r) => r.collection === collection && r.variant === variant && r.taskNumber === taskNumber,
    );
    if (!row) throw new Error(`${collection} В${variant} №${taskNumber} missing`);
    return row;
  };
  const accepts = (row: Row, answer: string) =>
    [row.correctAnswer, ...row.acceptedAnswers].some((key) =>
      checkAnswer(answer, key, { digitSetOrderInsensitive: row.digitSetOrderInsensitive }),
    );

  async function loadRows() {
    const result = await testDb.db
      .select({
        task: schema.tasks,
        collection: schema.collections.slug,
        variant: schema.variants.variantNumber,
        passageBody: schema.passages.bodyMd,
      })
      .from(schema.variantTasks)
      .innerJoin(schema.tasks, eq(schema.tasks.id, schema.variantTasks.taskId))
      .innerJoin(schema.variants, eq(schema.variants.id, schema.variantTasks.variantId))
      .innerJoin(schema.collections, eq(schema.collections.id, schema.variants.collectionId))
      .leftJoin(schema.passages, eq(schema.passages.id, schema.tasks.passageId))
      .where(eq(schema.tasks.subjectId, 'russian'));
    return result.map((r) => ({
      ...r.task,
      collection: r.collection,
      variant: r.variant,
      passageBody: r.passageBody,
    }));
  }

  beforeAll(async () => {
    testDb = await createImportedRussian2027TestDb();
    await importRussianDoshchinsky2026Book36(testDb.db);
    await importRussianDoshchinsky36(testDb.db);
    rows = await loadRows();
  }, 120_000);

  afterAll(async () => {
    await testDb.close();
  });

  it('imports the three collections in full', () => {
    const count = (c: string) => rows.filter((r) => r.collection === c).length;
    expect(count(R18)).toBe(486);
    expect(count(R36)).toBe(936);
    expect(count(R26)).toBe(972);
  });

  describe('К1 — №8/№22 of 2027-18 are real multi-part specs', () => {
    const fixed: Record<string, string> = {
      '14-8': '62731',
      '14-22': '52984',
      '15-8': '19462',
      '15-22': '96183',
      '16-8': '98231',
      '16-22': '38692',
      '17-8': '32967',
      '17-22': '98216',
      '18-8': '38971',
      '18-22': '47268',
    };

    it('every multi_part task of all three collections parses', () => {
      const multi = rows.filter((r) => r.answerType === 'multi_part');
      expect(multi.length).toBe(180); // 36×2 + 36×2 + 18×2
      for (const r of multi) {
        expect(
          parseMultiPartSpec(r.correctAnswer),
          `${r.collection} В${r.variant} №${r.taskNumber}`,
        ).not.toBeNull();
      }
    });

    it.each(Object.entries(fixed))(
      'В%s: five parts А–Д, the key grades all_correct, one wrong digit does not',
      (id, digits) => {
        const [v, n] = id.split('-').map(Number);
        const row = task(R18, v!, n!);
        expect(row.status).toBe('published');
        expect(row.correctAnswerDisplay).toBe(digits);
        const spec = parseMultiPartSpec(row.correctAnswer)!;
        expect(spec.parts.map((p) => p.label)).toEqual(['А', 'Б', 'В', 'Г', 'Д']);
        expect(spec.parts.map((p) => p.correctAnswer).join('')).toBe(digits);
        const right = Object.fromEntries(spec.parts.map((p) => [p.id, p.correctAnswer]));
        expect(gradeMultiPart(spec, right).status).toBe('all_correct');
        const oneWrong = { ...right, a: right.a === '1' ? '2' : '1' };
        expect(gradeMultiPart(spec, oneWrong).status).toBe('partially_correct');
      },
    );

    it('their hints no longer list the answer letter by letter', () => {
      for (const r of rows.filter((x) => x.answerType === 'multi_part' && x.hintMd)) {
        const spec = parseMultiPartSpec(r.correctAnswer)!;
        const named = spec.parts.filter(
          (p) =>
            p.correctAnswer &&
            new RegExp(`${p.label}\\s*[=—–-]\\s*${p.correctAnswer}(?!\\d)`).test(r.hintMd!),
        );
        expect(
          named.length,
          `${r.collection} В${r.variant} №${r.taskNumber}: ${r.hintMd}`,
        ).toBeLessThan(2);
        expect(r.hintMd).not.toMatch(/\([АБВГД]\)/);
      }
    });
  });

  describe('К2/К3 — multi-word answers are accepted in the ЕГЭ blank form', () => {
    const cases: [number, number, string[], string[]][] = [
      [1, 25, ['отставаяспеша', 'спешаотставая', 'ОТСТАВАЯСПЕША', 'отставая спеша'], []],
      [2, 1, ['какоето', 'какое-то', 'некое', 'некоторое'], ['какоенибудь']],
      [2, 25, ['стехпор', 'с тех пор', 'СТЕХПОР'], ['стехпорр']],
      [3, 25, ['тоидело', 'то и дело'], []],
      [
        4,
        25,
        ['далёкимблизким', 'далекимблизким', 'близкимдалёким', 'далёким — близким'],
        ['далёким'],
      ],
      [5, 1, ['взависимостиот', 'в зависимости от'], ['взависимости']],
      [5, 25, ['закидаюткамнями', 'закидают камнями'], []],
      [7, 25, ['вконцеконцов', 'в конце концов'], []],
      [8, 25, ['тёмногосветлую', 'светлуютёмного'], []],
      [
        9,
        25,
        ['оставаласьвпамяти', 'оставаласьвмоейпамяти', 'оставалась в памяти'],
        ['осталасьвпамяти', 'осталась в памяти'],
      ],
      [10, 25, ['чужойматеринский', 'материнскийчужой'], []],
      [11, 25, ['своичужие', 'чужиесвои'], []],
      [12, 25, ['неудачиуспех', 'успехнеудачи'], []],
      [13, 25, ['далаотпор', 'дала отпор'], []],
      [14, 25, ['невыйдеттолка', 'не выйдет толка'], ['небудеттолку']],
      [15, 1, ['посравнениюс', 'по сравнению с', 'всравнениис'], []],
      [15, 25, ['сверхудонизу', 'сверху донизу'], []],
      [17, 1, ['чтото', 'что-то'], ['нечто']],
      [18, 25, ['памятникобелиск', 'обелискпамятник', 'памятник, обелиск'], ['памятник']],
    ];
    it.each(cases)('В%i №%i', (v, n, ok, bad) => {
      const row = task(R18, v, n);
      expect(row.correctAnswer).not.toMatch(/[\s,—-]/);
      for (const a of ok) expect(accepts(row, a), a).toBe(true);
      for (const a of bad) expect(accepts(row, a), a).toBe(false);
      expect(row.explanationMd).toMatch(new RegExp(`Ответ: ${row.correctAnswer}`));
      expect(row.explanationMd).not.toMatch(/вручную|проверяющ/);
    });

    it('no word key of 2027-18 keeps a space, hyphen, dash or comma', () => {
      for (const r of rows.filter((x) => x.collection === R18 && x.answerType === 'short_answer')) {
        expect(r.correctAnswer, `В${r.variant} №${r.taskNumber}`).not.toMatch(/[\s,—-]/);
      }
    });
  });

  it('К4 — В9 №1 accepts «лишь»; №1 alternatives the author accepts for the same task type', () => {
    expect(accepts(task(R18, 9, 1), 'лишь')).toBe(true);
    expect(accepts(task(R18, 9, 1), 'только')).toBe(true);
    expect(accepts(task(R18, 6, 1), 'такие')).toBe(true);
    expect(accepts(task(R18, 8, 1), 'как раз')).toBe(true);
    expect(accepts(task(R18, 8, 1), 'какраз')).toBe(true);
    expect(accepts(task(R18, 14, 1), 'такое')).toBe(true);
    expect(accepts(task(R18, 14, 1), 'то')).toBe(false);
  });

  it('№6 «заменив… запишите подобранное слово» — the key is the replacement, not the wrong word', () => {
    expect(accepts(task(R18, 17, 6), 'вину')).toBe(true);
    expect(accepts(task(R18, 17, 6), 'ответственность')).toBe(false);
    expect(accepts(task(R18, 18, 6), 'другом')).toBe(true);
    expect(accepts(task(R18, 18, 6), 'собратом')).toBe(false);
    expect(task(R18, 18, 6).hintMd).not.toContain('друг');
    for (const r of rows.filter((x) => x.taskNumber === 6 && x.conditionMd.includes('заменив'))) {
      const sentence = r.conditionMd.split('\n').filter(Boolean).at(-1)!.toLowerCase();
      const key = r.correctAnswer.toLowerCase();
      expect(
        new RegExp(`(?<![а-яё])${key}(?![а-яё])`).test(sentence),
        `${r.collection} В${r.variant}: «${key}» is in the sentence`,
      ).toBe(false);
    }
  });

  it('№1 — every «пропуск» task has exactly one gap in its text, never the answer itself', () => {
    const gap = /<\s*(?:\.\.\.|…)\s*>/g;
    for (const r of rows.filter((x) => x.conditionMd.includes('пропуск') && x.passageBody)) {
      const id = `${r.collection} В${r.variant} №${r.taskNumber}`;
      expect(r.passageBody!.match(gap)?.length ?? 0, id).toBe(1);
    }
    expect(task(R18, 2, 1).passageBody).toContain('выходишь уже на <…> жизненное плато');
    expect(task(R18, 7, 1).passageBody).toContain('Варя. Я <…> одна.');
    expect(task(R18, 18, 1).passageBody).not.toContain('своей ЖЕ');
    expect(task(R36, 31, 1).passageBody).toContain('вложил в <...> труд');
  });

  it('С5 — no literal «\\n» in any text, condition, explanation or hint', () => {
    for (const r of rows) {
      for (const text of [r.passageBody, r.conditionMd, r.explanationMd, r.hintMd]) {
        expect(text ?? '', `${r.collection} В${r.variant} №${r.taskNumber}`).not.toContain('\\n');
      }
    }
  });

  it('no word mixes Latin and Cyrillic letters', () => {
    const allowed = new Set(['ниj', 'въщiй']); // phonetic «j» in a suffix; an Old Russian quotation
    for (const r of rows) {
      for (const text of [r.passageBody, r.conditionMd, r.explanationMd, r.hintMd]) {
        const mixed = (text ?? '')
          .match(/[\p{L}]+/gu)
          ?.filter((w) => /[a-z]/i.test(w) && /[а-яё]/i.test(w) && !allowed.has(w));
        expect(mixed ?? [], `${r.collection} В${r.variant} №${r.taskNumber}`).toEqual([]);
      }
    }
    expect(task(R18, 4, 21).conditionMd).toContain('В XVII веке');
  });

  it('С1–С4, С6 — explanations agree with the confirmed keys', () => {
    const r26 = task(R26, 23, 10);
    expect(r26.correctAnswer).toBe('1345');
    expect(r26.explanationMd).toContain('беЗвкусный');
    expect(r26.explanationMd).not.toContain('беСвкусный');

    const v6 = task(R36, 6, 9);
    expect(v6.correctAnswer).toBe('125');
    expect(v6.explanationMd).toContain('4) стАрожил (от «старый»), теОретический, сотвОрить');
    expect(v6.explanationMd).not.toContain('старОжил');

    const v35n2 = task(R36, 35, 2);
    expect(v35n2.correctAnswer).toBe('35');
    expect(v35n2.explanationMd).toMatch(/2\) [^]*?— не соответствует\. 3\)/);

    const v35n22 = task(R36, 35, 22);
    expect(
      parseMultiPartSpec(v35n22.correctAnswer)!
        .parts.map((p) => p.correctAnswer)
        .join(''),
    ).toBe('23615');
    expect(v35n22.explanationMd).toContain('Б — 3: метафора');
    expect(v35n22.explanationMd).not.toContain('Б — 9');

    const v4n9 = task(R18, 4, 9);
    expect(v4n9.correctAnswer).toBe('12');
    expect(v4n9.explanationMd).not.toMatch(/скан|загальш/);
    expect(v4n9.explanationMd).toMatch(/Ответ: 12\.$/);
  });

  it('minor — typos, Latin letters and «Ответ:» lines', () => {
    expect(task(R18, 13, 15).explanationMd).not.toMatch(/owry/);
    expect(task(R18, 16, 2).explanationMd).not.toContain('explicit');
    expect(task(R18, 18, 9).explanationMd).toContain('блест-/блист-');
    expect(task(R18, 18, 9).hintMd).toContain('блест-/блист-');
    expect(task(R18, 9, 15).explanationMd).toMatch(/Ответ: 23457\.$/);
    expect(task(R18, 1, 25).explanationMd).toMatch(/Ответ: отставаяспеша/);
  });

  it('hints of the fixed tasks no longer name the answer', () => {
    // «a or b?» choice hints (both paronyms named on purpose) are not in this list.
    const fixed: [string, number, number][] = [
      [R26, 3, 7],
      [R26, 5, 26],
      [R26, 8, 7],
      [R26, 10, 1],
      [R26, 10, 5],
      [R26, 11, 7],
      [R26, 15, 7],
      [R26, 16, 7],
      [R26, 18, 7],
      [R26, 24, 7],
      [R26, 25, 7],
      [R26, 26, 26],
      [R18, 3, 7],
      [R18, 4, 6],
      [R18, 4, 7],
      [R18, 6, 1],
      [R18, 6, 6],
      [R18, 7, 1],
      [R18, 7, 6],
      [R18, 7, 7],
      [R18, 8, 1],
      [R18, 10, 1],
      [R18, 12, 1],
      [R18, 15, 10],
      [R18, 15, 24],
      [R18, 16, 23],
      [R18, 16, 26],
      [R18, 17, 6],
      [R18, 18, 1],
      [R18, 18, 26],
      [R36, 3, 7],
      [R36, 4, 5],
      [R36, 5, 7],
      [R36, 6, 1],
      [R36, 6, 6],
      [R36, 13, 7],
      [R36, 14, 7],
      [R36, 15, 5],
      [R36, 15, 7],

      [R36, 19, 5],
      [R36, 20, 7],
      [R36, 22, 7],
      [R36, 23, 5],
      [R36, 23, 7],
      [R36, 23, 26],
      [R36, 24, 5],
      [R36, 25, 5],
      [R36, 25, 7],
      [R36, 26, 6],
      [R36, 26, 7],
      [R36, 27, 5],
      [R36, 27, 7],
      [R36, 28, 26],
      [R36, 29, 7],
      [R36, 31, 5],
      [R36, 32, 6],
      [R36, 32, 7],

      [R36, 34, 7],
      [R36, 35, 6],
      [R36, 35, 7],
      [R36, 35, 26],
      [R36, 36, 7],
    ];
    const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е');
    for (const [c, v, n] of fixed) {
      const r = task(c, v, n);
      const hint = norm(r.hintMd ?? '');
      for (const key of [r.correctAnswer, ...r.acceptedAnswers]) {
        const k = norm(key);
        const named = /^\d+$/.test(k)
          ? new RegExp(`(?<!\\d)${k}(?!\\d)`).test(hint)
          : new RegExp(`(?<![а-я])${k}(?![а-я])`).test(hint);
        expect(named, `${c} В${v} №${n}: «${r.hintMd}» names «${key}»`).toBe(false);
      }
    }
  });

  it('hidden tasks: only the ones that still cannot be confirmed stay on review', () => {
    const review = rows
      .filter((r) => r.collection === R18 && r.status === 'needs_review')
      .map((r) => `В${r.variant} №${r.taskNumber}`)
      .sort();
    expect(review).toEqual(['В10 №4', 'В15 №4', 'В15 №6', 'В16 №4', 'В2 №8'].sort());
    expect(rows.filter((r) => r.collection !== R18 && r.status !== 'published')).toEqual([]);

    const v5n8 = parseMultiPartSpec(task(R18, 5, 8).correctAnswer)!;
    expect(v5n8.parts.map((p) => p.correctAnswer).join('')).toBe('36178');
    expect(task(R18, 7, 21).correctAnswer).toBe('24');
    expect(accepts(task(R18, 7, 21), '42')).toBe(true);
    const v2n8 = parseMultiPartSpec(task(R18, 2, 8).correctAnswer)!;
    expect(v2n8.parts.map((p) => p.correctAnswer)).toEqual(['5', '8', '', '9', '2']);
    expect(task(R18, 15, 6).correctAnswer).toBe('доля');
    for (const r of rows.filter((x) => x.collection === R18)) {
      const text = `${r.explanationMd} ${r.hintMd ?? ''}`;
      if (r.status === 'published')
        expect(text, `В${r.variant} №${r.taskNumber}`).not.toMatch(
          /подтверждены трижды|не определена/,
        );
    }
  });

  it('re-import keeps every id and changes nothing', async () => {
    const before = (await loadRows()).filter((r) => r.collection === R18 && r.variant === 14);
    await importRussianVariant14(testDb.db);
    const after = (await loadRows()).filter((r) => r.collection === R18 && r.variant === 14);
    const strip = (r: Row) => ({ ...r, updatedAt: null });
    expect(after.map((r) => r.id).sort()).toEqual(before.map((r) => r.id).sort());
    expect(after.map(strip).sort((a, b) => a.taskNumber - b.taskNumber)).toEqual(
      before.map(strip).sort((a, b) => a.taskNumber - b.taskNumber),
    );
    const v14 = await testDb.db
      .select({ id: schema.tasks.id })
      .from(schema.tasks)
      .where(and(eq(schema.tasks.subjectId, 'russian'), eq(schema.tasks.sourceVariant, 14)));
    expect(v14.length).toBeGreaterThanOrEqual(27);
  });
});
