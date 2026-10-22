import type { Database } from '@zybrilka/db';
import type { SQL } from 'drizzle-orm';

/**
 * Runs a raw aggregate query and returns its rows. The production driver
 * (postgres-js) returns the rows themselves, PGlite (tests) `{ rows }`.
 * Queries must cast every value to a JS-safe type in SQL (`::int`,
 * `::float8`, `::text`) so both drivers return the same shapes.
 */
export async function rows<T>(db: Database, query: SQL): Promise<T[]> {
  const result = (await db.execute(query)) as unknown;
  if (Array.isArray(result)) return result as T[];
  return ((result as { rows?: T[] }).rows ?? []) as T[];
}

export async function one<T>(db: Database, query: SQL): Promise<T> {
  const [row] = await rows<T>(db, query);
  if (!row) throw new Error('aggregate query returned no row');
  return row;
}
