import {
  checkAnswer,
  examSkillsForTask,
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
import { BANK_SIZE, normalizeCondition } from './zybrilkaRussian/validate.js';

const all = BANK_NUMBERS.flatMap((b) => b.tasks);
const bookTasks = [...r26Variants, ...r36Variants].flatMap((v) => v.tasks);
const contentLines = (md: string) =>
  md
    .split('\n')
    .slice(1)
    .map((l) => normalizeCondition(l.replace(/\*\*/g, '')))
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
    expect(t4.tasks).toHaveLength(50);
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
        for (const l of contentLines(t.conditionMd))
          expect(lines.has(l), `№${t.taskNumber}.${t.n}: ${l}`).toBe(false);
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

describe('Зубрилка, банк №4–22 — import', () => {
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
