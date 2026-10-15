import type { Database } from '@zybrilka/db';
import type { CollectionPublic, VariantDetail, VariantPublic } from '@zybrilka/shared';
import { toPublicTask } from '../tasks/service.js';
import * as repo from './repo.js';

function toVariantPublic(row: repo.VariantWithCollection['variant']): VariantPublic {
  return {
    id: row.id,
    collectionId: row.collectionId,
    variantNumber: row.variantNumber,
    title: row.title,
    year: row.year,
  };
}

function toCollectionPublic(row: repo.VariantWithCollection['collection']): CollectionPublic {
  return {
    id: row.id,
    subjectId: row.subjectId,
    slug: row.slug,
    title: row.title,
    publisher: row.publisher,
    year: row.year,
    description: row.description,
  };
}

/**
 * The full ordered exam view (§18/§20): a published variant's
 * published tasks in exam order, each in the same never-leaks-the-
 * answer shape as every other public task listing. Undefined for a
 * missing, draft, archived, or needs_review-only variant — the route
 * maps that to a 404, same as any other not-found.
 */
export async function getVariantDetail(
  db: Database,
  id: string,
): Promise<VariantDetail | undefined> {
  const row = await repo.getPublishedVariantById(db, id);
  if (!row) return undefined;
  return buildVariantDetail(db, row);
}

/**
 * Same shape as `getVariantDetail`, but resolved from a taskId instead
 * of a variantId — for a caller (the web app's task navigation) that
 * knows "this task, in this collection" but not which variant that
 * implies. `collectionSlug` isolates the result to one source; leaving
 * it out matches any collection the task happens to belong to.
 * Undefined when the task isn't part of any published variant
 * (matching) — e.g. a task reached outside any collection/variant
 * context at all.
 */
export async function getVariantDetailForTask(
  db: Database,
  taskId: string,
  collectionSlug?: string,
): Promise<VariantDetail | undefined> {
  const row = await repo.getVariantForTask(db, taskId, collectionSlug);
  if (!row) return undefined;
  return buildVariantDetail(db, row);
}

async function buildVariantDetail(
  db: Database,
  row: repo.VariantWithCollection,
): Promise<VariantDetail> {
  const taskRows = await repo.listVariantTasks(db, row.variant.id);
  return {
    variant: toVariantPublic(row.variant),
    collection: toCollectionPublic(row.collection),
    tasks: taskRows.map((t) => ({
      position: t.position,
      task: toPublicTask({ task: t.task, topicName: t.topicName, passage: t.passage }),
    })),
  };
}
