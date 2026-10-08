import type { Database } from '@zybrilka/db';
import { schema } from '@zybrilka/db';
import type { RandomTaskQuery, TaskListQuery } from '@zybrilka/shared';
import { and, asc, count, eq, gt, inArray, notInArray, or, sql } from 'drizzle-orm';

type TaskRow = typeof schema.tasks.$inferSelect;

export interface TaskWithTopic {
  task: TaskRow;
  topicName: string | null;
}

function decodeCursor(cursor: string): { createdAt: Date; id: string } | null {
  try {
    const [iso, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
    if (!iso || !id) return null;
    const createdAt = new Date(iso);
    if (Number.isNaN(createdAt.getTime())) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

function encodeCursor(row: TaskRow): string {
  return Buffer.from(`${row.createdAt.toISOString()}|${row.id}`, 'utf8').toString('base64url');
}

/**
 * Builds an `inArray(tasks.id, ...)` subquery scoping to a collection
 * (any of its variants) or one specific variant — both only ever match
 * a *published* variant/collection, so an archived/draft one silently
 * yields no tasks rather than leaking them. Returns null when neither
 * filter is given, so callers skip the condition entirely.
 *
 * Exported so other modules (progress) can scope their own queries to
 * the exact same collection/variant membership rules without
 * duplicating this SQL — one source of truth for "which tasks belong
 * to this source", reused by every future collection/variant, not
 * special-cased per publisher.
 */
export function taskIdsForCollectionOrVariant(
  db: Database,
  filters: { collection?: string; variant?: string },
) {
  if (filters.variant) {
    return db
      .select({ id: schema.variantTasks.taskId })
      .from(schema.variantTasks)
      .innerJoin(schema.variants, eq(schema.variantTasks.variantId, schema.variants.id))
      .where(
        and(
          eq(schema.variantTasks.variantId, filters.variant),
          eq(schema.variants.status, 'published'),
        ),
      );
  }
  if (filters.collection) {
    return db
      .select({ id: schema.variantTasks.taskId })
      .from(schema.variantTasks)
      .innerJoin(schema.variants, eq(schema.variantTasks.variantId, schema.variants.id))
      .innerJoin(schema.collections, eq(schema.variants.collectionId, schema.collections.id))
      .where(
        and(
          eq(schema.collections.slug, filters.collection),
          eq(schema.collections.status, 'published'),
          eq(schema.variants.status, 'published'),
        ),
      );
  }
  return null;
}

/**
 * Real published-task counts, one query for every subject at once —
 * the Home "Математика — N заданий" cards need exactly this, and
 * fetching it once here beats a separate `/tasks?subject=X` round trip
 * per subject card.
 */
export async function getCountsBySubject(
  db: Database,
): Promise<{ subjectId: string; count: number }[]> {
  return db
    .select({ subjectId: schema.tasks.subjectId, count: count() })
    .from(schema.tasks)
    .where(eq(schema.tasks.status, 'published'))
    .groupBy(schema.tasks.subjectId);
}

export async function listTasks(
  db: Database,
  filters: TaskListQuery,
  /** Required (and only meaningful) when `filters.unsolved` is set — see
   * `userId`'s doc on `FastifyRequest` for why this is never a
   * client-trusted value. */
  userId?: string | null,
): Promise<{ items: TaskWithTopic[]; nextCursor: string | null }> {
  const conditions = [eq(schema.tasks.status, filters.status ?? 'published')];
  if (filters.subject) conditions.push(eq(schema.tasks.subjectId, filters.subject));
  if (filters.taskNumber) conditions.push(eq(schema.tasks.taskNumber, filters.taskNumber));
  if (filters.topic) conditions.push(eq(schema.tasks.topicId, filters.topic));
  if (filters.difficulty) conditions.push(eq(schema.tasks.difficulty, filters.difficulty));
  const scoped = taskIdsForCollectionOrVariant(db, filters);
  if (scoped) conditions.push(inArray(schema.tasks.id, scoped));
  if (filters.unsolved && userId) {
    conditions.push(
      notInArray(
        schema.tasks.id,
        db
          .select({ taskId: schema.attempts.taskId })
          .from(schema.attempts)
          .where(and(eq(schema.attempts.userId, userId), eq(schema.attempts.isCorrect, true))),
      ),
    );
  }

  const cursor = filters.cursor ? decodeCursor(filters.cursor) : null;
  if (cursor) {
    conditions.push(
      or(
        gt(schema.tasks.createdAt, cursor.createdAt),
        and(eq(schema.tasks.createdAt, cursor.createdAt), gt(schema.tasks.id, cursor.id)),
      )!,
    );
  }

  // Fetch one extra row to know whether another page follows.
  const rows = await db
    .select({ task: schema.tasks, topicName: schema.topics.name })
    .from(schema.tasks)
    .leftJoin(schema.topics, eq(schema.tasks.topicId, schema.topics.id))
    .where(and(...conditions))
    .orderBy(asc(schema.tasks.createdAt), asc(schema.tasks.id))
    .limit(filters.limit + 1);

  const hasMore = rows.length > filters.limit;
  const page = hasMore ? rows.slice(0, filters.limit) : rows;
  const nextCursor = hasMore ? encodeCursor(page[page.length - 1]!.task) : null;

  return { items: page, nextCursor };
}

export async function getTaskById(db: Database, id: string): Promise<TaskWithTopic | undefined> {
  const [row] = await db
    .select({ task: schema.tasks, topicName: schema.topics.name })
    .from(schema.tasks)
    .leftJoin(schema.topics, eq(schema.tasks.topicId, schema.topics.id))
    .where(eq(schema.tasks.id, id));
  return row;
}

export async function getRandomTask(
  db: Database,
  filters: RandomTaskQuery,
  /** Required (and only meaningful) when `filters.unseen` is set — see
   * `userId`'s doc on `FastifyRequest` for why this is never a
   * client-trusted value. */
  userId?: string | null,
): Promise<TaskWithTopic | undefined> {
  const conditions = [eq(schema.tasks.status, 'published' as const)];
  if (filters.subject) conditions.push(eq(schema.tasks.subjectId, filters.subject));
  if (filters.taskNumber) conditions.push(eq(schema.tasks.taskNumber, filters.taskNumber));
  if (filters.topic) conditions.push(eq(schema.tasks.topicId, filters.topic));
  const scoped = taskIdsForCollectionOrVariant(db, filters);
  if (scoped) conditions.push(inArray(schema.tasks.id, scoped));
  if (filters.unseen && userId) {
    conditions.push(
      notInArray(
        schema.tasks.id,
        db
          .select({ taskId: schema.attempts.taskId })
          .from(schema.attempts)
          .where(eq(schema.attempts.userId, userId)),
      ),
    );
  }

  const [row] = await db
    .select({ task: schema.tasks, topicName: schema.topics.name })
    .from(schema.tasks)
    .leftJoin(schema.topics, eq(schema.tasks.topicId, schema.topics.id))
    .where(and(...conditions))
    .orderBy(sql`random()`)
    .limit(1);
  return row;
}

export async function hasAttempt(db: Database, userId: string, taskId: string): Promise<boolean> {
  const [row] = await db
    .select({ value: count() })
    .from(schema.attempts)
    .where(and(eq(schema.attempts.userId, userId), eq(schema.attempts.taskId, taskId)));
  return (row?.value ?? 0) > 0;
}

export async function createAttempt(
  db: Database,
  input: {
    userId: string;
    taskId: string;
    answerRaw: string;
    isCorrect: boolean;
    timeSpentMs?: number;
  },
) {
  const [attempt] = await db.insert(schema.attempts).values(input).returning();
  return attempt!;
}

/**
 * Streak system — the single point an attempt becomes "real daily
 * activity" (see CLAUDE.md: a submitted/graded attempt, correct or
 * not, never a view/open). `activityDate` must already be the real
 * Europe/Moscow calendar date (`toMoscowDateString`), resolved by the
 * caller from the attempt's own `createdAt` — this function does no
 * timezone logic itself. `onConflictDoNothing` on the table's
 * `UNIQUE(user_id, activity_date)` is what makes several attempts in
 * one Moscow day, and two concurrent submissions racing on the same
 * day, both collapse to exactly one row — enforced by Postgres, not
 * app-level locking.
 */
export async function recordDailyActivity(
  db: Database,
  userId: string,
  activityDate: string,
): Promise<void> {
  await db
    .insert(schema.userDailyActivity)
    .values({ userId, activityDate })
    .onConflictDoNothing({
      target: [schema.userDailyActivity.userId, schema.userDailyActivity.activityDate],
    });
}

/**
 * Applies the attempt result to `mistakes`: creates or reopens the row
 * on a wrong answer (incrementing `timesWrong`), resolves it on a
 * correct one. Never deletes a mistake row or its attempt history.
 * Returns the mistake id, or null when the answer was correct and no
 * mistake row exists for this (user, task) pair.
 */
export async function applyAttemptToMistakes(
  db: Database,
  input: {
    userId: string;
    taskId: string;
    attemptId: string;
    isCorrect: boolean;
    /** ids of the parts that were wrong on this attempt, for 'multi_part' tasks only; null otherwise or when fully correct. */
    wrongParts: readonly string[] | null;
  },
): Promise<string | null> {
  const [existing] = await db
    .select()
    .from(schema.mistakes)
    .where(and(eq(schema.mistakes.userId, input.userId), eq(schema.mistakes.taskId, input.taskId)));

  if (input.isCorrect) {
    if (!existing) return null;
    // lastAttemptId intentionally stays pointed at the last WRONG
    // attempt (not this correct one) — Mistakes' "мой ответ" always
    // shows what the user actually got wrong, even after it's resolved.
    await db
      .update(schema.mistakes)
      .set({ status: 'resolved', updatedAt: new Date() })
      .where(eq(schema.mistakes.id, existing.id));
    return existing.id;
  }

  if (existing) {
    await db
      .update(schema.mistakes)
      .set({
        status: 'open',
        lastAttemptId: input.attemptId,
        timesWrong: existing.timesWrong + 1,
        wrongParts: input.wrongParts,
        updatedAt: new Date(),
      })
      .where(eq(schema.mistakes.id, existing.id));
    return existing.id;
  }

  const [created] = await db
    .insert(schema.mistakes)
    .values({
      userId: input.userId,
      taskId: input.taskId,
      firstAttemptId: input.attemptId,
      lastAttemptId: input.attemptId,
      wrongParts: input.wrongParts,
    })
    .returning();
  return created!.id;
}
