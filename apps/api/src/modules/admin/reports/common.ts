import { sql, type SQL } from 'drizzle-orm';
import type { Database } from '@zybrilka/db';
import { bucketOf, bucketStarts, type Period, type Range } from '../period.js';
import { one, rows } from '../sql.js';

/**
 * Shared definitions for every admin report (docs/ADMIN.md §Определения).
 *
 * - REGISTERED user: a `users` row with at least one sign-in identity
 *   (`auth_identities`). Rows without one are leftovers of the pre-auth
 *   anonymous mode; they are never counted as users and their attempts are
 *   left out of every user/answer metric (reported once, as a data note).
 * - ANSWER (checked): one row in `attempts` (signed in, history since
 *   launch) or one `answer_checked` event with no user (a guest, recorded
 *   only since analytics tracking started).
 * - ACTIVE: did at least one checked answer that Moscow day/period.
 * - A guest is a visitor (browser cookie), never a user.
 */
export const MSK = sql.raw(`'Europe/Moscow'`);

/** `attempts` rows of registered users only. */
export const registeredAttempts = sql`(SELECT a.* FROM attempts a WHERE a.user_id IN (SELECT user_id FROM auth_identities))`;

/** Registered users with their registration time. */
export const registeredUsers = sql`(SELECT u.id, u.created_at FROM users u WHERE EXISTS (SELECT 1 FROM auth_identities ai WHERE ai.user_id = u.id))`;

/** Guest answer checks (events without a user). */
export const guestAnswers = sql`(SELECT e.* FROM analytics_events e WHERE e.type = 'answer_checked' AND e.user_id IS NULL)`;

export function mskDate(column: SQL): SQL {
  return sql`((${column}) AT TIME ZONE ${MSK})::date`;
}

/** SQL expression bucketing a timestamp column into the period's granularity, as text YYYY-MM-DD. */
export function bucketExpr(column: SQL, granularity: Period['granularity']): SQL {
  const day = mskDate(column);
  if (granularity === 'day') return sql`(${day})::text`;
  if (granularity === 'month') return sql`date_trunc('month', ${day})::date::text`;
  return sql`date_trunc('week', ${day})::date::text`;
}

export interface SeriesPoint {
  bucket: string;
  [key: string]: number | string | null;
}

/** Fills a sparse `{bucket → values}` result into the full list of buckets (zeros for empty ones). */
export function fillSeries<K extends string>(
  range: Range,
  granularity: Period['granularity'],
  sparse: ({ bucket: string } & Record<K, number>)[],
  keys: readonly K[],
): ({ bucket: string } & Record<K, number>)[] {
  const byBucket = new Map(sparse.map((row) => [bucketOf(row.bucket, granularity), row]));
  return bucketStarts(range, granularity).map((bucket) => {
    const found = byBucket.get(bucket);
    const point = { bucket } as { bucket: string } & Record<K, number>;
    for (const key of keys)
      (point as Record<string, unknown>)[key] = found ? Number(found[key]) : 0;
    return point;
  });
}

/** When analytics events started being recorded (null = nothing recorded yet). */
export async function trackingSince(db: Database): Promise<string | null> {
  const row = await one<{ since: string | null }>(
    db,
    sql`SELECT min(occurred_at)::text AS since FROM analytics_events`,
  );
  return row.since;
}

/** Whether guest/event numbers cover the whole range, part of it (tracking
 * started inside it) or none of it (the range is before tracking began). */
export function partialFor(range: Range, since: string | null): 'none' | 'partial' | 'full' {
  if (!since) return 'none';
  const start = new Date(since).getTime();
  if (start >= range.endUtc.getTime()) return 'none';
  return start > range.startUtc.getTime() ? 'partial' : 'full';
}

export { one, rows };
