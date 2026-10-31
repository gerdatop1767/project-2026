import type { Database } from '@zybrilka/db';
import type { CollectionListResponse, CollectionPublic, VariantPublic } from '@zybrilka/shared';
import * as repo from './repo.js';

function toCollectionPublic(row: repo.CollectionRow): CollectionPublic {
  return {
    id: row.id,
    subjectId: row.subjectId,
    slug: row.slug,
    title: row.title,
    publisher: row.publisher,
    year: row.year,
    description: row.description,
    inAllSources: row.inAllSources,
    examFormat: row.examFormat,
  };
}

function toVariantPublic(row: repo.VariantRow & { taskCount: number }): VariantPublic {
  return {
    id: row.id,
    collectionId: row.collectionId,
    variantNumber: row.variantNumber,
    title: row.title,
    year: row.year,
    taskCount: row.taskCount,
  };
}

export async function listCollections(db: Database): Promise<CollectionListResponse> {
  const rows = await repo.listPublishedCollectionsWithVariants(db);
  return {
    items: rows.map((row) => ({
      collection: toCollectionPublic(row.collection),
      variants: row.variants.map(toVariantPublic),
      taskCount: row.taskCount,
      variantTaskCount: row.variantTaskCount,
      taskNumbers: row.taskNumbers,
    })),
  };
}
