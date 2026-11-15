import type { Database } from '@zybrilka/db';
import {
  aggregateDifficultyRatings,
  type CommunityDifficulty,
  type DifficultyRatingResponse,
} from '@zybrilka/shared';
import * as repo from './repo.js';

/** Ratings a student may write or change per minute — far above real use. */
export const RATINGS_PER_MINUTE = 30;

export type RateOutcome =
  | { ok: true; value: DifficultyRatingResponse }
  | { ok: false; error: 'task_not_found' | 'not_attempted' | 'too_many_ratings' };

/** Community difficulty of many tasks at once (for picking and lists). */
export async function communityDifficulty(
  db: Database,
  taskIds: readonly string[],
): Promise<Map<string, CommunityDifficulty>> {
  const ratings = await repo.ratingsForTasks(db, taskIds);
  const flat = await repo.flatRaters(
    db,
    ratings.map((r) => r.userId),
  );
  const byTask = new Map<string, { userId: string; rating: number }[]>();
  for (const r of ratings) byTask.set(r.taskId, [...(byTask.get(r.taskId) ?? []), r]);
  const out = new Map<string, CommunityDifficulty>();
  for (const id of taskIds) out.set(id, aggregateDifficultyRatings(byTask.get(id) ?? [], flat));
  return out;
}

export async function getRating(
  db: Database,
  userId: string,
  taskId: string,
): Promise<DifficultyRatingResponse | null> {
  if (!(await repo.taskExists(db, taskId))) return null;
  const [mine, community] = await Promise.all([
    repo.myRating(db, userId, taskId),
    communityDifficulty(db, [taskId]),
  ]);
  return { myRating: mine, community: community.get(taskId)! };
}

export async function rateTask(
  db: Database,
  userId: string,
  taskId: string,
  rating: number,
  now = new Date(),
): Promise<RateOutcome> {
  if (!(await repo.taskExists(db, taskId))) return { ok: false, error: 'task_not_found' };
  if (!(await repo.hasEngagedWithTask(db, userId, taskId))) {
    return { ok: false, error: 'not_attempted' };
  }
  const recent = await repo.ratingsWrittenSince(db, userId, new Date(now.getTime() - 60_000));
  const existing = await repo.myRating(db, userId, taskId);
  // Re-sending the same value is not a new write (double tap, retry).
  if (existing !== rating && recent >= RATINGS_PER_MINUTE) {
    return { ok: false, error: 'too_many_ratings' };
  }
  if (existing !== rating) await repo.upsertRating(db, userId, taskId, rating);
  return { ok: true, value: (await getRating(db, userId, taskId))! };
}
