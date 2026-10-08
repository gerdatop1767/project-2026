import { z } from 'zod';

export const progressSummarySchema = z.object({
  solvedTotal: z.number().int().nonnegative(),
  correctTotal: z.number().int().nonnegative(),
  incorrectTotal: z.number().int().nonnegative(),
  accuracyPercent: z.number().min(0).max(100),
  bySubject: z.array(
    z.object({
      subjectId: z.string(),
      solved: z.number().int().nonnegative(),
      correct: z.number().int().nonnegative(),
      accuracyPercent: z.number().min(0).max(100),
      /** Distinct tasks (by taskId) with at least one correct attempt —
       * additive to `solved`/`correct`/`accuracyPercent` above (which
       * stay attempt-row counts for the screens that legitimately need
       * that). Re-solving the same task any number of times still
       * counts once; two different tasks that happen to share a
       * taskNumber (different sources/variants) count separately. */
      uniqueSolved: z.number().int().nonnegative(),
    }),
  ),
  byTaskNumber: z.array(
    z.object({
      subjectId: z.string(),
      taskNumber: z.number().int().positive(),
      solved: z.number().int().nonnegative(),
      correct: z.number().int().nonnegative(),
      accuracyPercent: z.number().min(0).max(100),
    }),
  ),
  byTopic: z.array(
    z.object({
      topicId: z.uuid(),
      topicName: z.string(),
      solved: z.number().int().nonnegative(),
      correct: z.number().int().nonnegative(),
      accuracyPercent: z.number().min(0).max(100),
    }),
  ),
  /** Statistics 2.0 — real per-subject timing, additive to `bySubject`.
   * Absent subject (no timed attempts yet) just isn't in the array —
   * never a fabricated 0ms entry. */
  timeBySubject: z.array(
    z.object({
      subjectId: z.string(),
      averageTimeMs: z.number().nonnegative(),
      medianTimeMs: z.number().nonnegative(),
      timedAttempts: z.number().int().positive(),
    }),
  ),
});
export type ProgressSummary = z.infer<typeof progressSummarySchema>;

/**
 * Same collection/variant scoping shape as TaskListQuery/RandomTaskQuery
 * (packages/shared/src/tasks.ts) — no filter given means "aggregate
 * across every source", exactly one of collection/variant given means
 * "only this source's tasks". Works unchanged for any future
 * collection/variant, never a specific publisher's id.
 */
export const progressByTaskNumberQuerySchema = z.object({
  subject: z.string().optional(),
  collection: z.string().optional(),
  variant: z.uuid().optional(),
});
export type ProgressByTaskNumberQuery = z.infer<typeof progressByTaskNumberQuerySchema>;

export const progressByTaskNumberResponseSchema = z.object({
  items: z.array(
    z.object({
      subjectId: z.string(),
      taskNumber: z.number().int().positive(),
      /** Real, unique tasks available for this number under the given filters. */
      total: z.number().int().nonnegative(),
      /** Unique tasks (not attempts) the current user has answered at least once. */
      completed: z.number().int().nonnegative(),
      /** Real correct/incorrect ATTEMPTS for this number — the same
       * attempts-based convention as every other accuracy figure in the
       * app, never conflated with `completed` (unique tasks) above. */
      correct: z.number().int().nonnegative(),
      incorrect: z.number().int().nonnegative(),
      /** `null` when there are no attempts at all for this number yet —
       * never a fabricated 0%. */
      accuracyPercent: z.number().min(0).max(100).nullable(),
    }),
  ),
});
export type ProgressByTaskNumberResponse = z.infer<typeof progressByTaskNumberResponseSchema>;

/** Same shape/semantics as progressByTaskNumberQuerySchema — scoping is
 * identical for every real-progress endpoint, never special-cased. */
export const progressByTopicQuerySchema = progressByTaskNumberQuerySchema;
export type ProgressByTopicQuery = z.infer<typeof progressByTopicQuerySchema>;

export const progressByTopicResponseSchema = z.object({
  items: z.array(
    z.object({
      topicId: z.uuid(),
      topicName: z.string(),
      /** Real, unique published tasks in this topic under the given filters. */
      total: z.number().int().nonnegative(),
      /** Unique tasks (not attempts) the current user has answered at least once. */
      completed: z.number().int().nonnegative(),
    }),
  ),
});
export type ProgressByTopicResponse = z.infer<typeof progressByTopicResponseSchema>;

export const progressDailyQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(90).optional(),
  /** Scopes the daily activity to one subject — omitted means every subject. */
  subject: z.string().optional(),
});
export type ProgressDailyQuery = z.infer<typeof progressDailyQuerySchema>;

export const progressDailyResponseSchema = z.object({
  items: z.array(
    z.object({
      /** ISO calendar date (YYYY-MM-DD), UTC day boundary — same
       * timezone-less convention as the rest of this API; only days
       * with at least one attempt are included, so callers zero-fill
       * the requested range themselves (same precedent as
       * by-task-number's sparse `items`). */
      date: z.string(),
      /** Unique tasks (not attempts) this user attempted that day. */
      solved: z.number().int().nonnegative(),
      accuracyPercent: z.number().min(0).max(100),
    }),
  ),
});
export type ProgressDailyResponse = z.infer<typeof progressDailyResponseSchema>;
