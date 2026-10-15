import { z } from 'zod';
import { canonicalSolutionDtoSchema } from './canonicalSolutionDto.js';

/**
 * `interval` and `multi_part` reuse the existing single
 * `correctAnswer`/`answerRaw` TEXT columns by convention: for
 * `interval` it's still a plain interval-set string (see
 * intervalAnswer.ts); for `multi_part` it's JSON (see
 * multiPartAnswer.ts). No separate INTEGER/DECIMAL/FRACTION/FREE_TEXT
 * types — the existing answer checker already normalizes all of those
 * identically, so splitting them out would just be duplication with no
 * behavior difference.
 */
/**
 * 'essay': no correctAnswer exists; `submitAttempt` rejects attempts on
 * these tasks before grading (see `EssayNotGradableError`).
 */
export const taskAnswerTypeSchema = z.enum([
  'short_answer',
  'multiple_choice',
  'interval',
  'multi_part',
  'essay',
]);
export type TaskAnswerType = z.infer<typeof taskAnswerTypeSchema>;

export const taskStatusSchema = z.enum(['draft', 'published', 'archived', 'needs_review']);
export type TaskStatus = z.infer<typeof taskStatusSchema>;

/**
 * A shared reading passage (see `packages/db/src/schema.ts`'s
 * `passages` table doc comment) — the material a task's `conditionMd`
 * refers to ("Прочитайте текст и выполните задание") but doesn't
 * repeat. Sent alongside the task it belongs to, same "before the
 * attempt" visibility as `conditionMd` (it's condition material, not
 * the answer) — never gated behind an attempt.
 */
export const passageSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  title: z.string().nullable(),
  bodyMd: z.string(),
  sourceAuthor: z.string().nullable(),
  sourceNote: z.string().nullable(),
});
export type Passage = z.infer<typeof passageSchema>;

/**
 * A task as sent to the client BEFORE that user has an attempt on
 * record for it — never `correctAnswer` or `explanation`
 * (docs/ARCHITECTURE.md §4: "never sent to the client before the
 * attempt is recorded on the server").
 */
export const taskPublicSchema = z.object({
  id: z.uuid(),
  subjectId: z.string(),
  taskNumber: z.number().int().positive(),
  topicId: z.uuid().nullable(),
  topicName: z.string().nullable(),
  difficulty: z.number().int().min(1).max(3),
  conditionMd: z.string(),
  /** The shared text this task reads, if any — null for a self-contained task. */
  passage: passageSchema.nullable(),
  imageUrl: z.string().nullable(),
  /** A short, task-specific nudge — same "before the attempt" visibility
   * as `conditionMd`, never the answer. Null when the task doesn't have
   * one yet (the client must not fall back to a generic hint). */
  hintMd: z.string().nullable(),
  answerType: taskAnswerTypeSchema,
  answerOptions: z.array(z.string()).nullable(),
  /** For multi_part tasks: each part's id+label (never the correct
   * answer) so the client can render one input per part before an
   * attempt exists. Null for every other answerType. */
  answerParts: z.array(z.object({ id: z.string(), label: z.string() })).nullable(),
  source: z.string(),
  sourceUrl: z.string().nullable(),
  sourceYear: z.number().int().nullable(),
  tags: z.array(z.string()),
  status: taskStatusSchema,
});
export type TaskPublic = z.infer<typeof taskPublicSchema>;

export const solutionStepSchema = z.object({
  title: z.string(),
  explanation: z.string(),
});
export type SolutionStep = z.infer<typeof solutionStepSchema>;

/** Same task, once the current user has attempted it — includes the answer key. */
export const taskWithSolutionSchema = taskPublicSchema.extend({
  correctAnswer: z.string(),
  /** Presentation-only LaTeX form of `correctAnswer`, when the plain
   * value isn't real math typography (e.g. "arccos(√10/5)") — the
   * client should render this (via MathText) when present and fall
   * back to `correctAnswer` otherwise. Never used for grading. */
  correctAnswerDisplay: z.string().nullable(),
  explanationMd: z.string(),
  /** `explanationMd` broken into named, task-specific steps for a
   * step-by-step UI. Null falls back to rendering `explanationMd` as
   * one block — never a fabricated generic step split. */
  solutionSteps: z.array(solutionStepSchema).nullable(),
  /**
   * A structured, exam-annotated reference solution (Canonical
   * Solution System) — an ADDITIONAL, separate source of solution
   * content, never a replacement for `explanationMd`/`solutionSteps`
   * above (both keep working exactly as before, for every task).
   * Present only for the small set of tasks that have both a
   * registered solution template AND authored canonical-solution
   * content — today that's exactly one real task (math №13, variant
   * 1). Absent (not `null`) for every other task; the client must
   * never assume this field exists.
   */
  canonicalSolution: canonicalSolutionDtoSchema.optional(),
  /**
   * A genuine, authored example essay for an `essay`-type task (e.g.
   * EGE Russian 27) — grounded in that task's own passage, never a
   * generic template. `null` when no sample has been prepared yet
   * (the client must say so explicitly, never fabricate one). Absent
   * (not present at all) for every non-essay task.
   */
  sampleEssayMd: z.string().nullable().optional(),
  /**
   * Whether the current user has marked this essay task as "Я решил"
   * (see `essay_acknowledgements` table) — distinct from a graded
   * attempt, which essay tasks never have (`EssayNotGradableError`).
   * Present only alongside `sampleEssayMd`, i.e. only for essay tasks.
   */
  essayAcknowledged: z.boolean().optional(),
});
export type TaskWithSolution = z.infer<typeof taskWithSolutionSchema>;

/** Response for POST /tasks/:id/essay-ack. */
export const essayAckResponseSchema = z.object({
  acknowledged: z.literal(true),
});
export type EssayAckResponse = z.infer<typeof essayAckResponseSchema>;

export const taskListQuerySchema = z.object({
  subject: z.string().optional(),
  taskNumber: z.coerce.number().int().positive().optional(),
  topic: z.uuid().optional(),
  difficulty: z.coerce.number().int().min(1).max(3).optional(),
  /** Collection slug (e.g. "ege-2026-yashchenko") — every published task linked to it via any variant. */
  collection: z.string().optional(),
  /** A specific variant's id — only that variant's own tasks. */
  variant: z.uuid().optional(),
  // 'needs_review' is deliberately excluded here — it must never be
  // reachable through the public list endpoint, even by an explicit
  // query param, unlike the other statuses this endpoint already allows.
  status: z.enum(['draft', 'published', 'archived']).optional(),
  /**
   * Excludes any task the current user has at least one CORRECT
   * attempt on — deliberately distinct from `/tasks/random`'s `unseen`
   * (which excludes a task on ANY attempt, correct or not — "not yet
   * encountered"). "По номерам"'s «Только нерешённые» means "not yet
   * solved correctly": 10 wrong attempts and zero correct ones still
   * counts as unsolved. Requires `x-anon-id` identity, same as `unseen`
   * elsewhere — the route rejects it without one rather than silently
   * not filtering.
   */
  unsolved: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});
export type TaskListQuery = z.infer<typeof taskListQuerySchema>;

export const taskListResponseSchema = z.object({
  items: z.array(taskPublicSchema),
  nextCursor: z.string().nullable(),
});
export type TaskListResponse = z.infer<typeof taskListResponseSchema>;

/**
 * Real published-task counts per subject, one request instead of a
 * separate `/tasks?subject=X` round trip per subject card (e.g. Home's
 * subject grid). A subject with zero published tasks simply doesn't
 * appear — callers treat an absent subject as 0, never fabricating a
 * row for it.
 */
export const taskCountsBySubjectResponseSchema = z.object({
  items: z.array(z.object({ subjectId: z.string(), count: z.number().int().nonnegative() })),
});
export type TaskCountsBySubjectResponse = z.infer<typeof taskCountsBySubjectResponseSchema>;

export const randomTaskQuerySchema = z.object({
  subject: z.string().optional(),
  taskNumber: z.coerce.number().int().positive().optional(),
  /** Collection slug — restrict the random pick to this collection's tasks (any of its variants). */
  collection: z.string().optional(),
  /** A specific variant's id — restrict the random pick to just that variant. */
  variant: z.uuid().optional(),
  /** A specific topic's id — restrict the random pick to that topic. */
  topic: z.uuid().optional(),
  /** Excludes any task the requesting user already has an attempt on
   * (see Training's "Не встречавшиеся" toggle) — requires `x-anon-id`,
   * never a client-trusted user id. */
  unseen: z.coerce.boolean().optional(),
});
export type RandomTaskQuery = z.infer<typeof randomTaskQuerySchema>;

/** A single string for short_answer/multiple_choice/interval tasks, or {partId: answer} for multi_part. */
export const attemptAnswerSchema = z.union([
  z.string().min(1).max(2000),
  z.record(z.string().min(1), z.string().min(1).max(2000)),
]);
export type AttemptAnswer = z.infer<typeof attemptAnswerSchema>;

export const attemptRequestSchema = z.object({
  answer: attemptAnswerSchema,
  timeSpentMs: z.number().int().nonnegative().optional(),
});
export type AttemptRequest = z.infer<typeof attemptRequestSchema>;

export const multiPartStatusSchema = z.enum(['all_correct', 'partially_correct', 'all_incorrect']);
export type MultiPartResultStatus = z.infer<typeof multiPartStatusSchema>;

export const attemptPartResultSchema = z.object({
  id: z.string(),
  label: z.string(),
  correct: z.boolean(),
});
export type AttemptPartResult = z.infer<typeof attemptPartResultSchema>;

export const attemptResultSchema = z.object({
  correct: z.boolean(),
  correctAnswer: z.string(),
  /** Same purpose as `TaskWithSolution.correctAnswerDisplay` — the
   * presentation-only LaTeX form, never used for grading. */
  correctAnswerDisplay: z.string().nullable(),
  explanation: z.string(),
  attemptId: z.uuid(),
  mistakeId: z.uuid().nullable(),
  // Present only for multi_part tasks — per-part breakdown of a single logical attempt.
  parts: z.array(attemptPartResultSchema).optional(),
  correctParts: z.number().int().nonnegative().optional(),
  totalParts: z.number().int().nonnegative().optional(),
  partStatus: multiPartStatusSchema.optional(),
});
export type AttemptResult = z.infer<typeof attemptResultSchema>;
