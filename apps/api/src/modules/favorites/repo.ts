import type { Database } from '@zybrilka/db';
import { schema } from '@zybrilka/db';
import { and, eq, ne } from 'drizzle-orm';

/** A task put back on review drops out until it is checked. */
export async function listFavoriteTaskIds(db: Database, userId: string): Promise<string[]> {
  const rows = await db
    .select({ taskId: schema.favorites.taskId })
    .from(schema.favorites)
    .innerJoin(schema.tasks, eq(schema.favorites.taskId, schema.tasks.id))
    .where(and(eq(schema.favorites.userId, userId), ne(schema.tasks.status, 'needs_review')));
  return rows.map((r) => r.taskId);
}

/** Idempotent: a second add for the same (userId, taskId) is a no-op,
 * relying on `favorites_user_task_idx` rather than a read-then-write
 * check (no race between two toggles in flight). */
export async function addFavorite(db: Database, userId: string, taskId: string): Promise<void> {
  await db
    .insert(schema.favorites)
    .values({ userId, taskId })
    .onConflictDoNothing({ target: [schema.favorites.userId, schema.favorites.taskId] });
}

export async function removeFavorite(db: Database, userId: string, taskId: string): Promise<void> {
  await db
    .delete(schema.favorites)
    .where(and(eq(schema.favorites.userId, userId), eq(schema.favorites.taskId, taskId)));
}
