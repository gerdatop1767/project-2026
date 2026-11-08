import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import type { Database } from './client.js';
import { isMainModule } from './isMainModule.js';
import {
  describeBookImport,
  importRussianBook,
  type RussianBookConfig,
  validateBookVariants,
} from './russianBook/importBook.js';
import type { RussianBookVariant } from './russianBook/types.js';
import { r26Variants } from './russianDoshchinsky2026/index.js';
import * as schema from './schema.js';

/**
 * «ЕГЭ 2026. Русский язык. Типовые экзаменационные варианты: 36 вариантов»
 * (под ред. Р. А. Дощинского, «Национальное образование», 2026). All 27
 * tasks of every variant: tasks 1–26 with the answers of the book's own
 * key (PDF pages 315–332; «<или>» alternatives → `acceptedAnswers`,
 * «любая другая последовательность этих цифр» → `digitSetOrderInsensitive`),
 * task 27 (сочинение) as an `essay` with the book's problem and author's
 * position («Информация о текстах», PDF pages 333–338) and an example essay
 * written for the project.
 *
 * A separate collection and source from the 2027 book and from the earlier
 * 18 Дощинский variants: rows of other books are never matched or changed.
 * The import itself (validation, one transaction, idempotent upserts, user
 * data untouched) is the shared `russianBook/importBook.ts`.
 */
export const R26_SOURCE = 'Дощинский ЕГЭ 2026. Русский язык. 36 типовых экзаменационных вариантов';
export const R26_COLLECTION_SLUG = 'ege-2026-doshchinskiy-russian-36';
export const R26_VARIANT_COUNT = 36;

export const R26_CONFIG: RussianBookConfig = {
  label: '«36 вариантов» 2026',
  source: R26_SOURCE,
  year: 2026,
  importTag: 'ege-russian-2026-doshchinskiy-36',
  collectionSlug: R26_COLLECTION_SLUG,
  collectionTitle: 'ЕГЭ 2026 Дощинский — Русский язык, 36 вариантов',
  publisher: 'Дощинский',
  passageSlugPrefix: 'r26',
  variantTitle: (n) => `ЕГЭ 2026 — Дощинский, 36 вариантов — Вариант ${n}`,
  variantCount: R26_VARIANT_COUNT,
  tasksPerVariant: 27,
};

export function validateR26Variants(variants: readonly RussianBookVariant[]): void {
  validateBookVariants(R26_CONFIG, variants);
}

export async function importRussianDoshchinsky2026Book36(
  db: Database,
  variants: readonly RussianBookVariant[] = r26Variants,
) {
  return importRussianBook(db, R26_CONFIG, variants, {
    requireAllVariants: variants === r26Variants,
  });
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is not set');
  const client = postgres(databaseUrl, { max: 1 });
  try {
    const r = await importRussianDoshchinsky2026Book36(drizzle(client, { schema }));
    console.log(describeBookImport(R26_CONFIG, r));
  } finally {
    await client.end();
  }
}

if (isMainModule(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
