import { describe, expect, it } from 'vitest';
import { DICTIONARY_TASKS, allDictionaryItems, dictionaryItems, writtenForm } from './index.js';

const words = DICTIONARY_TASKS.flatMap((t) =>
  t.categories.flatMap((c) => c.words.map((w) => ({ t, c, w }))),
);

describe('«Словарные слова и исключения» — the word lists', () => {
  it('covers the orthography tasks that need lists: 9, 10, 12, 13, 14, 15', () => {
    expect(DICTIONARY_TASKS.map((t) => t.taskNumber)).toEqual([9, 10, 12, 13, 14, 15]);
    expect(words.length).toBeGreaterThanOrEqual(300);
  });

  it('every letter gap, filled with its answer, gives the word — one gap, two different letters', () => {
    for (const { c, w } of words.filter((x) => x.c.kind === 'letter')) {
      expect(w.gap.split('..').length - 1, w.key).toBe(1);
      expect(w.gap.replace('..', w.answer), w.key).toBe(w.word);
      expect(w.options, w.key).toContain(w.answer);
      expect(new Set(w.options).size, w.key).toBe(2);
      expect(c.rule.length).toBeGreaterThan(10);
    }
  });

  it('every «слитно / раздельно / через дефис» gap, written its way, gives the word', () => {
    for (const { c, w } of words.filter((x) => x.c.kind === 'spelling')) {
      expect(w.gap, w.key).toMatch(/\([А-ЯЁ]+\)/);
      expect(writtenForm(w.gap, w.answer), w.key).toContain(w.word);
      expect(w.options, w.key).toContain(w.answer);
      // The other ways really are different spellings.
      for (const o of w.options.filter((x) => x !== w.answer))
        expect(writtenForm(w.gap, o), w.key).not.toBe(writtenForm(w.gap, w.answer));
      expect(c.kind).toBe('spelling');
    }
  });

  it('no word twice in a task; Cyrillic only; every word has its explanation', () => {
    for (const t of DICTIONARY_TASKS) {
      const keys = t.categories.flatMap((c) => c.words.map((w) => w.word));
      expect(new Set(keys).size, `№${t.taskNumber}`).toBe(keys.length);
    }
    for (const { w } of words) {
      expect(w.word, w.key).not.toMatch(/[a-z]|\s{2}/i);
      expect(w.explanation.length, w.key).toBeGreaterThan(10);
      if (w.memo) expect(w.memo.length, w.key).toBeGreaterThan(10);
    }
  });

  it('exceptions are marked and explained; every task with exceptions also has rule-following words', () => {
    for (const t of DICTIONARY_TASKS.filter((x) => [9, 10, 12, 15].includes(x.taskNumber))) {
      const all = t.categories.flatMap((c) => c.words);
      expect(
        all.some((w) => w.exception),
        `№${t.taskNumber}`,
      ).toBe(true);
      expect(
        all.some((w) => !w.exception),
        `№${t.taskNumber}`,
      ).toBe(true);
    }
  });

  it('hard words have memory aids', () => {
    const memos = words.filter((x) => x.w.memo).length;
    expect(memos).toBeGreaterThanOrEqual(35);
  });
});

describe('the five mechanics', () => {
  const items = allDictionaryItems();

  it('every question has its answer among unique options; keys never repeat', () => {
    expect(new Set(items.map((i) => i.key)).size).toBe(items.length);
    for (const it of items) {
      expect(it.options, it.key).toContain(it.correct);
      expect(new Set(it.options).size, it.key).toBe(it.options.length);
    }
  });

  it('all five mechanics are used', () => {
    expect(new Set(items.map((i) => i.mechanic))).toEqual(
      new Set(['gap', 'spelling', 'find-error', 'exception', 'group']),
    );
  });

  it('find-error: exactly one option is a misspelling of the word; the rest are real words', () => {
    for (const it of items.filter((i) => i.mechanic === 'find-error')) {
      const t = DICTIONARY_TASKS.find((x) => x.taskNumber === it.taskNumber)!;
      const cat = t.categories.find((c) => c.id === it.categoryId)!;
      const right = cat.words.map((w) =>
        cat.kind === 'letter' ? w.word : writtenForm(w.gap, w.answer),
      );
      const wrong = it.options.filter((o) => !right.includes(o));
      expect(wrong, it.key).toEqual([it.correct]);
    }
  });

  it('exception: one exception among words that follow the rule', () => {
    for (const it of items.filter((i) => i.mechanic === 'exception')) {
      expect(it.word.exception).toBe(true);
      const t = DICTIONARY_TASKS.find((x) => x.taskNumber === it.taskNumber)!;
      const regular = new Set(
        t.categories.flatMap((c) => c.words.filter((w) => !w.exception).map((w) => w.word)),
      );
      expect(
        it.options.filter((o) => o !== it.correct).every((o) => regular.has(o)),
        it.key,
      ).toBe(true);
    }
  });

  it('a category on its own builds only its questions', () => {
    const t9 = DICTIONARY_TASKS[0]!;
    const only = dictionaryItems(t9, 'tsy');
    expect(only.length).toBeGreaterThan(0);
    expect(only.every((i) => i.categoryId === 'tsy')).toBe(true);
  });
});
