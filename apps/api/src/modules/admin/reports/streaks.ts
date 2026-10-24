import type { Database } from '@zybrilka/db';
import { STREAK_TIERS } from '@zybrilka/shared';
import { sql } from 'drizzle-orm';
import { moscowDate, type Period } from '../period.js';
import { one, rows } from './common.js';

/**
 * Серии (docs/ADMIN.md §Серии). Everything is derived from
 * `user_daily_activity` — the same table the app's own streak is computed
 * from (one row per user per Moscow day with ≥1 answer) — so the admin
 * numbers can never disagree with what users see in the header.
 *
 * A user's activity splits into "runs" of consecutive days. The current
 * streak follows the app's rule (packages/shared learning/streak.ts): the
 * run that ends today or yesterday, else 0. The best streak is the longest
 * run ever. «Streak as of day D» (for the dynamics) is the same rule applied
 * on day D. Registered accounts only. Tier ranges come from
 * @zybrilka/shared STREAK_TIERS (1–4, 5–14, 15–29, 30–39, 40–59, 60+).
 */
const runsSql = sql`
  WITH days AS (
    SELECT a.user_id, a.activity_date::date AS d
    FROM user_daily_activity a
    WHERE a.user_id IN (SELECT user_id FROM auth_identities)
  ), grouped AS (
    SELECT user_id, d, d - (row_number() OVER (PARTITION BY user_id ORDER BY d))::int AS grp FROM days
  )
  SELECT user_id, min(d) AS start_d, max(d) AS end_d, count(*)::int AS len
  FROM grouped GROUP BY user_id, grp`;

const tierCase = (col: ReturnType<typeof sql.raw> | ReturnType<typeof sql>) =>
  sql.join(
    [
      sql`CASE`,
      ...STREAK_TIERS.map((t) =>
        t.max === null
          ? sql`WHEN ${col} >= ${t.min} THEN ${t.tier}`
          : sql`WHEN ${col} BETWEEN ${t.min} AND ${t.max} THEN ${t.tier}`,
      ),
      sql`ELSE 0 END`,
    ],
    sql` `,
  );

export async function streaksReport(db: Database, period: Period, now = new Date()) {
  const today = moscowDate(now);
  const summary = await one<{
    trackedUsers: number;
    active: number;
    avg: number | null;
    median: number | null;
    maxCurrent: number | null;
    maxEver: number | null;
    firstDay: string | null;
  }>(
    db,
    sql`WITH runs AS (${runsSql}),
      current AS (
        SELECT user_id, max(len) FILTER (WHERE end_d >= ${today}::date - 1) AS cur, max(len) AS best
        FROM runs GROUP BY user_id
      )
      SELECT count(*)::int AS "trackedUsers",
        count(*) FILTER (WHERE cur >= 1)::int AS active,
        avg(cur) FILTER (WHERE cur >= 1)::float8 AS avg,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY cur) FILTER (WHERE cur >= 1)::float8 AS median,
        max(cur)::int AS "maxCurrent",
        max(best)::int AS "maxEver",
        (SELECT min(activity_date)::text FROM user_daily_activity) AS "firstDay"
      FROM current`,
  );
  const tiers = await rows<{ tier: number; users: number }>(
    db,
    sql`WITH runs AS (${runsSql}),
      current AS (SELECT user_id, max(len) FILTER (WHERE end_d >= ${today}::date - 1) AS cur FROM runs GROUP BY user_id)
      SELECT ${tierCase(sql`cur`)} AS tier, count(*)::int AS users
      FROM current WHERE cur >= 1 GROUP BY 1 ORDER BY 1`,
  );
  // Dynamics: per Moscow day of the period, users holding a streak that
  // day (active that day or the day before) and their average length.
  const daily = await rows<{ day: string; active: number; avg: number | null; long: number }>(
    db,
    sql`WITH runs AS (${runsSql}),
      span AS (SELECT gs::date AS d FROM generate_series(${period.from}::date, ${period.to}::date, interval '1 day') gs),
      held AS (
        SELECT s.d, r.user_id, max(least(s.d, r.end_d) - r.start_d + 1) AS streak
        FROM span s JOIN runs r ON r.start_d <= s.d AND r.end_d >= s.d - 1
        GROUP BY s.d, r.user_id
      )
      SELECT s.d::text AS day, count(h.user_id)::int AS active, avg(h.streak)::float8 AS avg,
        count(h.user_id) FILTER (WHERE h.streak >= 5)::int AS long
      FROM span s LEFT JOIN held h ON h.d = s.d GROUP BY s.d ORDER BY s.d`,
  );
  const top = await rows<{
    id: string;
    name: string | null;
    current: number;
    best: number;
    lastActive: string;
  }>(
    db,
    sql`WITH runs AS (${runsSql}),
      per AS (
        SELECT user_id, coalesce(max(len) FILTER (WHERE end_d >= ${today}::date - 1), 0) AS cur,
          max(len) AS best, max(end_d) AS last_d
        FROM runs GROUP BY user_id
      )
      SELECT u.id, coalesce(nullif(u.display_name, ''), nullif(trim(concat_ws(' ', u.first_name, u.last_name)), '')) AS name,
        p.cur::int AS current, p.best::int AS best, p.last_d::text AS "lastActive"
      FROM per p JOIN users u ON u.id = p.user_id
      WHERE p.cur >= 1
      ORDER BY p.cur DESC, p.best DESC, u.id LIMIT 20`,
  );
  const byTier = new Map(tiers.map((t) => [t.tier, t.users]));
  return {
    today,
    source: 'user_daily_activity',
    historySince: summary.firstDay,
    totals: {
      trackedUsers: summary.trackedUsers,
      activeStreaks: summary.active,
      averageCurrent: summary.avg === null ? null : Math.round(summary.avg * 10) / 10,
      medianCurrent: summary.median,
      longestCurrent: summary.maxCurrent,
      longestEver: summary.maxEver,
    },
    tiers: STREAK_TIERS.map((t) => ({
      tier: t.tier,
      label: t.label,
      users: byTier.get(t.tier) ?? 0,
    })),
    daily: daily.map((d) => ({
      day: d.day.slice(0, 10),
      active: d.active,
      averageStreak: d.avg === null ? null : Math.round(d.avg * 10) / 10,
      fivePlus: d.long,
    })),
    top,
  };
}
