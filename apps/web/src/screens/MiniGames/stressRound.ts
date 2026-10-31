import type { StressQuestion } from '@zybrilka/shared';

/**
 * The «Ударения» round as a pure state machine (tested on its own):
 * a queue of questions; a word answered wrong comes back once more a few
 * questions later, so the player meets it again before the round ends.
 * The round's score counts each word's FIRST answer only.
 */
export interface RoundState {
  readonly queue: readonly StressQuestion[];
  readonly position: number;
  /** wordId → first answer right? */
  readonly firstTry: ReadonlyMap<string, boolean>;
  /** Words already sent back once (never twice). */
  readonly requeued: ReadonlySet<string>;
}

/** How many questions later a missed word returns. */
export const REQUEUE_GAP = 3;

export function startRound(questions: readonly StressQuestion[]): RoundState {
  return { queue: questions, position: 0, firstTry: new Map(), requeued: new Set() };
}

export const currentQuestion = (s: RoundState): StressQuestion | null =>
  s.queue[s.position] ?? null;

export const isFinished = (s: RoundState): boolean => s.position >= s.queue.length;

/** Records an answer to the current question (the player may answer it
 * again with «Повторить слово» before moving on — only the first counts). */
export function recordAnswer(s: RoundState, correct: boolean): RoundState {
  const q = currentQuestion(s);
  if (!q) return s;
  const firstTry = new Map(s.firstTry);
  if (!firstTry.has(q.wordId)) firstTry.set(q.wordId, correct);
  let queue = s.queue;
  let requeued = s.requeued;
  if (!correct && !s.requeued.has(q.wordId)) {
    const at = Math.min(s.position + 1 + REQUEUE_GAP, queue.length);
    queue = [...queue.slice(0, at), q, ...queue.slice(at)];
    requeued = new Set(s.requeued).add(q.wordId);
  }
  return { ...s, queue, firstTry, requeued };
}

export const next = (s: RoundState): RoundState => ({ ...s, position: s.position + 1 });

export function roundScore(s: RoundState): { correct: number; total: number; missed: string[] } {
  const entries = [...s.firstTry.entries()];
  return {
    correct: entries.filter(([, ok]) => ok).length,
    total: entries.length,
    missed: entries.filter(([, ok]) => !ok).map(([id]) => id),
  };
}
