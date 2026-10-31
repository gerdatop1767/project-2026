import type { VariantScore } from '../examScoring.js';
import type { TaskPublic } from '../tasks.js';
import type { RecommendationBreakdown } from './recommendation.js';

/**
 * ZUBRILKA LEARNING INTELLIGENCE, Phase 9 — session lifecycle DTOs.
 * A session is pure bookkeeping (which tasks it already served) over
 * the existing deterministic Phase 7/8 engines and the existing
 * attempt-submission flow — never a second source of truth for
 * attempts, mastery, errors, or task statistics (see
 * `apps/api/.../learningSession/service.ts`).
 */
export const learningSessionStatuses = ['active', 'completed'] as const;
export type LearningSessionStatus = (typeof learningSessionStatuses)[number];

export interface LearningSessionRecommendationInfo {
  /** 0..100 — see `combineRecommendationSignals`. Freshly computed for
   * THIS step against the CURRENT database state, never cached from an
   * earlier step. */
  readonly score: number;
  readonly reason: string;
  readonly breakdown: RecommendationBreakdown;
}

/** Present only on a VARIANT session (Training's "Вариант" mode) —
 * absent for every Smart Training session. Lets the generic
 * `LearningSession` completion/active screen show "Вариант N" instead
 * of the Smart Training heading, without a second completion system. */
export interface LearningSessionVariantInfo {
  readonly variantId: string;
  readonly variantNumber: number;
  readonly variantTitle: string;
}

/** `POST /me/learning/sessions`, `GET /me/learning/sessions/:id/next`,
 * and `GET /me/learning/sessions/:id` response while the session still
 * has steps left to serve. */
export interface LearningSessionActiveResponse {
  readonly sessionId: string;
  readonly subject: string;
  readonly status: 'active';
  /** 1-based — how many tasks this session has served so far, including `task`. */
  readonly position: number;
  /** The originally requested session length — fixed for the session's lifetime. */
  readonly total: number;
  readonly task: TaskPublic;
  /** Present for `start`/`next` on a Smart Training session (a fresh
   * scoring just ran). Absent for a plain `GET .../:id` snapshot read,
   * AND absent for every variant-session step (its task order is the
   * real exam's own, never scored) — never fabricating or re-deriving
   * a stale one. */
  readonly recommendation?: LearningSessionRecommendationInfo;
  readonly variant?: LearningSessionVariantInfo;
}

/**
 * Derived ENTIRELY from real `attempts`/`mistakes`/`task_skills` rows
 * created during this session's time window — never a second,
 * invented statistic. See `computeSessionSummary` for the exact
 * queries each field comes from.
 */
export interface LearningSessionSummary {
  /** Distinct consumed tasks with at least one real attempt during the session. */
  readonly attempted: number;
  /** Of those, how many were eventually answered correctly (any attempt isCorrect). */
  readonly correct: number;
  /** Attempted but never answered correctly during the session. */
  readonly incorrect: number;
  /** 0..100, or `null` when `attempted` is 0 — never a fabricated 0. */
  readonly accuracy: number | null;
  /** Distinct real `task_skills` skill ids across the ATTEMPTED consumed tasks. */
  readonly skillsPracticed: number;
  /** Real `mistakes` rows whose `createdAt` falls within this session's window. */
  readonly mistakesCreated: number;
}

/** Response once the session has reached its requested length or run
 * out of valid candidates — same shape either way, since both are a
 * legitimate, honest end state (see Phase 9's "no-candidate completion" rule). */
export interface LearningSessionCompletedResponse {
  readonly sessionId: string;
  readonly subject: string;
  readonly status: 'completed';
  readonly position: number;
  readonly total: number;
  readonly summary: LearningSessionSummary;
  readonly variant?: LearningSessionVariantInfo;
}

/** `null` means no session could be started (no resolvable subject, or
 * the resolved subject has no published tasks at all) — same cold-start
 * honesty as Phase 7/8. */
export type LearningSessionResponse =
  LearningSessionActiveResponse | LearningSessionCompletedResponse | null;

/**
 * Statistics' "Статистика вариантов" — every variant session this user
 * has ever started (ANY status — an abandoned/still-active one shows
 * its real partial progress too, never hidden and never faked as
 * finished; see `getVariantProgress`), newest first.
 */
export interface VariantProgressItem {
  readonly sessionId: string;
  readonly variantId: string;
  readonly variantNumber: number;
  readonly variantTitle: string;
  readonly subjectId: string;
  readonly status: LearningSessionStatus;
  readonly startedAt: string;
  readonly completedAt: string | null;
  /** The variant's real total task count — fixed for the session's lifetime. */
  readonly plannedCount: number;
  /** Distinct consumed tasks with at least one real attempt — same
   * "unique solved, not raw attempts" convention as every other real
   * progress figure in the app. */
  readonly solvedCount: number;
  readonly correctCount: number;
  readonly incorrectCount: number;
  /** 0..100, or `null` when `solvedCount` is 0. */
  readonly accuracyPercent: number | null;
  /** Sum of `timeSpentMs` across timed attempts only — `null` when none
   * of this session's attempts recorded a time. */
  readonly totalTimeMs: number | null;
  /** The same deterministic error-signature codes `GET /me/learning/errors`
   * and the task-number detail view use — never an invented error type. */
  readonly keyErrors: readonly { signature: string; count: number }[];
}

export interface VariantProgressResponse {
  readonly items: readonly VariantProgressItem[];
}

/** How one planned task of a variant attempt ended up. */
export type VariantTaskOutcome = 'correct' | 'incorrect' | 'skipped' | 'not_reached';

/**
 * One task of a variant attempt, in exam order. The attempt's FIRST
 * answer to it decides `outcome` (an exam has no second try); later
 * re-tries are only counted in `answers`.
 */
export interface VariantAttemptTask {
  readonly position: number;
  readonly taskId: string;
  readonly taskNumber: number;
  readonly topic: string | null;
  /** `skipped`: served but never answered; `not_reached`: never served. */
  readonly outcome: VariantTaskOutcome;
  /** The first answer as the user gave it (multi-part: «а) 3; б) 5»). */
  readonly userAnswer: string | null;
  readonly correctAnswer: string;
  readonly explanationMd: string;
  /** All answers given to this task in this attempt. */
  readonly answers: number;
  /** Time of the first answer, only when the client measured it. */
  readonly timeSpentMs: number | null;
}

export interface VariantAttemptGroup {
  /** Task number (as a string) or topic name. */
  readonly key: string;
  readonly correct: number;
  /** Planned tasks in the group. */
  readonly total: number;
}

/**
 * Primary points of a variant attempt (see `examScoring.ts`): its first
 * answers scored by the rules copied into the attempt when it started.
 */
export interface VariantAttemptScoring extends VariantScore {
  /** The attempt is not finished: the result can still change. */
  readonly preliminary: boolean;
  /**
   * `snapshot`: the rules saved with the attempt. `current`: an attempt
   * started before scoring existed, scored by today's rules of its exam
   * format (said so on screen).
   */
  readonly rulesSource: 'snapshot' | 'current';
}

/**
 * GET /progress/variants/:sessionId — one attempt of one variant, only
 * for its owner. Only what is actually recorded is reported.
 */
export interface VariantAttemptDetail {
  readonly sessionId: string;
  readonly variantId: string;
  readonly variantNumber: number;
  readonly variantTitle: string;
  readonly subjectId: string;
  readonly status: LearningSessionStatus;
  readonly startedAt: string;
  readonly completedAt: string | null;
  /**
   * `exact`: answers are linked to this attempt (since migration 0033).
   * `time_window`: an older attempt — answers to its tasks between its
   * start and finish, which another context may have shared.
   */
  readonly attribution: 'exact' | 'time_window';
  readonly plannedCount: number;
  readonly correctCount: number;
  readonly incorrectCount: number;
  readonly skippedCount: number;
  readonly notReachedCount: number;
  /** correct / answered, 0..100; null with no answers. */
  readonly accuracyPercent: number | null;
  /** Sum over answered tasks whose time was measured; null if none was. */
  readonly totalTimeMs: number | null;
  /** How many answered tasks the time covers. */
  readonly timedCount: number;
  readonly byTaskNumber: readonly VariantAttemptGroup[];
  /** Only tasks that have a topic. */
  readonly byTopic: readonly VariantAttemptGroup[];
  readonly tasks: readonly VariantAttemptTask[];
  /** Wrong or skipped tasks, in exam order — what to go over again. */
  readonly toRepeat: readonly { taskId: string; taskNumber: number; topic: string | null }[];
  /** Null for a variant whose source has no exam scoring rules. */
  readonly scoring: VariantAttemptScoring | null;
}
