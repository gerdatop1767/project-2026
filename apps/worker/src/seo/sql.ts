import type { Database } from '@zybrilka/db';
import type { SQL } from 'drizzle-orm';

/** Raw query rows for both drivers (postgres-js returns an array, PGlite `{ rows }`). */
export async function rows<T>(db: Database, query: SQL): Promise<T[]> {
  const result = (await db.execute(query)) as unknown;
  if (Array.isArray(result)) return result as T[];
  return ((result as { rows?: T[] }).rows ?? []) as T[];
}
