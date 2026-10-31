import { z } from 'zod';
import { taskPublicSchema } from './tasks.js';

/**
 * A collection (e.g. "ЕГЭ 2026 Ященко") and its variants — the S3.2
 * membership layer above `tasks` (docs/PRODUCTION_DATA_MODEL.md). Never
 * carries the tasks themselves; see `variantDetailSchema` for that.
 */
export const collectionPublicSchema = z.object({
  id: z.uuid(),
  subjectId: z.string(),
  slug: z.string(),
  title: z.string(),
  publisher: z.string().nullable(),
  year: z.number().int().nullable(),
  description: z.string().nullable(),
  /** False: an edition with its own task numbering (ЕГЭ 2027) — not in
   * «Все источники», trained only when chosen explicitly. */
  inAllSources: z.boolean().optional(),
  /** Exam format of its variants (scoring rules), or null. */
  examFormat: z.string().nullable().optional(),
});
export type CollectionPublic = z.infer<typeof collectionPublicSchema>;

export const variantPublicSchema = z.object({
  id: z.uuid(),
  collectionId: z.uuid(),
  variantNumber: z.number().int().positive(),
  title: z.string(),
  year: z.number().int().nullable(),
});
export type VariantPublic = z.infer<typeof variantPublicSchema>;

/** One task's slot inside a full variant — `position` is the exam's own
 * order (1..N) and is never reshuffled; see checkAnswer's caller for
 * where shuffle applies instead (practice/random queries only). */
export const variantTaskItemSchema = z.object({
  position: z.number().int().positive(),
  task: taskPublicSchema,
});
export type VariantTaskItem = z.infer<typeof variantTaskItemSchema>;

/** GET /api/v1/variants/:id response — the full ordered exam. Only
 * published variants/collections/tasks ever reach this shape; anything
 * else is a 404, enforced server-side, never left to the client. */
export const variantDetailSchema = z.object({
  variant: variantPublicSchema,
  collection: collectionPublicSchema,
  tasks: z.array(variantTaskItemSchema),
});
export type VariantDetail = z.infer<typeof variantDetailSchema>;

/** GET /api/v1/collections response item — a collection plus its
 * published variants (id/number/title only, no tasks) so a "Сборник"
 * picker can list a collection's available variants without a second
 * round-trip per collection. */
export const collectionListItemSchema = z.object({
  collection: collectionPublicSchema,
  variants: z.array(variantPublicSchema),
});
export type CollectionListItem = z.infer<typeof collectionListItemSchema>;

export const collectionListResponseSchema = z.object({
  items: z.array(collectionListItemSchema),
});
export type CollectionListResponse = z.infer<typeof collectionListResponseSchema>;
