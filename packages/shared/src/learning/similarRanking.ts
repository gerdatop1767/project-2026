import type { TaskFeatures } from './taskFeatures.js';

/**
 * «Решать похожие» v2 (docs/learning/SIMILAR-TASKS.md): a pure,
 * deterministic ranking. The candidate pool (built by the API) holds only
 * tasks that test the same EGE skill as the target — another number that
 * checks something else never gets in, and nothing is added just to fill
 * the list. Inside the pool, candidates are ranked in widening tiers:
 *   exact — the same subtype (same thing asked / same rule);
 *   close — a shared primary feature, the same importer subtopic or a
 *           shared solution method;
 *   topic — the same EGE topic only.
 * Within a tier: feature overlap, method overlap, subtopic, difficulty
 * closeness, answer format — plus the student's own history: subtypes they
 * got wrong go first, tasks already solved go last (and only when there are
 * not enough unsolved ones), tasks just answered are not shown again.
 */
export type SimilarMatch = 'exact' | 'close' | 'topic';

export interface SimilarCandidate {
  readonly taskId: string;
  readonly taskNumber: number;
  readonly features: TaskFeatures;
  /** Canonical importer subtopic (`canonicalSubtopic`). */
  readonly subtopic: string | null;
  /** Solution-method skills (`task_skills` without an exam topic), e.g. «interval-method». */
  readonly methodSkills: readonly string[];
  /** 0..100 (`getComparableDifficulty`). */
  readonly difficulty: number;
  readonly answerType: string;
}

export interface StudentContext {
  /** Tasks the student answered correctly at least once. */
  readonly solved: ReadonlySet<string>;
  /** Tasks answered in the last few minutes, or just shown — never repeated. */
  readonly recent: ReadonlySet<string>;
  /** Subtypes of the student's wrong answers in this skill, most recent first. */
  readonly mistakeSubtypes: ReadonlySet<string>;
  /** The student answered the target itself wrong. */
  readonly failedTarget: boolean;
}

export interface RankedSimilar {
  readonly taskId: string;
  readonly taskNumber: number;
  /** 0..100 within-pool closeness (not a probability). */
  readonly score: number;
  readonly match: SimilarMatch;
}

const TIER_ORDER: Readonly<Record<SimilarMatch, number>> = { exact: 0, close: 1, topic: 2 };

function jaccard(a: readonly string[], b: readonly string[]): number | null {
  if (a.length === 0 && b.length === 0) return null;
  const setB = new Set(b);
  const inter = a.filter((x) => setB.has(x)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : inter / union;
}

export function matchOf(target: SimilarCandidate, c: SimilarCandidate): SimilarMatch {
  if (target.features.subtype !== null && target.features.subtype === c.features.subtype) {
    return 'exact';
  }
  const sharedPrimary = c.features.primary.some((f) => target.features.primary.includes(f));
  const sharedMethod = c.methodSkills.some((m) => target.methodSkills.includes(m));
  const sameSubtopic = target.subtopic !== null && target.subtopic === c.subtopic;
  return sharedPrimary || sharedMethod || sameSubtopic ? 'close' : 'topic';
}

/** 0..100: how alike two tasks of the same pool are. */
export function closeness(target: SimilarCandidate, c: SimilarCandidate): number {
  const parts: { w: number; v: number }[] = [];
  const prim = jaccard(target.features.primary, c.features.primary);
  if (prim !== null) parts.push({ w: 35, v: prim });
  const sec = jaccard(target.features.secondary, c.features.secondary);
  if (sec !== null) parts.push({ w: 20, v: sec });
  const meth = jaccard(target.methodSkills, c.methodSkills);
  if (meth !== null) parts.push({ w: 15, v: meth });
  if (target.subtopic !== null && c.subtopic !== null) {
    parts.push({ w: 10, v: target.subtopic === c.subtopic ? 1 : 0 });
  }
  parts.push({ w: 10, v: 1 - Math.min(1, Math.abs(target.difficulty - c.difficulty) / 100) });
  parts.push({ w: 10, v: target.answerType === c.answerType ? 1 : 0 });
  const total = parts.reduce((sum, x) => sum + x.w, 0);
  return Math.round((parts.reduce((sum, x) => sum + x.w * x.v, 0) / total) * 100);
}

export function rankSimilarTasks(
  target: SimilarCandidate,
  pool: readonly SimilarCandidate[],
  student: StudentContext,
  limit: number,
): RankedSimilar[] {
  const scored = pool
    .filter((c) => c.taskId !== target.taskId && !student.recent.has(c.taskId))
    .map((c) => {
      const match = matchOf(target, c);
      let score = closeness(target, c);
      // The student's own weak spot inside this skill goes first.
      if (c.features.subtype !== null && student.mistakeSubtypes.has(c.features.subtype)) {
        score += 8;
      }
      // After a wrong answer, not something harder than what just failed.
      if (student.failedTarget && c.difficulty > target.difficulty + 10) score -= 6;
      return {
        taskId: c.taskId,
        taskNumber: c.taskNumber,
        match,
        score: Math.max(0, Math.min(100, score)),
        solved: student.solved.has(c.taskId),
      };
    })
    .sort(
      (a, b) =>
        TIER_ORDER[a.match] - TIER_ORDER[b.match] ||
        b.score - a.score ||
        a.taskId.localeCompare(b.taskId),
    );

  // Unsolved first, keeping the tier order; solved ones only to complete
  // the list when the skill has no more unsolved tasks.
  const unsolved = scored.filter((x) => !x.solved);
  const solved = scored.filter((x) => x.solved);
  return [...unsolved, ...solved]
    .slice(0, limit)
    .map(({ taskId, taskNumber, score, match }) => ({ taskId, taskNumber, score, match }));
}
