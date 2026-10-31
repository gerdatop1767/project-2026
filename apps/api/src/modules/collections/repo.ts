import type { Database } from '@zybrilka/db';
import { schema } from '@zybrilka/db';
import { and, asc, count, countDistinct, eq, sql } from 'drizzle-orm';

export type CollectionRow = typeof schema.collections.$inferSelect;
export type VariantRow = typeof schema.variants.$inferSelect;

export interface CollectionWithVariants {
  collection: CollectionRow;
  variants: (VariantRow & { taskCount: number })[];
  taskCount: number;
  variantTaskCount: number;
  taskNumbers: number[];
}

/** Small, unpaginated on purpose — the number of collections is tiny
 * compared to tasks, and a "Сборник" picker needs the whole list at
 * once. Only ever published collections/variants, same gate as every
 * other public listing. */
export async function listPublishedCollectionsWithVariants(
  db: Database,
): Promise<CollectionWithVariants[]> {
  const collections = await db
    .select()
    .from(schema.collections)
    .where(eq(schema.collections.status, 'published'))
    .orderBy(asc(schema.collections.title));

  const variants = await db
    .select()
    .from(schema.variants)
    .where(eq(schema.variants.status, 'published'))
    .orderBy(asc(schema.variants.variantNumber));

  // Only published tasks count — a `needs_review` slot is not something
  // a student can open (see tasks/repo.getTaskById).
  const slotFilter = and(
    eq(schema.variants.status, 'published'),
    eq(schema.tasks.status, 'published'),
  );
  const perVariant = await db
    .select({ variantId: schema.variantTasks.variantId, taskCount: count() })
    .from(schema.variantTasks)
    .innerJoin(schema.variants, eq(schema.variantTasks.variantId, schema.variants.id))
    .innerJoin(schema.tasks, eq(schema.variantTasks.taskId, schema.tasks.id))
    .where(slotFilter)
    .groupBy(schema.variantTasks.variantId);
  const perCollection = await db
    .select({
      collectionId: schema.variants.collectionId,
      taskCount: countDistinct(schema.variantTasks.taskId),
      variantTaskCount: count(),
      taskNumbers: sql<
        number[]
      >`array_agg(distinct ${schema.tasks.taskNumber} order by ${schema.tasks.taskNumber})`,
    })
    .from(schema.variantTasks)
    .innerJoin(schema.variants, eq(schema.variantTasks.variantId, schema.variants.id))
    .innerJoin(schema.tasks, eq(schema.variantTasks.taskId, schema.tasks.id))
    .where(slotFilter)
    .groupBy(schema.variants.collectionId);

  const variantCounts = new Map(perVariant.map((r) => [r.variantId, r.taskCount]));
  const collectionCounts = new Map(perCollection.map((r) => [r.collectionId, r]));

  return collections.map((collection) => {
    const totals = collectionCounts.get(collection.id);
    return {
      collection,
      variants: variants
        .filter((v) => v.collectionId === collection.id)
        .map((v) => ({ ...v, taskCount: variantCounts.get(v.id) ?? 0 })),
      taskCount: totals?.taskCount ?? 0,
      variantTaskCount: totals?.variantTaskCount ?? 0,
      taskNumbers: (totals?.taskNumbers ?? []).map(Number),
    };
  });
}
