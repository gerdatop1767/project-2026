/**
 * Skill mastery, v2 (docs/learning/ALGORITHMS.md § 1). Deterministic, no
 * AI/ML: a pure function over the user's real attempts on the tasks of one
 * skill. Callers (`apps/api/src/modules/learning/{repo,service}.ts`) load
 * the full history; the incremental update after an answer and a full
 * rebuild run this same function on the same history, so they always agree.
 *
 * mastery (0..100) — a Bayesian estimate of «answers this skill correctly»:
 *
 *   p = (PRIOR_CORRECT + Σ wᵢ·dᵢ·correctᵢ) / (PRIOR_TOTAL + Σ wᵢ·dᵢ)
 *
 *   - prior 2 correct of 4 (50%): one answer moves the estimate, it never
 *     jumps to 100 or drops to 0 (1 correct → 60, 1 wrong → 40);
 *   - wᵢ = RECENCY_DECAY^k · ½^(Δdays/HALF_LIFE_DAYS): k = how many attempts
 *     came after this one, Δdays = its age relative to the latest attempt.
 *     Recent answers weigh most, so «wrong, then right» counts as progress
 *     and a month-old streak no longer props up today's level;
 *   - dᵢ — task difficulty: a correct answer on a hard task is stronger
 *     evidence (×1.25) than on an easy one (×0.8), a wrong answer on an easy
 *     task weighs more (×1.25) than on a hard one (×0.8).
 *
 * confidence (0..100) — how much evidence backs the number, not how good the
 * student is: effective sample size Σwᵢ / FULL_CONFIDENCE_WEIGHT. Below
 * MIN_ATTEMPTS_FOR_LEVEL attempts the level is `low_data` and the UI never
 * shows a precise verdict.
 *
 * The age reference is the latest attempt itself, not the wall clock, so the
 * stored value only changes when a new attempt arrives (the rebuild gives
 * the same row). «Давно не практиковал» is a separate signal built from
 * `lastAttemptAt` by the recommendations.
 */

const PRIOR_CORRECT = 2;
const PRIOR_TOTAL = 4;
const RECENCY_DECAY = 0.85;
const HALF_LIFE_DAYS = 60;
const FULL_CONFIDENCE_WEIGHT = 5;
export const MIN_ATTEMPTS_FOR_LEVEL = 3;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface SkillAttemptRecord {
  readonly isCorrect: boolean;
  readonly createdAt: Date;
  /** The task the attempt was on — for repeated-error and recovery counts. */
  readonly taskId?: string;
  /** Authored difficulty 1..3 of that task (missing = 2, medium). */
  readonly difficulty?: number | null;
}

export type SkillTrend = 'up' | 'down' | 'flat';

export interface SkillMasteryResult {
  readonly attempts: number;
  readonly correctAttempts: number;
  readonly incorrectAttempts: number;
  /** 0..100. */
  readonly mastery: number;
  /** 0..100. */
  readonly confidence: number;
  readonly lastAttemptAt: Date | null;
  /** Tasks of this skill answered wrong two or more times. */
  readonly repeatedErrorTasks: number;
  /** Tasks answered wrong and later answered right. */
  readonly recoveredTasks: number;
  /** Last 5 attempts vs the 5 before them; null without 3+ in each half. */
  readonly trend: SkillTrend | null;
}

export type SkillLevel = 'none' | 'low_data' | 'weak' | 'developing' | 'strong';

/** A label for the UI and the recommendations — never precise on thin data. */
export function skillLevel(result: Pick<SkillMasteryResult, 'attempts' | 'mastery'>): SkillLevel {
  if (result.attempts === 0) return 'none';
  if (result.attempts < MIN_ATTEMPTS_FOR_LEVEL) return 'low_data';
  if (result.mastery >= 75) return 'strong';
  if (result.mastery >= 55) return 'developing';
  return 'weak';
}

function difficultyFactor(difficulty: number | null | undefined, isCorrect: boolean): number {
  const d = difficulty ?? 2;
  if (d <= 1) return isCorrect ? 0.8 : 1.25;
  if (d >= 3) return isCorrect ? 1.25 : 0.8;
  return 1;
}

function trendOf(sorted: readonly SkillAttemptRecord[]): SkillTrend | null {
  const recent = sorted.slice(-5);
  const before = sorted.slice(-10, -5);
  if (recent.length < 3 || before.length < 3) return null;
  const acc = (xs: readonly SkillAttemptRecord[]) =>
    xs.filter((a) => a.isCorrect).length / xs.length;
  const diff = acc(recent) - acc(before);
  if (diff >= 0.2) return 'up';
  if (diff <= -0.2) return 'down';
  return 'flat';
}

/**
 * `attemptRecords`: every attempt on every task of one skill, for one user,
 * in any order (sorted here).
 */
export function calculateSkillMastery(
  attemptRecords: readonly SkillAttemptRecord[],
): SkillMasteryResult {
  const attempts = attemptRecords.length;
  if (attempts === 0) {
    return {
      attempts: 0,
      correctAttempts: 0,
      incorrectAttempts: 0,
      mastery: 0,
      confidence: 0,
      lastAttemptAt: null,
      repeatedErrorTasks: 0,
      recoveredTasks: 0,
      trend: null,
    };
  }

  const sorted = [...attemptRecords].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const latest = sorted[sorted.length - 1]!.createdAt.getTime();

  let weightedCorrect = 0;
  let weightedTotal = 0;
  let effectiveN = 0;
  sorted.forEach((a, i) => {
    const after = sorted.length - 1 - i;
    const ageDays = (latest - a.createdAt.getTime()) / MS_PER_DAY;
    const w = RECENCY_DECAY ** after * 0.5 ** (ageDays / HALF_LIFE_DAYS);
    const wd = w * difficultyFactor(a.difficulty, a.isCorrect);
    effectiveN += w;
    weightedTotal += wd;
    if (a.isCorrect) weightedCorrect += wd;
  });

  const p = (PRIOR_CORRECT + weightedCorrect) / (PRIOR_TOTAL + weightedTotal);

  const wrongByTask = new Map<string, number>();
  const recovered = new Set<string>();
  for (const a of sorted) {
    if (!a.taskId) continue;
    const wrong = wrongByTask.get(a.taskId) ?? 0;
    if (!a.isCorrect) wrongByTask.set(a.taskId, wrong + 1);
    else if (wrong > 0) recovered.add(a.taskId);
  }

  const correctAttempts = sorted.filter((a) => a.isCorrect).length;
  return {
    attempts,
    correctAttempts,
    incorrectAttempts: attempts - correctAttempts,
    mastery: Math.round(Math.min(1, Math.max(0, p)) * 100),
    confidence: Math.round(Math.min(1, effectiveN / FULL_CONFIDENCE_WEIGHT) * 100),
    lastAttemptAt: sorted[sorted.length - 1]!.createdAt,
    repeatedErrorTasks: [...wrongByTask.values()].filter((n) => n >= 2).length,
    recoveredTasks: recovered.size,
    trend: trendOf(sorted),
  };
}
