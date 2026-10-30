import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { migrationsFolder } from './migrate.js';
import { seed } from './seed.js';
import { importVariant1 } from './importEge2026Variant1.js';
import { importVariant2 } from './importEge2026Variant2.js';
import { importVariant3 } from './importEge2026Variant3.js';
import { importVariant4 } from './importEge2026Variant4.js';
import { importVariant5 } from './importEge2026Variant5.js';
import { importVariant6 } from './importEge2026Variant6.js';
import { importVariant7 } from './importEge2026Variant7.js';
import { importVariant8 } from './importEge2026Variant8.js';
import { importVariant9 } from './importEge2026Variant9.js';
import { importVariant10 } from './importEge2026Variant10.js';
import { importVariant1 as importYashchenko2027Variant1 } from './importEge2027YashchenkoVariant1.js';
import { importVariant2 as importYashchenko2027Variant2 } from './importEge2027YashchenkoVariant2.js';
import { importVariant3 as importYashchenko2027Variant3 } from './importEge2027YashchenkoVariant3.js';
import { importVariant4 as importYashchenko2027Variant4 } from './importEge2027YashchenkoVariant4.js';
import { importVariant5 as importYashchenko2027Variant5 } from './importEge2027YashchenkoVariant5.js';
import { importVariant6 as importYashchenko2027Variant6 } from './importEge2027YashchenkoVariant6.js';
import { importVariant7 as importYashchenko2027Variant7 } from './importEge2027YashchenkoVariant7.js';
import { importVariant8 as importYashchenko2027Variant8 } from './importEge2027YashchenkoVariant8.js';
import { importVariant9 as importYashchenko2027Variant9 } from './importEge2027YashchenkoVariant9.js';
import { importVariant10 as importYashchenko2027Variant10 } from './importEge2027YashchenkoVariant10.js';
import { importVariant11 as importYashchenko2027Variant11 } from './importEge2027YashchenkoVariant11.js';
import { importVariant12 as importYashchenko2027Variant12 } from './importEge2027YashchenkoVariant12.js';
import { importVariant13 as importYashchenko2027Variant13 } from './importEge2027YashchenkoVariant13.js';
import { importVariant14 as importYashchenko2027Variant14 } from './importEge2027YashchenkoVariant14.js';
import { importVariant15 as importYashchenko2027Variant15 } from './importEge2027YashchenkoVariant15.js';
import * as schema from './schema.js';

// In-memory Postgres (PGlite) with all migrations applied. Tests only.
export async function createTestDb() {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
  return { db, close: () => client.close() };
}

// Same, plus the demo task-engine seed — for API/web tests that need
// real tasks to exist rather than asserting against an empty catalog.
export async function createSeededTestDb() {
  const testDb = await createTestDb();
  await seed(testDb.db);
  return testDb;
}

// Same, plus the real EGE-2026 Вариант 1 import — for tests that need
// real imported tasks (with provenance/needs_review rows) to exist.
export async function createImportedTestDb() {
  const testDb = await createTestDb();
  await seed(testDb.db);
  await importVariant1(testDb.db);
  return testDb;
}

// Same, plus Вариант 2-10 — for tests that need the real N×19 matrix
// (same taskNumber present across multiple variants) to exist, e.g. the
// Similar Tasks hard-filter regression test on real imported data.
export async function createImportedVariantsTestDb() {
  const testDb = await createTestDb();
  await seed(testDb.db);
  await importVariant1(testDb.db);
  await importVariant2(testDb.db);
  await importVariant3(testDb.db);
  await importVariant4(testDb.db);
  await importVariant5(testDb.db);
  await importVariant6(testDb.db);
  await importVariant7(testDb.db);
  await importVariant8(testDb.db);
  await importVariant9(testDb.db);
  await importVariant10(testDb.db);
  return testDb;
}

// Вариант 1 of 2026 next to the separate «ЕГЭ 2027 Ященко» source
// (Вариант 1-2, kept out of «Все источники») — for tests of the
// edition separation: filters, counts, similar tasks, scoring.
export async function createImported2027TestDb() {
  const testDb = await createImportedTestDb();
  await importYashchenko2027Variant1(testDb.db);
  await importYashchenko2027Variant2(testDb.db);
  await importYashchenko2027Variant3(testDb.db);
  await importYashchenko2027Variant4(testDb.db);
  await importYashchenko2027Variant5(testDb.db);
  await importYashchenko2027Variant6(testDb.db);
  await importYashchenko2027Variant7(testDb.db);
  await importYashchenko2027Variant8(testDb.db);
  await importYashchenko2027Variant9(testDb.db);
  await importYashchenko2027Variant10(testDb.db);
  await importYashchenko2027Variant11(testDb.db);
  await importYashchenko2027Variant12(testDb.db);
  await importYashchenko2027Variant13(testDb.db);
  await importYashchenko2027Variant14(testDb.db);
  await importYashchenko2027Variant15(testDb.db);
  return testDb;
}
