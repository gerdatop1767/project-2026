import type { DictionaryQuestion } from '@zybrilka/shared';

/**
 * A «Словарные слова» round as a pure state machine (tested on its own),
 * the same rules as «Ударения»: a question answered wrong comes back once
 * a few questions later; the score counts each question's FIRST answer.
 */
export interface DictRoundState {
  readonly queue: readonly DictionaryQuestion[];
  readonly position: number;
  readonly firstTry: ReadonlyMap<string, boolean>;
  readonly requeued: ReadonlySet<string>;
}

export const DICT_REQUEUE_GAP = 3;

export const startDictRound = (questions: readonly DictionaryQuestion[]): DictRoundState => ({
  queue: questions,
  position: 0,
  firstTry: new Map(),
  requeued: new Set(),
});

/** A saved round, continued from the first question not answered yet. */
export function resumeDictRound(
  questions: readonly DictionaryQuestion[],
  answered: readonly { readonly itemId: string; readonly firstCorrect: boolean }[],
): DictRoundState {
  const firstTry = new Map(answered.map((a) => [a.itemId, a.firstCorrect]));
  const done = questions.filter((q) => firstTry.has(q.itemId));
  const rest = questions.filter((q) => !firstTry.has(q.itemId));
  return {
    queue: [...done, ...rest],
    position: done.length,
    firstTry,
    requeued: new Set(firstTry.keys()),
  };
}

export const dictCurrent = (s: DictRoundState): DictionaryQuestion | null =>
  s.queue[s.position] ?? null;

export function dictRecord(s: DictRoundState, correct: boolean): DictRoundState {
  const q = dictCurrent(s);
  if (!q) return s;
  const firstTry = new Map(s.firstTry);
  if (!firstTry.has(q.itemId)) firstTry.set(q.itemId, correct);
  let { queue, requeued } = s;
  if (!correct && !requeued.has(q.itemId)) {
    const at = Math.min(s.position + 1 + DICT_REQUEUE_GAP, queue.length);
    queue = [...queue.slice(0, at), q, ...queue.slice(at)];
    requeued = new Set(requeued).add(q.itemId);
  }
  return { ...s, queue, firstTry, requeued };
}

export const dictNext = (s: DictRoundState): DictRoundState => ({ ...s, position: s.position + 1 });

export function dictScore(s: DictRoundState) {
  const entries = [...s.firstTry.entries()];
  return {
    correct: entries.filter(([, ok]) => ok).length,
    total: entries.length,
    missed: entries.filter(([, ok]) => !ok).map(([id]) => id),
  };
}

/** «Справочник» search: case- and «ё»-insensitive, by word or explanation. */
export const normalizeSearch = (s: string): string =>
  s
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[\s-]+/g, ' ')
    .trim();

export function matchesSearch(query: string, ...fields: readonly string[]): boolean {
  const q = normalizeSearch(query);
  return q === '' || fields.some((f) => normalizeSearch(f).includes(q));
}
