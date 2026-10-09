import type { Database } from '@zybrilka/db';
import { schema } from '@zybrilka/db';
import { and, asc, eq } from 'drizzle-orm';

export interface VariantWithCollection {
  variant: typeof schema.variants.$inferSelect;
  collection: typeof schema.collections.$inferSelect;
}

/**
 * Only ever matches a *published* variant inside a *published*
 * collection — an archived/draft one is indistinguishable from a
 * missing id, so §19's "only published reaches a normal user" is
 * enforced here, not left to the caller to remember.
 */
export async function getPublishedVariantById(
  db: Database,
  id: string,
): Promise<VariantWithCollection | undefined> {
  const [row] = await db
    .select({ variant: schema.variants, collection: schema.collections })
    .from(schema.variants)
    .innerJoin(schema.collections, eq(schema.variants.collectionId, schema.collections.id))
    .where(
      and(
        eq(schema.variants.id, id),
        eq(schema.variants.status, 'published'),
        eq(schema.collections.status, 'published'),
      ),
    );
  return row;
}

/**
 * Finds the (published) variant a task belongs to — the reverse of
 * `listVariantTasks`, used to resolve "which ordered exam is this task
 * a part of" when a caller knows only a taskId (and, optionally, a
 * collection slug to disambiguate/isolate a specific source rather
 * than matching any collection the task happens to appear in). A task
 * can in principle sit in more than one variant (variant_tasks is
 * many-to-many); this returns the first published match, which is
 * exact and unambiguous for every case that exists today (one task,
 * one variant) and still well-defined once a collection scope is
 * given for the many-variant case.
 */
export async function getVariantForTask(
  db: Database,
  taskId: string,
  collectionSlug?: string,
): Promise<VariantWithCollection | undefined> {
  const conditions = [
    eq(schema.variantTasks.taskId, taskId),
    eq(schema.variants.status, 'published'),
    eq(schema.collections.status, 'published'),
  ];
  if (collectionSlug) conditions.push(eq(schema.collections.slug, collectionSlug));

  const [row] = await db
    .select({ variant: schema.variants, collection: schema.collections })
    .from(schema.variantTasks)
    .innerJoin(schema.variants, eq(schema.variantTasks.variantId, schema.variants.id))
    .innerJoin(schema.collections, eq(schema.variants.collectionId, schema.collections.id))
    .where(and(...conditions))
    .limit(1);
  return row;
}

export interface VariantTaskRow {
  position: number;
  task: typeof schema.tasks.$inferSelect;
  topicName: string | null;
  passage: typeof schema.passages.$inferSelect | null;
}

/** Ordered by `position` — the exam's own order, never shuffled. Excludes
 * any task that isn't (or is no longer) `published`, so a task pulled
 * back to draft/needs_review silently drops out of the variant instead
 * of leaking. */
export async function listVariantTasks(db: Database, variantId: string): Promise<VariantTaskRow[]> {
  return db
    .select({
      position: schema.variantTasks.position,
      task: schema.tasks,
      topicName: schema.topics.name,
      passage: schema.passages,
    })
    .from(schema.variantTasks)
    .innerJoin(schema.tasks, eq(schema.variantTasks.taskId, schema.tasks.id))
    .leftJoin(schema.topics, eq(schema.tasks.topicId, schema.topics.id))
    .leftJoin(schema.passages, eq(schema.tasks.passageId, schema.passages.id))
    .where(and(eq(schema.variantTasks.variantId, variantId), eq(schema.tasks.status, 'published')))
    .orderBy(asc(schema.variantTasks.position));
}
