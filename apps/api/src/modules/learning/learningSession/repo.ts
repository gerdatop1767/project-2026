import type { Database } from '@zybrilka/db';
import { schema } from '@zybrilka/db';
import type { LearningSessionStatus, VariantScoringSnapshot } from '@zybrilka/shared';
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lte, sql } from 'drizzle-orm';

export interface LearningSessionRow {
  readonly id: string;
  readonly userId: string;
  readonly subjectId: string;
  readonly total: number;
  readonly consumedTaskIds: readonly string[];
  readonly unseenOnly: boolean;
  readonly randomizeTopTier: boolean;
  /** Non-null means this is a VARIANT session — see schema.ts's doc
   * comment. `plannedTaskIds` is also non-null exactly when this is. */
  readonly variantId: string | null;
  readonly plannedTaskIds: readonly string[] | null;
  /** A variant's scoring rules frozen at its start; null before 0035. */
  readonly scoring: VariantScoringSnapshot | null;
  readonly status: LearningSessionStatus;
  readonly startedAt: Date;
  readonly completedAt: Date | null;
}

function toRow(row: typeof schema.learningSessions.$inferSelect): LearningSessionRow {
  return {
    id: row.id,
    userId: row.userId,
    subjectId: row.subjectId,
    total: row.total,
    consumedTaskIds: row.consumedTaskIds,
    unseenOnly: row.unseenOnly,
    randomizeTopTier: row.randomizeTopTier,
    variantId: row.variantId,
    plannedTaskIds: row.plannedTaskIds ?? null,
    scoring: row.scoring ?? null,
    status: row.status as LearningSessionStatus,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
  };
}

/** The first task is included at creation time (never a separate
 * insert-then-append) so a session is never observably in a state
 * with zero consumed tasks. */
export async function createSession(
  db: Database,
  input: {
    userId: string;
    subjectId: string;
    total: number;
    firstTaskId: string;
    unseenOnly?: boolean;
    randomizeTopTier?: boolean;
    variantId?: string;
    plannedTaskIds?: readonly string[];
    /** A variant's scoring rules, frozen for this attempt. */
    scoring?: VariantScoringSnapshot | null;
  },
): Promise<LearningSessionRow> {
  const [row] = await db
    .insert(schema.learningSessions)
    .values({
      userId: input.userId,
      subjectId: input.subjectId,
      total: input.total,
      consumedTaskIds: [input.firstTaskId],
      unseenOnly: input.unseenOnly ?? false,
      randomizeTopTier: input.randomizeTopTier ?? false,
      variantId: input.variantId,
      plannedTaskIds: input.plannedTaskIds,
      scoring: input.scoring ?? null,
    })
    .returning();
  return toRow(row!);
}

/** Minimal variant identity lookup (number + title) for stamping an
 * active/completed response with `variant` — never the full task list
 * `getVariantDetail` loads, which `advanceLearningSession`/snapshot
 * reads don't need. */
export async function getVariantIdentity(
  db: Database,
  variantId: string,
): Promise<{ variantNumber: number; title: string; examFormat: string | null } | undefined> {
  const [row] = await db
    .select({
      variantNumber: schema.variants.variantNumber,
      title: schema.variants.title,
      examFormat: schema.collections.examFormat,
    })
    .from(schema.variants)
    .innerJoin(schema.collections, eq(schema.collections.id, schema.variants.collectionId))
    .where(eq(schema.variants.id, variantId));
  return row;
}

export interface VariantSessionRow extends LearningSessionRow {
  readonly variantId: string;
  readonly plannedTaskIds: readonly string[];
  readonly variantNumber: number;
  readonly variantTitle: string;
}

/**
 * Every VARIANT session (Training's "Вариант" mode) this user has ever
 * started, regardless of status — Statistics' "Статистика вариантов"
 * shows a still-active (abandoned) one too, with its real partial
 * progress, never hiding it or faking it as finished (see
 * `getVariantProgress` in service.ts for how `status` is used instead
 * of a filter). Newest first.
 */
export async function getVariantSessionsForUser(
  db: Database,
  userId: string,
): Promise<VariantSessionRow[]> {
  const rows = await db
    .select({
      session: schema.learningSessions,
      variantNumber: schema.variants.variantNumber,
      variantTitle: schema.variants.title,
    })
    .from(schema.learningSessions)
    .innerJoin(schema.variants, eq(schema.learningSessions.variantId, schema.variants.id))
    .where(
      and(eq(schema.learningSessions.userId, userId), isNotNull(schema.learningSessions.variantId)),
    )
    .orderBy(desc(schema.learningSessions.startedAt));

  return rows.map((row) => ({
    ...toRow(row.session),
    variantId: row.session.variantId!,
    plannedTaskIds: row.session.plannedTaskIds!,
    variantNumber: row.variantNumber,
    variantTitle: row.variantTitle,
  }));
}

export async function getSessionById(
  db: Database,
  sessionId: string,
): Promise<LearningSessionRow | undefined> {
  const [row] = await db
    .select()
    .from(schema.learningSessions)
    .where(eq(schema.learningSessions.id, sessionId));
  return row ? toRow(row) : undefined;
}

/** Atomic append via the jsonb `||` concat operator — never a
 * read-modify-write race between concurrent requests for the same
 * session. Returns the row AFTER the append. */
export async function appendConsumedTask(
  db: Database,
  sessionId: string,
  taskId: string,
): Promise<LearningSessionRow> {
  const [row] = await db
    .update(schema.learningSessions)
    .set({
      consumedTaskIds: sql`${schema.learningSessions.consumedTaskIds} || ${JSON.stringify([taskId])}::jsonb`,
      updatedAt: new Date(),
    })
    .where(eq(schema.learningSessions.id, sessionId))
    .returning();
  return toRow(row!);
}

/**
 * A VARIANT session: makes `taskId` the current task — served (so answers
 * to it are linked to the session) and last in `consumedTaskIds`, which is
 * what the snapshot reports as current. Opening it again only moves it to
 * the end, never adds it twice. One conditional UPDATE: a session that is
 * not this user's, not active, or never planned this task is left alone
 * (null).
 */
export async function focusVariantTask(
  db: Database,
  sessionId: string,
  userId: string,
  taskId: string,
): Promise<LearningSessionRow | null> {
  const item = JSON.stringify([taskId]);
  const [row] = await db
    .update(schema.learningSessions)
    .set({
      consumedTaskIds: sql`(${schema.learningSessions.consumedTaskIds} - ${taskId}::text) || ${item}::jsonb`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.learningSessions.id, sessionId),
        eq(schema.learningSessions.userId, userId),
        eq(schema.learningSessions.status, 'active'),
        sql`${schema.learningSessions.plannedTaskIds} @> ${item}::jsonb`,
      ),
    )
    .returning();
  return row ? toRow(row) : null;
}

export async function markCompleted(db: Database, sessionId: string): Promise<LearningSessionRow> {
  const [row] = await db
    .update(schema.learningSessions)
    .set({ status: 'completed', completedAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.learningSessions.id, sessionId))
    .returning();
  return toRow(row!);
}

export interface SessionAttemptFullRow {
  readonly taskId: string;
  readonly isCorrect: boolean;
  readonly createdAt: Date;
  readonly timeSpentMs: number | null;
  readonly answerRaw: string;
  readonly answerType: (typeof schema.taskAnswerTypes)[number];
  readonly correctAnswer: string;
}

export async function getSkillIdsForTasks(
  db: Database,
  taskIds: readonly string[],
): Promise<string[]> {
  if (taskIds.length === 0) return [];
  const rows = await db
    .select({ skillId: schema.taskSkills.skillId })
    .from(schema.taskSkills)
    .where(inArray(schema.taskSkills.taskId, taskIds as string[]));
  return rows.map((r) => r.skillId);
}

/** Real `mistakes` rows for this user on one of `taskIds` whose
 * `createdAt` (first-ever-wrong-attempt time) falls at or after
 * `since` — a mistake merely UPDATED during the session (e.g.
 * resolved by a later correct attempt) but originally created earlier
 * is correctly excluded, matching "mistakesCreated" literally. */
export async function countMistakesCreatedSince(
  db: Database,
  userId: string,
  taskIds: readonly string[],
  since: Date,
): Promise<number> {
  if (taskIds.length === 0) return 0;
  const rows = await db
    .select({ id: schema.mistakes.id })
    .from(schema.mistakes)
    .where(
      and(
        eq(schema.mistakes.userId, userId),
        inArray(schema.mistakes.taskId, taskIds as string[]),
        gte(schema.mistakes.createdAt, since),
      ),
    );
  return rows.length;
}

export interface SessionAnswerRow extends SessionAttemptFullRow {
  readonly attemptId: string;
}

/**
 * The answers given IN this session. Exact for every answer submitted
 * with the session's id (attempts.learning_session_id, migration 0033).
 * A session with no linked answer at all (started before that, or by an
 * older client) falls back to its time window: unlinked answers to its
 * tasks between its start and its finish — bounded on both ends, so a
 * later attempt of the same variant never leaks into an earlier one.
 */
export async function getAnswersOfSession(
  db: Database,
  session: LearningSessionRow,
): Promise<{ rows: SessionAnswerRow[]; attribution: 'exact' | 'time_window' }> {
  const columns = {
    attemptId: schema.attempts.id,
    taskId: schema.attempts.taskId,
    isCorrect: schema.attempts.isCorrect,
    createdAt: schema.attempts.createdAt,
    timeSpentMs: schema.attempts.timeSpentMs,
    answerRaw: schema.attempts.answerRaw,
    answerType: schema.tasks.answerType,
    correctAnswer: schema.tasks.correctAnswer,
  };
  const linked = await db
    .select(columns)
    .from(schema.attempts)
    .innerJoin(schema.tasks, eq(schema.attempts.taskId, schema.tasks.id))
    .where(
      and(
        eq(schema.attempts.userId, session.userId),
        eq(schema.attempts.learningSessionId, session.id),
      ),
    )
    .orderBy(asc(schema.attempts.createdAt));
  if (linked.length > 0 || session.consumedTaskIds.length === 0) {
    return { rows: linked, attribution: 'exact' };
  }
  const window = [
    eq(schema.attempts.userId, session.userId),
    inArray(schema.attempts.taskId, session.consumedTaskIds as string[]),
    isNull(schema.attempts.learningSessionId),
    gte(schema.attempts.createdAt, session.startedAt),
  ];
  if (session.completedAt) window.push(lte(schema.attempts.createdAt, session.completedAt));
  const rows = await db
    .select(columns)
    .from(schema.attempts)
    .innerJoin(schema.tasks, eq(schema.attempts.taskId, schema.tasks.id))
    .where(and(...window))
    .orderBy(asc(schema.attempts.createdAt));
  return { rows, attribution: 'time_window' };
}

export interface PlannedTaskRow {
  readonly taskId: string;
  readonly taskNumber: number;
  readonly topic: string | null;
  readonly answerType: (typeof schema.taskAnswerTypes)[number];
  readonly correctAnswer: string;
  readonly correctAnswerDisplay: string | null;
  readonly explanationMd: string;
}

export async function getPlannedTasks(
  db: Database,
  taskIds: readonly string[],
): Promise<PlannedTaskRow[]> {
  if (taskIds.length === 0) return [];
  return db
    .select({
      taskId: schema.tasks.id,
      taskNumber: schema.tasks.taskNumber,
      topic: schema.topics.name,
      answerType: schema.tasks.answerType,
      correctAnswer: schema.tasks.correctAnswer,
      correctAnswerDisplay: schema.tasks.correctAnswerDisplay,
      explanationMd: schema.tasks.explanationMd,
    })
    .from(schema.tasks)
    .leftJoin(schema.topics, eq(schema.topics.id, schema.tasks.topicId))
    .where(inArray(schema.tasks.id, taskIds as string[]));
}
