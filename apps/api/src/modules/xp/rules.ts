import type { XpEventKind } from '@zybrilka/shared';

/**
 * XP rules (docs/XP.md) — the ONLY place award amounts are decided. Every
 * award is computed here on the server from data the server itself read
 * (the task row, the graded attempt, earlier awards); nothing the client
 * sends can change an amount.
 *
 * Bump `XP_RULES_VERSION` when the numbers change: it is stored with each
 * award, so old awards stay explainable (they are never recomputed).
 */
export const XP_RULES_VERSION = 1;

/**
 * Base XP for a correct answer, by the task's `difficulty` column
 * (1 = лёгкое, 2 = среднее, 3 = сложное; 4 is reserved for «очень
 * сложное» — no task uses it yet).
 *
 * Today's imported tasks get their difficulty from the exam's own part
 * split at import time (Part 1 → 2, Part 2 → 3; see the import scripts),
 * not from a per-task judgement. Re-rating a task in the database changes
 * the XP of FUTURE awards for it automatically — nothing else to edit.
 */
export const XP_BY_DIFFICULTY: Readonly<Record<number, number>> = {
  1: 10,
  2: 15,
  3: 25,
  4: 35,
};

/** Used when a task's difficulty is outside the table above. Shown as
 * `difficultyKnown: false` in the award's metadata, never guessed. */
export const DEFAULT_TASK_XP = 15;

/**
 * Per-subject multiplier. All 1: no subject is worth more or less because
 * of its name — difficulty already carries the effort. A subject may get
 * a different value only with a written reason next to it.
 */
export const SUBJECT_MULTIPLIER: Readonly<Record<string, number>> = {
  math: 1,
  russian: 1,
  social: 1,
  english: 1,
  physics: 1,
  chemistry: 1,
  biology: 1,
  informatics: 1,
  history: 1,
};

/**
 * Optional exact amount for one (subject, task number), for a number whose
 * real weight the difficulty column can't express. Empty on purpose: add
 * an entry only with a reason. Overrides `XP_BY_DIFFICULTY`, not the
 * subject multiplier.
 */
export const TASK_NUMBER_XP: Readonly<Record<string, Readonly<Record<number, number>>>> = {};

/**
 * Review: answering a task correctly again after it has already earned XP
 * gives a share of its value — but only when at least `minDaysSinceLastAward`
 * days passed since that task last earned anything, so re-submitting the
 * same answer over and over earns nothing, while coming back to old
 * material later (spaced repetition) is still rewarded a little.
 */
export const REVIEW_RULE = {
  share: 0.3,
  minXp: 3,
  minDaysSinceLastAward: 7,
} as const;

export interface TaskForXp {
  id: string;
  subjectId: string;
  taskNumber: number;
  difficulty: number;
}

export interface TaskXpValue {
  amount: number;
  difficultyKnown: boolean;
}

/** Full XP a first correct solve of `task` is worth. */
export function taskXpValue(task: TaskForXp): TaskXpValue {
  const exact = TASK_NUMBER_XP[task.subjectId]?.[task.taskNumber];
  const byDifficulty = XP_BY_DIFFICULTY[task.difficulty];
  const base = exact ?? byDifficulty ?? DEFAULT_TASK_XP;
  const multiplier = SUBJECT_MULTIPLIER[task.subjectId] ?? 1;
  return {
    amount: Math.max(1, Math.round(base * multiplier)),
    difficultyKnown: exact !== undefined || byDifficulty !== undefined,
  };
}

export function reviewXpValue(task: TaskForXp): number {
  const full = taskXpValue(task).amount;
  return Math.max(REVIEW_RULE.minXp, Math.round(full * REVIEW_RULE.share));
}

export interface XpDecision {
  kind: XpEventKind;
  amount: number;
  dedupKey: string;
  metadata: Record<string, unknown>;
}

/**
 * What a graded answer earns. `lastAwardAt` is when this task last earned
 * this user any XP (null if never). Wrong answers, and essays (never
 * auto-graded), earn nothing; a multi-part task counts as correct only
 * when every part is.
 */
export function decideTaskXp(input: {
  task: TaskForXp;
  correct: boolean;
  lastAwardAt: Date | null;
  now: Date;
  /** The Moscow calendar date of `now` (YYYY-MM-DD), for the review key. */
  moscowDate: string;
}): XpDecision | null {
  if (!input.correct) return null;
  const { task } = input;
  const value = taskXpValue(task);
  const metadata = {
    rulesVersion: XP_RULES_VERSION,
    subjectId: task.subjectId,
    taskNumber: task.taskNumber,
    difficulty: task.difficulty,
    difficultyKnown: value.difficultyKnown,
  };
  if (input.lastAwardAt === null) {
    return {
      kind: 'task_first_solve',
      amount: value.amount,
      dedupKey: `task:${task.id}:first`,
      metadata,
    };
  }
  const days = (input.now.getTime() - input.lastAwardAt.getTime()) / 86_400_000;
  if (days < REVIEW_RULE.minDaysSinceLastAward) return null;
  return {
    kind: 'task_review',
    amount: reviewXpValue(task),
    dedupKey: `task:${task.id}:review:${input.moscowDate}`,
    metadata,
  };
}
