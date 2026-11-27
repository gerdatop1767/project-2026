import { and, count, eq } from 'drizzle-orm';
import type { Database } from '../client.js';
import * as schema from '../schema.js';

/**
 * One source for every authored Zybrilka Russian task (№4–22, №10
 * included): the «Источник» picker shows a single «Зубрилка — авторские
 * задания» with all numbers inside, instead of one source per number.
 *
 * Sets keep their ids. A set that still sits in the old per-number
 * collection (`zybrilka-russian-N`, how the bank was first imported) is
 * moved here, not recreated: variant sessions point at variant ids. An old
 * collection left with no sets is archived, never deleted.
 */
export const ZR_COLLECTION_SLUG = 'zybrilka-russian';
export const ZR_COLLECTION_YEAR = 2027;
const ZR_COLLECTION = {
  title: 'Зубрилка — авторские задания по русскому языку',
  publisher: 'Зубрилка',
  description:
    'Задания составлены командой Зубрилки по образцу заданий №4–22 ЕГЭ по русскому языку. Это не материалы ФИПИ и не задания из сборников. По 100 заданий на каждый номер, в наборах по 10, к каждому — подробный разбор.',
  year: ZR_COLLECTION_YEAR,
};
const SET_SOURCE_FILE = 'Авторские задания Зубрилки';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/** The old per-number collection a set may still be in. */
export const legacyCollectionSlug = (taskNumber: number) => `zybrilka-russian-${taskNumber}`;
/** Sets of all numbers share one collection: №4 set 1 is 401, №22 set 10 is 2210. */
export const zrSetNumber = (taskNumber: number, set: number) => taskNumber * 100 + set;
export const zrSetTitle = (taskNumber: number, set: number) =>
  `Зубрилка — №${taskNumber}, набор ${set}`;

export async function ensureZrCollection(tx: Tx): Promise<string> {
  const [collection] = await tx
    .insert(schema.collections)
    .values({
      subjectId: 'russian',
      slug: ZR_COLLECTION_SLUG,
      ...ZR_COLLECTION,
      status: 'published',
      inAllSources: true,
      examFormat: null,
    })
    .onConflictDoUpdate({ target: schema.collections.slug, set: ZR_COLLECTION })
    .returning({ id: schema.collections.id });
  return collection!.id;
}

/** The id of set `set` of task `taskNumber` in the one collection: found, moved there, or created. */
export async function ensureZrSet(
  tx: Tx,
  collectionId: string,
  taskNumber: number,
  set: number,
): Promise<string> {
  const variantNumber = zrSetNumber(taskNumber, set);
  const title = zrSetTitle(taskNumber, set);
  const [here] = await tx
    .select({ id: schema.variants.id, title: schema.variants.title })
    .from(schema.variants)
    .where(
      and(
        eq(schema.variants.collectionId, collectionId),
        eq(schema.variants.variantNumber, variantNumber),
      ),
    );
  if (here) {
    if (here.title !== title)
      await tx
        .update(schema.variants)
        .set({ title, updatedAt: new Date() })
        .where(eq(schema.variants.id, here.id));
    return here.id;
  }
  const [legacy] = await tx
    .select({ id: schema.variants.id })
    .from(schema.variants)
    .innerJoin(schema.collections, eq(schema.collections.id, schema.variants.collectionId))
    .where(
      and(
        eq(schema.collections.slug, legacyCollectionSlug(taskNumber)),
        eq(schema.variants.variantNumber, set),
      ),
    );
  if (legacy) {
    await tx
      .update(schema.variants)
      .set({ collectionId, variantNumber, title, updatedAt: new Date() })
      .where(eq(schema.variants.id, legacy.id));
    return legacy.id;
  }
  const [created] = await tx
    .insert(schema.variants)
    .values({
      collectionId,
      variantNumber,
      title,
      year: ZR_COLLECTION_YEAR,
      status: 'published',
      sourceFile: SET_SOURCE_FILE,
    })
    .returning({ id: schema.variants.id });
  return created!.id;
}

/** Archives the old per-number collection once all its sets have moved out. */
export async function retireLegacyCollection(tx: Tx, taskNumber: number): Promise<void> {
  const [old] = await tx
    .select({ id: schema.collections.id, status: schema.collections.status })
    .from(schema.collections)
    .where(eq(schema.collections.slug, legacyCollectionSlug(taskNumber)));
  if (!old || old.status === 'archived') return;
  const [left] = await tx
    .select({ n: count() })
    .from(schema.variants)
    .where(eq(schema.variants.collectionId, old.id));
  if ((left?.n ?? 0) === 0)
    await tx
      .update(schema.collections)
      .set({ status: 'archived', updatedAt: new Date() })
      .where(eq(schema.collections.id, old.id));
}
