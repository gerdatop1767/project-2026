import { checkAnswer, examSkillsForTask } from '@zybrilka/shared';
import { and, eq, ne } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  importZybrilkaRussian10,
  validateZybrilkaRussian10,
  ZR10_COLLECTION_SLUG,
  ZR10_SOURCE,
  zr10ContentHash,
} from './importZybrilkaRussian10.js';
import { r26Variants } from './russianDoshchinsky2026/index.js';
import { r36Variants } from './russianDoshchinsky36/index.js';
import * as schema from './schema.js';
import { createTestDb } from './testing.js';
import { buildTask10, TASK10_INSTRUCTION } from './zybrilkaRussian10/build.js';
import { checkWord, parseWord } from './zybrilkaRussian10/rules.js';
import { AUTHORED_TASKS_10 } from './zybrilkaRussian10/tasks.js';
import { ALL_TASKS_10, AUTHORED_TASKS_10_EXTRA } from './zybrilkaRussian10/extra.js';

const built = ALL_TASKS_10.map(buildTask10);
const rowsOf = (conditionMd: string) =>
  conditionMd
    .split('\n')
    .map((l) => l.match(/^\s*\d\)\s*(.+)$/)?.[1])
    .filter((r): r is string => !!r)
    .map((r) =>
      r
        .split(',')
        .map((w) => w.trim().toLowerCase().replace(/\s+/g, ' '))
        .sort()
        .join('|'),
    );

describe('Зубрилка №10 — authored data (static checks)', () => {
  it('has exactly 100 valid tasks numbered 1…100: 50 by hand, 50 generated', () => {
    expect(AUTHORED_TASKS_10).toHaveLength(50);
    expect(AUTHORED_TASKS_10_EXTRA).toHaveLength(50);
    expect(ALL_TASKS_10.map((t) => t.n)).toEqual(Array.from({ length: 100 }, (_, i) => i + 1));
    expect(() => validateZybrilkaRussian10(ALL_TASKS_10)).not.toThrow();
    const d = [1, 2, 3].map((x) => ALL_TASKS_10.filter((t) => t.difficulty === x).length);
    expect(d).toEqual([30, 40, 30]);
    expect(() => validateZybrilkaRussian10(ALL_TASKS_10)).not.toThrow();
  });

  it('every word obeys its spelling rule', () => {
    for (const t of ALL_TASKS_10)
      for (const row of t.rows)
        for (const w of row) expect(checkWord(w), `№${t.n} ${w.raw}`).toEqual([]);
  });

  it('the answer lists exactly the rows whose three words take one letter', () => {
    for (const t of built) {
      const expected = t.letters
        .map((row, i) => (new Set(row.map((l) => l.toLowerCase())).size === 1 ? String(i + 1) : ''))
        .join('');
      expect(t.correctAnswer, `№${t.n}`).toBe(expected);
      expect(t.correctAnswer.length, `№${t.n}`).toBeGreaterThanOrEqual(2);
    }
  });

  it('looks like the imported task 10: same instruction, five numbered rows, «(в любом порядке)»', () => {
    for (const t of built) {
      expect(t.conditionMd.startsWith(TASK10_INSTRUCTION)).toBe(true);
      expect(rowsOf(t.conditionMd)).toHaveLength(5);
      expect(t.correctAnswerDisplay).toBe(`${t.correctAnswer} (в любом порядке)`);
    }
  });

  it('the answer checker accepts the answer in any order and rejects a wrong one', () => {
    const opts = { digitSetOrderInsensitive: true };
    for (const t of built) {
      const reversed = [...t.correctAnswer].reverse().join('');
      expect(checkAnswer(t.correctAnswer, t.correctAnswer, opts), `№${t.n}`).toBe(true);
      expect(checkAnswer(reversed, t.correctAnswer, opts), `№${t.n}`).toBe(true);
      expect(checkAnswer(t.correctAnswer.slice(1), t.correctAnswer, opts), `№${t.n}`).toBe(false);
    }
  });

  it('the explanation covers every row and every word and ends with the answer', () => {
    for (const t of ALL_TASKS_10) {
      const b = buildTask10(t);
      for (let i = 1; i <= 5; i++) expect(b.explanationMd).toContain(`\n\n${i}) `);
      for (const row of t.rows)
        for (const w of row) {
          const { letter } = parseWord(w.raw);
          const shownWord = parseWord(w.raw).shown.replace('..', letter);
          expect(b.explanationMd.toLowerCase(), `№${t.n} ${w.raw}`).toContain(
            shownWord
              .split(' (')[0]!
              .replace(/^\(.*?\)\s*/, '')
              .toLowerCase(),
          );
        }
      expect(b.explanationMd.trim().endsWith(`Ответ: ${b.correctAnswer}.`)).toBe(true);
      expect(b.explanationMd).toContain('**Обрати внимание.**');
    }
  });

  it('has a realistic spread of difficulty', () => {
    const by = (d: number) => ALL_TASKS_10.filter((t) => t.difficulty === d).length;
    expect(by(1)).toBeGreaterThanOrEqual(10);
    expect(by(2)).toBeGreaterThanOrEqual(15);
    expect(by(3)).toBeGreaterThanOrEqual(10);
  });

  it('repeats no row of the imported books’ task 10', () => {
    const bookRows = new Set(
      [...r26Variants, ...r36Variants]
        .flatMap((v) => v.tasks)
        .filter((t) => t.taskNumber === 10)
        .flatMap((t) => rowsOf(t.conditionMd)),
    );
    expect(bookRows.size).toBeGreaterThan(100);
    for (const t of built)
      for (const row of rowsOf(t.conditionMd))
        expect(bookRows.has(row), `№${t.n}: ${row}`).toBe(false);
  });

  it('maps to the Learning Engine skill of task 10', () => {
    const link = examSkillsForTask({
      subjectId: 'russian',
      taskNumber: 10,
      source: ZR10_SOURCE,
      sourceYear: 2027,
    });
    expect(link.edition).toBe('ege-2027');
    expect(link.skillKeys).toContain('russian.10-prefixes');
  });
});

describe('Зубрилка №10 — import', () => {
  let testDb: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    testDb = await createTestDb();
  });
  afterAll(async () => {
    await testDb.close();
  });

  it('imports 100 tasks as 10 sets × 10 of the one Зубрилка collection', async () => {
    const r = await importZybrilkaRussian10(testDb.db);
    expect(r).toMatchObject({ total: 100, sets: 10, created: 100, updated: 0, unchanged: 0 });
    const tasks = await testDb.db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.source, ZR10_SOURCE));
    expect(tasks).toHaveLength(100);
    for (const t of tasks) {
      expect(t.subjectId).toBe('russian');
      expect(t.taskNumber).toBe(10);
      expect(t.sourceYear).toBe(2027);
      expect(t.digitSetOrderInsensitive).toBe(true);
      expect(t.contentHash).toBe(zr10ContentHash(t.sourceVariant!, t.rawStatement!));
      expect(t.sourceDocument).toContain('Зубрилки');
      expect(`${t.source} ${t.sourceDocument}`).not.toMatch(/ФИПИ/i);
    }
    const [collection] = await testDb.db
      .select()
      .from(schema.collections)
      .where(eq(schema.collections.slug, ZR10_COLLECTION_SLUG));
    expect(collection).toMatchObject({
      subjectId: 'russian',
      publisher: 'Зубрилка',
      status: 'published',
      inAllSources: true,
      examFormat: null,
    });
    const links = await testDb.db
      .select({ position: schema.variantTasks.position, n: schema.variants.variantNumber })
      .from(schema.variantTasks)
      .innerJoin(schema.variants, eq(schema.variants.id, schema.variantTasks.variantId))
      .where(eq(schema.variants.collectionId, collection!.id));
    expect(links).toHaveLength(100);
    expect(new Set(links.map((l) => `${l.n}:${l.position}`)).size).toBe(100);
  });

  it('a second run changes nothing and keeps ids', async () => {
    const before = await testDb.db
      .select({ id: schema.tasks.id, updatedAt: schema.tasks.updatedAt })
      .from(schema.tasks)
      .where(eq(schema.tasks.source, ZR10_SOURCE));
    const r = await importZybrilkaRussian10(testDb.db);
    expect(r).toMatchObject({ created: 0, updated: 0, unchanged: 100 });
    const after = await testDb.db
      .select({ id: schema.tasks.id, updatedAt: schema.tasks.updatedAt })
      .from(schema.tasks)
      .where(eq(schema.tasks.source, ZR10_SOURCE));
    expect(after.sort((a, b) => a.id.localeCompare(b.id))).toEqual(
      before.sort((a, b) => a.id.localeCompare(b.id)),
    );
    const vt = await testDb.db.select().from(schema.variantTasks);
    expect(vt).toHaveLength(100);
  });

  it('never touches tasks of other sources', async () => {
    const [topic] = await testDb.db
      .select({ id: schema.topics.id })
      .from(schema.topics)
      .where(eq(schema.topics.slug, 'russian-prefix-spelling'));
    const [other] = await testDb.db
      .insert(schema.tasks)
      .values({
        subjectId: 'russian',
        taskNumber: 10,
        topicId: topic!.id,
        difficulty: 2,
        conditionMd: 'Другое задание',
        explanationMd: 'Объяснение',
        answerType: 'short_answer',
        correctAnswer: '12',
        source: 'Другой источник',
        sourceVariant: 1,
        contentHash: 'other-source-hash',
      })
      .returning();
    await importZybrilkaRussian10(testDb.db);
    const [still] = await testDb.db
      .select()
      .from(schema.tasks)
      .where(and(eq(schema.tasks.id, other!.id), ne(schema.tasks.source, ZR10_SOURCE)));
    expect(still).toEqual(other);
  });

  it('a needs_review task is imported hidden', async () => {
    const tasks = ALL_TASKS_10.map((t) => (t.n === 7 ? { ...t, review: 'проверить' } : t));
    const r = await importZybrilkaRussian10(testDb.db, tasks);
    expect(r).toMatchObject({ updated: 1, needsReview: 1 });
    const [t7] = await testDb.db
      .select({ status: schema.tasks.status })
      .from(schema.tasks)
      .where(and(eq(schema.tasks.source, ZR10_SOURCE), eq(schema.tasks.sourceVariant, 7)));
    expect(t7!.status).toBe('needs_review');
    await importZybrilkaRussian10(testDb.db);
  });

  it('invalid data writes nothing', async () => {
    const broken = ALL_TASKS_10.slice(0, 99);
    await expect(importZybrilkaRussian10(testDb.db, broken)).rejects.toThrow(/expected 100/);
  });
});
