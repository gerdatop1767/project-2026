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
import { r36Variants } from './russianDoshchinsky36/index.js';
import type { R36Variant } from './russianDoshchinsky36/types.js';
import * as schema from './schema.js';

/**
 * «ЕГЭ. Русский язык: типовые экзаменационные варианты: 36 вариантов»
 * (Р. А. Дощинский и др., под ред. Р. А. Дощинского, «Национальное
 * образование», 2027; 336 с.). Tasks 1–26 of every variant; task 27
 * (сочинение) is not part of this import.
 *
 * A separate collection from `ege-2027-doshchinskiy-russian` (Variants
 * 1–18 imported earlier from other PDFs): the texts and tasks differ, so
 * nothing there is overwritten. Answers come from the book's own key
 * (PDF pages 308–325), alternatives («<или>») go to `acceptedAnswers`,
 * «любая другая последовательность этих цифр» to
 * `digitSetOrderInsensitive`. Task texts were transcribed from the OCR
 * and checked against the page scans; explanations are written for this
 * project. A task the transcription or the key could not confirm is
 * `needs_review` and stays hidden from students (see `reviewReason`).
 *
 * Runs in `infra/docker-compose.yml`'s sync-content chain after the
 * 18-variant Дощинский importers. The import itself (validation, one
 * transaction, idempotent upserts, user data untouched) is the shared
 * `russianBook/importBook.ts`.
 */
export const R36_SOURCE = 'Дощинский ЕГЭ 2027. Русский язык. 36 типовых экзаменационных вариантов';
export const R36_COLLECTION_SLUG = 'ege-2027-doshchinskiy-russian-36';
/** Variants the book has; the import refuses to run on anything else. */
export const R36_VARIANT_COUNT = 36;

export const R36_CONFIG: RussianBookConfig = {
  label: '«36 вариантов»',
  source: R36_SOURCE,
  year: 2027,
  importTag: 'ege-russian-2027-doshchinskiy-36',
  collectionSlug: R36_COLLECTION_SLUG,
  collectionTitle: 'ЕГЭ 2027 Дощинский — Русский язык, 36 вариантов',
  publisher: 'Дощинский',
  passageSlugPrefix: 'r36',
  variantTitle: (n) => `ЕГЭ 2027 — Дощинский, 36 вариантов — Вариант ${n}`,
  variantCount: R36_VARIANT_COUNT,
  tasksPerVariant: 26,
};

/**
 * Checks the whole data set before anything is written, so a broken or
 * incomplete build fails loudly instead of importing part of the book.
 */
export function validateR36Variants(variants: readonly R36Variant[]): void {
  validateBookVariants(R36_CONFIG, variants);
}

export async function importRussianDoshchinsky36(
  db: Database,
  variants: readonly R36Variant[] = r36Variants,
) {
  return importRussianBook(db, R36_CONFIG, variants, {
    requireAllVariants: variants === r36Variants,
  });
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is not set');
  const client = postgres(databaseUrl, { max: 1 });
  try {
    const r = await importRussianDoshchinsky36(drizzle(client, { schema }));
    console.log(describeBookImport(R36_CONFIG, r));
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
