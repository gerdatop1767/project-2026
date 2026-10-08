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

// Same, plus Вариант 2, 3, 4, 5, 6, 7 and 8 — for tests that need the
// real N×19 matrix (same taskNumber present across multiple variants)
// to exist, e.g. the Similar Tasks hard-filter regression test on real
// imported data.
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
  return testDb;
}
