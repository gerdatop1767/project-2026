import {
  checkAnswer,
  examSkillsForTask,
  gapCount,
  nnItems,
  gradeMultiPart,
  parseMultiPartSpec,
  parseStressEntry,
  type ParsedStressEntry,
} from '@zybrilka/shared';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bankAnswerColumns,
  bankContentHash,
  importZybrilkaRussianBank,
  validateBank,
} from './importZybrilkaRussianBank.js';
import { importZybrilkaRussian10, ZR10_SOURCE } from './importZybrilkaRussian10.js';
import { r26Variants } from './russianDoshchinsky2026/index.js';
import { r36Variants } from './russianDoshchinsky36/index.js';
import * as schema from './schema.js';
import { STRESS_ENTRIES } from './stressDictionary/data.js';
import { createTestDb } from './testing.js';
import { BANK_NUMBERS, bankCollectionSlug, bankSource } from './zybrilkaRussian/bank.js';
import { TASK4_INSTRUCTION } from './zybrilkaRussian/data/task04.js';
import { TASK8_CORRECT, TASK8_ERRORS, TASK8_TYPES } from './zybrilkaRussian/data/task08.js';
import { generalRule21, TEXTS_21 } from './zybrilkaRussian/data/task21.js';
import { TASK22_TERMS, TASK22_UNITS } from './zybrilkaRussian/data/task22.js';
import { MAX_SHARED_RIGHT } from './zybrilkaRussian/compose.js';
import { BANK_SIZE, normalizeCondition } from './zybrilkaRussian/validate.js';

const all = BANK_NUMBERS.flatMap((b) => b.tasks);
const byNumber = (n: number) => BANK_NUMBERS.find((b) => b.taskNumber === n)!.tasks;
const bookTasks = [...r26Variants, ...r36Variants].flatMap((v) => v.tasks);
const contentLines = (md: string) =>
  md
    .split('\n')
    .slice(1)
    .map((l) => l.replace(/\*\*/g, '').trim())
    // Format lines every task of the number shares: column headers, the closing instruction.
    .filter((l) => l !== l.toUpperCase() && !l.startsWith('Запишите в таблицу'))
    .map(normalizeCondition)
    .filter((l) => l.length >= 25);

describe('Зубрилка, банк №4–22 — data (static checks)', () => {
  it('every number in the bank is valid (complete or a batch of 10)', () => {
    expect(() => validateBank(BANK_NUMBERS, { allowIncomplete: true })).not.toThrow();
    for (const b of BANK_NUMBERS) {
      expect(b.tasks.length % 10, `№${b.taskNumber}`).toBe(0);
      expect(b.tasks.length).toBeLessThanOrEqual(BANK_SIZE);
    }
    expect(BANK_NUMBERS.some((b) => b.taskNumber === 10)).toBe(false);
  });

  it('the answer checker accepts every right answer and rejects a wrong one', () => {
    for (const t of all) {
      const cols = bankAnswerColumns(t);
      const where = `№${t.taskNumber}.${t.n}`;
      const check = (raw: string) =>
        [cols.correctAnswer, ...cols.acceptedAnswers].some((key) =>
          checkAnswer(raw, key, { digitSetOrderInsensitive: cols.digitSetOrderInsensitive }),
        );
      if (t.answer.type === 'digits') {
        const d = t.answer.digits;
        expect(check(d), where).toBe(true);
        expect(check([...d].reverse().join('')), where).toBe(true);
        expect(check(d.length > 1 ? d.slice(1) : '9'), where).toBe(false);
      } else if (t.answer.type === 'word') {
        for (const w of [t.answer.word, ...t.answer.accepted]) {
          expect(check(w), where).toBe(true);
          expect(check(` ${w.toUpperCase()} `), where).toBe(true);
        }
        expect(check('слово'), where).toBe(false);
      } else {
        const spec = parseMultiPartSpec(cols.correctAnswer)!;
        const right = Object.fromEntries(
          spec.parts.map((p, i) => [p.id, t.answer.type === 'match' ? t.answer.parts[i]! : '']),
        );
        expect(gradeMultiPart(spec, right).status, where).toBe('all_correct');
      }
    }
  });

  it('task 4: every option is a FIPI-list word; right ones carry its stress, wrong ones another vowel', () => {
    const stress = new Map<string, number>();
    for (const line of STRESS_ENTRIES) {
      const e = parseStressEntry(line) as ParsedStressEntry;
      stress.set(e.word.replace(/ё/g, 'е'), e.stressIndex);
    }
    const t4 = BANK_NUMBERS.find((b) => b.taskNumber === 4)!;
    expect(t4.tasks).toHaveLength(100);
    for (const t of t4.tasks) {
      expect(t.conditionMd.startsWith(TASK4_INSTRUCTION)).toBe(true);
      const options = t.conditionMd
        .split('\n')
        .filter((l) => /^\d\) /.test(l))
        .map((l) => l.slice(3));
      expect(options).toHaveLength(5);
      const right = options.map((o) => {
        const word = o.toLowerCase();
        const at = [...o].findIndex((ch) => ch !== ch.toLowerCase());
        expect(stress.has(word), `№4.${t.n} ${o}`).toBe(true);
        return stress.get(word) === at;
      });
      const digits = right.map((r, i) => (r ? String(i + 1) : '')).join('');
      expect(digits, `№4.${t.n}`).toBe(t.answer.type === 'digits' ? t.answer.digits : '');
      expect(digits.length).toBeGreaterThanOrEqual(2);
      expect(digits.length).toBeLessThanOrEqual(4);
    }
  });

  it('repeats nothing of the imported books: no task 4 option set, no sentence of tasks 5–22', () => {
    const t4Books = new Set(
      bookTasks.filter((t) => t.taskNumber === 4).map((t) => contentOptions(t.conditionMd)),
    );
    const lines = new Set(
      bookTasks
        .filter((t) => t.taskNumber >= 5 && t.taskNumber <= 22)
        .flatMap((t) => contentLines(t.conditionMd)),
    );
    expect(lines.size).toBeGreaterThan(1000);
    for (const t of all) {
      if (t.taskNumber === 4)
        expect(t4Books.has(contentOptions(t.conditionMd)), `№4.${t.n}`).toBe(false);
      else
        for (const l of contentLines(t.conditionMd).filter(
          // Matching tasks: only the column of sentences is content (№22: А–Д, №8: 1–9);
          // the other column is the exam's shared list of terms or error types.
          (x) =>
            t.answer.type !== 'match' ||
            (t.taskNumber === 8 ? /^\d\) /.test(x) : /^[абвгд]\) /.test(x)),
        ))
          expect(lines.has(l), `№${t.taskNumber}.${t.n}: ${l}`).toBe(false);
    }
  });

  it('neighbouring tasks are not near-copies (5, 7: ≤ 2 shared right units)', () => {
    const items = (md: string) =>
      new Set(
        md
          .split('\n\n')
          .slice(1)
          .join('\n')
          .split(/\n|\(\d\)/)
          .map((x) => x.replace(/^\d\) /, '').trim())
          .filter((x) => x.length > 3),
      );
    for (const [n, from, max] of [
      [5, 11, MAX_SHARED_RIGHT],
      [7, 1, MAX_SHARED_RIGHT],
    ] as const) {
      const sets = byNumber(n)
        .filter((t) => t.n >= from)
        .map((t) => ({ n: t.n, s: items(t.conditionMd) }));
      for (const a of sets)
        for (const b of sets)
          if (a.n < b.n)
            expect(
              [...a.s].filter((x) => b.s.has(x)).length,
              `№${n}: ${a.n} и ${b.n}`,
            ).toBeLessThanOrEqual(max);
    }
  });

  it('task 21: one connected text per task; the answer is recomputed under both readings of the rules', () => {
    const tasks = byNumber(21);
    expect(TEXTS_21).toHaveLength(100);
    const seen = new Set<string>();
    tasks.forEach((t, i) => {
      const text = TEXTS_21[i]!;
      const where = `№21.${t.n} «${text.title}»`;
      const sentences = t.conditionMd
        .split('\n\n')[1]!
        .split(/\(\d\)/)
        .filter(Boolean)
        .map((x) => x.trim());
      expect(sentences, where).toEqual(text.sentences.map((s) => s.text));
      expect(sentences.length, where).toBeGreaterThanOrEqual(7);
      expect(sentences.length, where).toBeLessThanOrEqual(9);
      for (const s of sentences) {
        expect(seen.has(s), `${where}: ${s}`).toBe(false);
        seen.add(s);
      }
      const mark = { c: ',', d: '—', k: ':' }[text.sign];
      for (const general of [true, false]) {
        const groups = new Map<string, Set<number>>();
        text.sentences.forEach((s, k) => {
          expect(s.text.split(mark).length - 1, where).toBe(s.tags.length);
          for (const tag of s.tags) {
            const key = general ? generalRule21(text.sign, tag)! : tag;
            groups.set(key, (groups.get(key) ?? new Set()).add(k + 1));
          }
        });
        const repeated = [...groups.values()].filter((v) => v.size >= 2);
        expect(repeated, `${where} (${general ? 'общая' : 'подробная'} трактовка)`).toHaveLength(1);
        expect([...repeated[0]!].join(''), where).toBe(
          t.answer.type === 'digits' ? t.answer.digits : '',
        );
      }
    });
    const count = (f: (t: (typeof tasks)[number]) => string) =>
      tasks.reduce<Record<string, number>>((a, t) => ({ ...a, [f(t)]: (a[f(t)] ?? 0) + 1 }), {});
    expect(count((t) => t.kind)).toEqual({
      'знак: запятая': 50,
      'знак: тире': 32,
      'знак: двоеточие': 18,
    });
    expect(count((t) => String(t.answer.type === 'digits' ? t.answer.digits.length : 0))).toEqual({
      2: 45,
      3: 35,
      4: 20,
    });
  });

  it('tasks 8 and 22: the answer is recomputed from the pools; no two listed terms overlap', () => {
    const column = (md: string, re: RegExp) =>
      md
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => re.test(l))
        .map((l) => l.slice(3));
    const term = new Map(TASK22_UNITS.map((u) => [u[1], u[0]]));
    for (const t of byNumber(22)) {
      const left = column(t.conditionMd, /^[АБВГД]\) /);
      const right = column(t.conditionMd, /^\d\) /);
      expect(new Set(right.map((x) => TASK22_TERMS[x]!.group)).size, `№22.${t.n}`).toBe(9);
      expect(right.includes('перифраза') && right.includes('контекстные синонимы')).toBe(false);
      const parts = left.map((x) => String(right.indexOf(term.get(x)!) + 1));
      expect(parts, `№22.${t.n}`).toEqual(
        t.answer.type === 'match' ? t.answer.parts.map(String) : [],
      );
    }
    const error = new Map(TASK8_ERRORS.map((e) => [e[1], TASK8_TYPES[e[0]]!.label]));
    const right8 = new Set(TASK8_CORRECT.map((c) => c[0]));
    for (const t of byNumber(8)) {
      const types = column(t.conditionMd, /^[АБВГД]\) /);
      const sentences = column(t.conditionMd, /^\d\) /);
      expect(
        sentences.filter((x) => right8.has(x)),
        `№8.${t.n}`,
      ).toHaveLength(4);
      const parts = types.map((ty) => {
        const hits = sentences.flatMap((x, i) => (error.get(x) === ty ? [String(i + 1)] : []));
        expect(hits, `№8.${t.n} ${ty}`).toHaveLength(1);
        return hits[0];
      });
      expect(parts, `№8.${t.n}`).toEqual(
        t.answer.type === 'match' ? t.answer.parts.map(String) : [],
      );
    }
  });

  it('tasks 17–20 have the exam form: 4–8 places, 40–50% traps, few one-digit answers; the answer agrees with the explanation', () => {
    for (const n of [17, 18, 19, 20]) {
      let places = 0;
      let traps = 0;
      let single = 0;
      const seen = new Set<string>();
      for (const t of byNumber(n)) {
        const where = `№${n}.${t.n}`;
        const text = t.conditionMd.split('\n\n')[1]!;
        const count = (text.match(/\(\d\)/g) ?? []).length;
        expect(count, where).toBeGreaterThanOrEqual(4);
        expect(count, where).toBeLessThanOrEqual(8);
        const lines = t.explanationMd.split('\n\n').filter((l) => /^\(\d\) Между/.test(l));
        expect(lines, where).toHaveLength(count);
        const needed = lines.flatMap((l, i) =>
          l.includes('**запятая нужна**') ? [String(i + 1)] : [],
        );
        const digits = t.answer.type === 'digits' ? t.answer.digits : '';
        expect(needed.join(''), where).toBe(digits);
        const fixed = /Расставим знаки: «(.*)»/.exec(t.explanationMd)![1]!;
        expect(fixed.split(',').length - 1, where).toBe(digits.length);
        expect(fixed.replace(/[\s,]/g, ''), where).toBe(
          text.replace(/\s*\(\d\)/g, '').replace(/[\s,]/g, ''),
        );
        expect(seen.has(fixed), where).toBe(false);
        seen.add(fixed);
        places += count;
        traps += count - digits.length;
        if (digits.length === 1) single++;
      }
      expect(traps / places, `№${n} traps`).toBeGreaterThanOrEqual(0.4);
      expect(traps / places, `№${n} traps`).toBeLessThanOrEqual(0.5);
      expect(single, `№${n} one-digit answers`).toBeLessThanOrEqual(10);
    }
  });

  it('maps every number to its Learning Engine skill', () => {
    for (const b of BANK_NUMBERS) {
      const link = examSkillsForTask({
        subjectId: 'russian',
        taskNumber: b.taskNumber,
        source: bankSource(b.taskNumber),
        sourceYear: 2027,
      });
      expect(link.edition).toBe('ege-2027');
      expect(link.skillKeys, `№${b.taskNumber}`).toHaveLength(1);
      expect(link.skillKeys[0]).toMatch(
        new RegExp(`^russian\\.${String(b.taskNumber).padStart(2, '0')}-`),
      );
    }
  });
});

function contentOptions(md: string): string {
  return md
    .split('\n')
    .filter((l) => /^\d\) /.test(l.trim()))
    .map((l) => l.trim().slice(3).replace(/ё/g, 'е'))
    .sort()
    .join('|');
}

describe('Зубрилка, банк №4–22 — import', { timeout: 120_000 }, () => {
  let testDb: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    testDb = await createTestDb();
    await importZybrilkaRussian10(testDb.db);
  });
  afterAll(async () => {
    await testDb.close();
  });

  const bankRows = () =>
    testDb.db
      .select()
      .from(schema.tasks)
      .where(
        inArray(
          schema.tasks.source,
          BANK_NUMBERS.map((b) => bankSource(b.taskNumber)),
        ),
      );

  it('by default imports only complete numbers', async () => {
    const r = await importZybrilkaRussianBank(testDb.db);
    const complete = BANK_NUMBERS.filter((b) => b.tasks.length === BANK_SIZE);
    expect(r.map((x) => x.taskNumber)).toEqual(complete.map((b) => b.taskNumber));
  });

  it('imports every number into its own collection of sets × 10', async () => {
    const r = await importZybrilkaRussianBank(testDb.db, { allowIncomplete: true });
    expect(r).toHaveLength(BANK_NUMBERS.length);
    const rows = await bankRows();
    expect(rows).toHaveLength(all.length);
    for (const t of rows) {
      expect(t.subjectId).toBe('russian');
      expect(t.sourceYear).toBe(2027);
      expect(t.status).toBe('published');
      expect(t.contentHash).toBe(bankContentHash(t.taskNumber, t.sourceVariant!, t.conditionMd));
      expect(`${t.source} ${t.sourceDocument}`).not.toMatch(/ФИПИ|Дощинск/i);
    }
    for (const b of BANK_NUMBERS) {
      const [c] = await testDb.db
        .select()
        .from(schema.collections)
        .where(eq(schema.collections.slug, bankCollectionSlug(b.taskNumber)));
      expect(c).toMatchObject({ publisher: 'Зубрилка', inAllSources: true, examFormat: null });
      const links = await testDb.db
        .select({ taskNumber: schema.tasks.taskNumber })
        .from(schema.variantTasks)
        .innerJoin(schema.variants, eq(schema.variants.id, schema.variantTasks.variantId))
        .innerJoin(schema.tasks, eq(schema.tasks.id, schema.variantTasks.taskId))
        .where(eq(schema.variants.collectionId, c!.id));
      expect(links).toHaveLength(b.tasks.length);
      expect(new Set(links.map((l) => l.taskNumber))).toEqual(new Set([b.taskNumber]));
    }
  });

  it('a second run changes nothing; №10 stays untouched', async () => {
    const z10Before = await testDb.db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.source, ZR10_SOURCE));
    const before = await bankRows();
    const r = await importZybrilkaRussianBank(testDb.db, { allowIncomplete: true });
    for (const x of r) expect(x).toMatchObject({ created: 0, updated: 0 });
    const after = await bankRows();
    const byId = (xs: typeof before) => [...xs].sort((a, b) => a.id.localeCompare(b.id));
    expect(byId(after)).toEqual(byId(before));
    expect(
      await testDb.db.select().from(schema.tasks).where(eq(schema.tasks.source, ZR10_SOURCE)),
    ).toEqual(z10Before);
  });

  it('a needs_review task is imported hidden, with its reason', async () => {
    const numbers = BANK_NUMBERS.map((b) =>
      b.taskNumber === 5
        ? { ...b, tasks: b.tasks.map((t) => (t.n === 2 ? { ...t, review: 'проверить' } : t)) }
        : b,
    );
    await importZybrilkaRussianBank(testDb.db, { numbers, allowIncomplete: true });
    const [row] = await testDb.db
      .select({ status: schema.tasks.status, reviewNote: schema.tasks.reviewNote })
      .from(schema.tasks)
      .where(and(eq(schema.tasks.source, bankSource(5)), eq(schema.tasks.sourceVariant, 2)));
    expect(row).toEqual({ status: 'needs_review', reviewNote: 'проверить' });
    await importZybrilkaRussianBank(testDb.db, { allowIncomplete: true });
  });

  it('invalid data writes nothing', async () => {
    const broken = BANK_NUMBERS.map((b) =>
      b.taskNumber === 6
        ? { ...b, tasks: b.tasks.map((t) => (t.n === 1 ? { ...t, hintMd: '' } : t)) }
        : b,
    );
    await expect(
      importZybrilkaRussianBank(testDb.db, { numbers: broken, allowIncomplete: true }),
    ).rejects.toThrow(/hint is missing/);
  });
});

describe('Зубрилка №15 in the «Н и НН» mini-game', () => {
  it('every place of every task becomes a question with exactly one gap, in its own word', () => {
    let questions = 0;
    for (const t of byNumber(15)) {
      const digits = t.answer.type === 'digits' ? t.answer.digits : '';
      const items = nnItems({
        id: `zr15-${t.n}`,
        taskNumber: 15,
        conditionMd: t.conditionMd,
        correctAnswer: digits,
        acceptedAnswers: null,
        explanationMd: t.explanationMd,
        passageMd: null,
        imageUrl: null,
      });
      const places = (t.conditionMd.match(/\(\d\)/g) ?? []).length;
      expect(items, `№15.${t.n}`).toHaveLength(places);
      for (const it of items) {
        expect(gapCount(it.text), `№15.${t.n}`).toEqual({ quizGaps: 1, otherGaps: 0 });
        expect(it.text).not.toMatch(/\(\d\)/);
      }
      questions += items.length;
    }
    expect(questions).toBeGreaterThanOrEqual(400);
  });
});
