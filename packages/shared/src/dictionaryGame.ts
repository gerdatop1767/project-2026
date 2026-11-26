import { z } from 'zod';
import {
  DICTIONARY_TASKS,
  dictionaryTask,
  type DictCategory,
  type DictTask,
  type DictWord,
} from './dictionaryWords.js';

/**
 * «Словарные слова и исключения» — one game, a task number chosen inside
 * it. Its questions are built from the word lists (dictionaryWords.ts) in
 * five ways, so it never turns into one long multiple-choice test:
 * - `gap`: put the missing letter (or «слитно / раздельно / через дефис»);
 * - `spelling`: pick the right spelling among the word's possible ones;
 * - `find-error`: four words, one misspelt — find it;
 * - `exception`: four words, one is an exception to the rule — find it;
 * - `group`: which group (category) of the task the word belongs to.
 * The answer is checked on the server; the question carries no key.
 */
export const DICTIONARY_GAME_ID = 'dictionary';
export const dictionaryMechanics = ['gap', 'spelling', 'find-error', 'exception', 'group'] as const;
export type DictionaryMechanic = (typeof dictionaryMechanics)[number];

export interface DictionaryItem {
  /** Stable: `${word.key}#${mechanic}`. */
  readonly key: string;
  readonly mechanic: DictionaryMechanic;
  readonly taskNumber: number;
  readonly categoryId: string;
  readonly prompt: string;
  /** What is shown: the gap («р▢сток»), or the word for `group`. */
  readonly text: string;
  readonly options: readonly string[];
  readonly correct: string;
  /** The word the question is about. */
  readonly word: DictWord;
}

/** The written form of a «(НЕ)ВЕЖДА»-gap for one way of writing it. */
export function writtenForm(gap: string, how: string): string {
  return gap.replace(/([А-ЯЁ]*)\(([А-ЯЁ]+)\)([А-ЯЁ]*)/, (_m, a: string, b: string, c: string) => {
    const parts = [a, b, c].filter(Boolean).map((p) => p.toLowerCase());
    const sep = how === 'слитно' ? '' : how === 'раздельно' ? ' ' : '-';
    return parts.join(sep);
  });
}

/** The word misspelt with the other letter (letters), or written the other way. */
function wrongForms(cat: DictCategory, w: DictWord): string[] {
  if (cat.kind === 'letter') {
    return w.options.filter((o) => o !== w.answer).map((o) => w.gap.replace('..', o));
  }
  return w.options.filter((o) => o !== w.answer).map((o) => writtenForm(w.gap, o));
}

/** The word written right — in the same form (context included) as the wrong ones. */
function rightForm(cat: DictCategory, w: DictWord): string {
  return cat.kind === 'letter' ? w.gap.replace('..', w.answer) : writtenForm(w.gap, w.answer);
}

/** A stable pseudo-random order (the same items every build). */
function hashOf(s: string): number {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.codePointAt(0)!, 16777619) >>> 0;
  return h;
}
const stableShuffle = <T>(xs: readonly T[], seed: string, key: (x: T) => string) =>
  [...xs].sort((a, b) => hashOf(seed + key(a)) - hashOf(seed + key(b)));

const showGap = (gap: string) => gap.replace('..', '▢');

/** Every question of a task (one category or all), in a stable order. */
export function dictionaryItems(task: DictTask, categoryId?: string): DictionaryItem[] {
  const items: DictionaryItem[] = [];
  const categories = task.categories.filter((c) => !categoryId || c.id === categoryId);
  const allWords = task.categories.flatMap((c) => c.words.map((w) => ({ c, w })));
  const regulars = allWords.filter((x) => !x.w.exception);
  const titles = task.categories.map((c) => c.title);

  for (const cat of categories) {
    for (const w of cat.words) {
      const base = { taskNumber: task.taskNumber, categoryId: cat.id, word: w };
      // 1. The gap.
      items.push({
        ...base,
        key: `${w.key}#gap`,
        mechanic: 'gap',
        prompt: cat.kind === 'letter' ? 'Какая буква пропущена?' : 'Как пишется выделенное?',
        text: cat.kind === 'letter' ? showGap(w.gap) : w.gap,
        options: w.options,
        correct: w.answer,
      });
      // 2. The right spelling among its forms.
      const right = rightForm(cat, w);
      const wrong = wrongForms(cat, w);
      if (wrong.length > 0 && wrong.every((x) => x !== right)) {
        items.push({
          ...base,
          key: `${w.key}#spelling`,
          mechanic: 'spelling',
          prompt: 'Как пишется правильно?',
          text: '',
          options: stableShuffle([right, ...wrong], w.key, (x) => x),
          correct: right,
        });
      }
      // 3. Find the misspelt one among three right words of the category.
      const others = stableShuffle(
        cat.words.filter((o) => o.key !== w.key),
        `${w.key}#err`,
        (o) => o.key,
      ).slice(0, 3);
      if (others.length === 3 && wrong[0] !== undefined) {
        items.push({
          ...base,
          key: `${w.key}#find-error`,
          mechanic: 'find-error',
          prompt: 'В каком слове ошибка?',
          text: '',
          options: stableShuffle(
            [wrong[0], ...others.map((o) => rightForm(cat, o))],
            `${w.key}#err-order`,
            (x) => x,
          ),
          correct: wrong[0],
        });
      }
      // 4. The exception among words that follow the rule (letter tasks).
      if (w.exception && cat.kind === 'letter') {
        const sameCat = regulars.filter((r) => r.c.id === cat.id);
        const pool = sameCat.length >= 3 ? sameCat : regulars.filter((r) => r.c.kind === 'letter');
        const fillers = stableShuffle(pool, `${w.key}#exc`, (r) => r.w.key).slice(0, 3);
        if (fillers.length === 3) {
          items.push({
            ...base,
            key: `${w.key}#exception`,
            mechanic: 'exception',
            prompt: 'Какое слово — исключение из правила?',
            text: '',
            options: stableShuffle(
              [right, ...fillers.map((r) => rightForm(r.c, r.w))],
              `${w.key}#exc-order`,
              (x) => x,
            ),
            correct: right,
          });
        }
      }
      // 5. The group the word belongs to.
      if (titles.length >= 2) {
        items.push({
          ...base,
          key: `${w.key}#group`,
          mechanic: 'group',
          prompt: 'К какой группе относится слово?',
          text: right,
          options: titles,
          correct: cat.title,
        });
      }
    }
  }
  return items;
}

/** Every question of the game, all tasks. */
export const allDictionaryItems = (): DictionaryItem[] =>
  DICTIONARY_TASKS.flatMap((t) => dictionaryItems(t));

export const dictionaryRoundQuerySchema = z.object({
  task: z.coerce.number().int(),
  category: z.string().max(40).optional(),
  mode: z.enum(['all', 'mistakes']).default('all'),
  size: z.coerce.number().int().min(3).max(500).default(15),
});
export type DictionaryRoundQuery = z.infer<typeof dictionaryRoundQuerySchema>;

/** A question as the player gets it — no key. */
export interface DictionaryQuestion {
  readonly itemId: string;
  readonly mechanic: DictionaryMechanic;
  readonly prompt: string;
  readonly text: string;
  readonly options: readonly string[];
}

export interface DictionaryRoundResponse {
  readonly task: number;
  readonly category: string | null;
  readonly mode: 'all' | 'mistakes';
  readonly questions: readonly DictionaryQuestion[];
  readonly bankSize: number;
  readonly sessionId: string | null;
}

export const dictionaryAnswerSchema = z.object({
  itemId: z.uuid(),
  answer: z.string().min(1).max(200),
  clientAnswerId: z.uuid(),
  sessionId: z.uuid().optional(),
});
export type DictionaryAnswerRequest = z.infer<typeof dictionaryAnswerSchema>;

export interface DictionaryAnswerResponse {
  readonly correct: boolean;
  readonly correctOption: string;
  /** The word, written right. */
  readonly word: string;
  readonly explanation: string;
  readonly memo: string | null;
  readonly recorded: boolean;
}

export interface DictionaryTaskSummary {
  readonly taskNumber: number;
  readonly title: string;
  readonly description: string;
  readonly categories: readonly { id: string; title: string; words: number; questions: number }[];
  readonly words: number;
  /** Questions the task has (a word is asked in several ways). */
  readonly questions: number;
  /** Signed in: words learned (two right in a row) and the best round. */
  readonly learned: number | null;
  readonly bestScore: number | null;
}

export interface DictionarySummaryResponse {
  readonly tasks: readonly DictionaryTaskSummary[];
}

/** «Справочник»: a task's words as the lists give them, by group. */
export interface DictionaryReferenceWord {
  readonly word: string;
  readonly exception: boolean;
  readonly explanation: string;
  readonly memo: string | null;
}
export interface DictionaryReferenceResponse {
  readonly taskNumber: number;
  readonly title: string;
  readonly categories: readonly {
    readonly id: string;
    readonly title: string;
    readonly rule: string;
    readonly words: readonly DictionaryReferenceWord[];
  }[];
}

/** The reference of one task — the word written right, in its context. */
export function dictionaryReference(task: DictTask): DictionaryReferenceResponse {
  return {
    taskNumber: task.taskNumber,
    title: task.title,
    categories: task.categories.map((c) => ({
      id: c.id,
      title: c.title,
      rule: c.rule,
      words: c.words.map((w) => ({
        word: c.kind === 'letter' ? w.word : writtenForm(w.gap, w.answer),
        exception: w.exception,
        explanation: w.explanation,
        memo: w.memo ?? null,
      })),
    })),
  };
}

export { DICTIONARY_TASKS, dictionaryTask };
