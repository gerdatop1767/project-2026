import type { Database } from '@zybrilka/db';
import { schema } from '@zybrilka/db';
import { FLAT_RATER_MIN_RATINGS } from '@zybrilka/shared';
import { and, count, eq, gte, inArray, sql } from 'drizzle-orm';

export async function taskExists(db: Database, taskId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.tasks.id })
    .from(schema.tasks)
    .where(and(eq(schema.tasks.id, taskId), eq(schema.tasks.status, 'published')));
  return Boolean(row);
}

/** A student may rate a task only after answering it or opening its answer. */
export async function hasEngagedWithTask(
  db: Database,
  userId: string,
  taskId: string,
): Promise<boolean> {
  const [attempt] = await db
    .select({ id: schema.attempts.id })
    .from(schema.attempts)
    .where(and(eq(schema.attempts.userId, userId), eq(schema.attempts.taskId, taskId)))
    .limit(1);
  if (attempt) return true;
  const [reveal] = await db
    .select({ taskId: schema.taskAnswerReveals.taskId })
    .from(schema.taskAnswerReveals)
    .where(
      and(eq(schema.taskAnswerReveals.userId, userId), eq(schema.taskAnswerReveals.taskId, taskId)),
    )
    .limit(1);
  return Boolean(reveal);
}

/** Ratings this student wrote or changed since `since` — the spam limit. */
export async function ratingsWrittenSince(
  db: Database,
  userId: string,
  since: Date,
): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(schema.taskDifficultyRatings)
    .where(
      and(
        eq(schema.taskDifficultyRatings.userId, userId),
        gte(schema.taskDifficultyRatings.updatedAt, since),
      ),
    );
  return row?.n ?? 0;
}

/** One row per (student, task): a change updates it, never adds a second. */
export async function upsertRating(
  db: Database,
  userId: string,
  taskId: string,
  rating: number,
): Promise<void> {
  await db
    .insert(schema.taskDifficultyRatings)
    .values({ userId, taskId, rating })
    .onConflictDoUpdate({
      target: [schema.taskDifficultyRatings.userId, schema.taskDifficultyRatings.taskId],
      set: { rating, updatedAt: sql`now()` },
    });
}

export async function myRating(
  db: Database,
  userId: string,
  taskId: string,
): Promise<number | null> {
  const [row] = await db
    .select({ rating: schema.taskDifficultyRatings.rating })
    .from(schema.taskDifficultyRatings)
    .where(
      and(
        eq(schema.taskDifficultyRatings.userId, userId),
        eq(schema.taskDifficultyRatings.taskId, taskId),
      ),
    );
  return row?.rating ?? null;
}

export async function ratingsForTasks(
  db: Database,
  taskIds: readonly string[],
): Promise<{ taskId: string; userId: string; rating: number }[]> {
  if (taskIds.length === 0) return [];
  return db
    .select({
      taskId: schema.taskDifficultyRatings.taskId,
      userId: schema.taskDifficultyRatings.userId,
      rating: schema.taskDifficultyRatings.rating,
    })
    .from(schema.taskDifficultyRatings)
    .where(inArray(schema.taskDifficultyRatings.taskId, [...taskIds]));
}

/** Students among `userIds` who gave 10+ ratings, all the same value. */
export async function flatRaters(db: Database, userIds: readonly string[]): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const rows = await db
    .select({ userId: schema.taskDifficultyRatings.userId })
    .from(schema.taskDifficultyRatings)
    .where(inArray(schema.taskDifficultyRatings.userId, [...new Set(userIds)]))
    .groupBy(schema.taskDifficultyRatings.userId)
    .having(
      sql`count(*) >= ${FLAT_RATER_MIN_RATINGS} and min(${schema.taskDifficultyRatings.rating}) = max(${schema.taskDifficultyRatings.rating})`,
    );
  return new Set(rows.map((r) => r.userId));
}

/** The student's own ratings, for their skill profile. */
export async function ratingsOfUser(
  db: Database,
  userId: string,
): Promise<{ taskId: string; rating: number }[]> {
  return db
    .select({
      taskId: schema.taskDifficultyRatings.taskId,
      rating: schema.taskDifficultyRatings.rating,
    })
    .from(schema.taskDifficultyRatings)
    .where(eq(schema.taskDifficultyRatings.userId, userId));
}
