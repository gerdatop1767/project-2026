import type { Database } from '@zybrilka/db';
import { sql } from 'drizzle-orm';
import { changePercent, type Period } from '../period.js';
import {
  bucketExpr,
  fillSeries,
  guestAnswers,
  one,
  partialFor,
  registeredAttempts,
  registeredUsers,
  rows,
  trackingSince,
} from './common.js';

const ts = (d: Date) => sql`${d.toISOString()}::timestamptz`;

/**
 * Аналитика и рост. Per bucket (day/week/month, Moscow):
 * - registrations, and total registered users at the end of the bucket;
 * - active registered users / active guests (≥1 checked answer);
 * - first training (a user's first-ever attempt falls in the bucket),
 *   first solve (first-ever correct attempt);
 * - returning users: active in the bucket AND active on an earlier Moscow
 *   day before the bucket started.
 */
export async function growthReport(db: Database, period: Period) {
  const g = period.granularity;
  const s = ts(period.startUtc);
  const e = ts(period.endUtc);
  const since = await trackingSince(db);

  const regs = await rows<{ bucket: string; registrations: number }>(
    db,
    sql`SELECT ${bucketExpr(sql`r.created_at`, g)} AS bucket, count(*)::int AS registrations
      FROM ${registeredUsers} r WHERE r.created_at >= ${s} AND r.created_at < ${e} GROUP BY 1`,
  );
  const active = await rows<{ bucket: string; activeRegistered: number; returning: number }>(
    db,
    sql`WITH act AS (
        SELECT DISTINCT ${bucketExpr(sql`a.created_at`, g)} AS bucket, a.user_id
        FROM ${registeredAttempts} a WHERE a.created_at >= ${s} AND a.created_at < ${e}
      ), firsts AS (
        SELECT a.user_id, min(a.created_at) AS first_at FROM ${registeredAttempts} a GROUP BY a.user_id
      )
      SELECT act.bucket, count(*)::int AS "activeRegistered",
        count(*) FILTER (WHERE ${bucketExpr(sql`f.first_at`, g)} < act.bucket)::int AS "returning"
      FROM act JOIN firsts f ON f.user_id = act.user_id GROUP BY act.bucket`,
  );
  const firsts = await rows<{ bucket: string; firstTraining: number }>(
    db,
    sql`SELECT ${bucketExpr(sql`f.first_at`, g)} AS bucket, count(*)::int AS "firstTraining"
      FROM (SELECT a.user_id, min(a.created_at) AS first_at FROM ${registeredAttempts} a GROUP BY a.user_id) f
      WHERE f.first_at >= ${s} AND f.first_at < ${e} GROUP BY 1`,
  );
  const firstSolves = await rows<{ bucket: string; firstSolve: number }>(
    db,
    sql`SELECT ${bucketExpr(sql`f.first_at`, g)} AS bucket, count(*)::int AS "firstSolve"
      FROM (SELECT a.user_id, min(a.created_at) AS first_at FROM ${registeredAttempts} a WHERE a.is_correct GROUP BY a.user_id) f
      WHERE f.first_at >= ${s} AND f.first_at < ${e} GROUP BY 1`,
  );
  const guests = await rows<{ bucket: string; activeGuests: number; guestVisitors: number }>(
    db,
    sql`SELECT x.bucket, max(x.active)::int AS "activeGuests", max(x.visitors)::int AS "guestVisitors" FROM (
        SELECT ${bucketExpr(sql`g.occurred_at`, g)} AS bucket, count(DISTINCT g.visitor_id) AS active, 0 AS visitors
        FROM ${guestAnswers} g WHERE g.occurred_at >= ${s} AND g.occurred_at < ${e} GROUP BY 1
        UNION ALL
        SELECT ${bucketExpr(sql`v.occurred_at`, g)} AS bucket, 0, count(DISTINCT v.visitor_id)
        FROM analytics_events v WHERE v.type = 'visit' AND v.user_id IS NULL AND v.occurred_at >= ${s} AND v.occurred_at < ${e} GROUP BY 1
      ) x GROUP BY x.bucket`,
  );
  const startTotal = await one<{ n: number }>(
    db,
    sql`SELECT count(*)::int AS n FROM ${registeredUsers} r WHERE r.created_at < ${s}`,
  );

  const fRegs = fillSeries(period, g, regs, ['registrations'] as const);
  const fActive = fillSeries(period, g, active, ['activeRegistered', 'returning'] as const);
  const fFirst = fillSeries(period, g, firsts, ['firstTraining'] as const);
  const fSolve = fillSeries(period, g, firstSolves, ['firstSolve'] as const);
  const fGuests = fillSeries(period, g, guests, ['activeGuests', 'guestVisitors'] as const);
  let running = startTotal.n;
  const series = fRegs.map((point, i) => {
    running += point.registrations;
    return {
      ...point,
      totalUsers: running,
      ...fActive[i]!,
      ...fFirst[i]!,
      ...fSolve[i]!,
      ...fGuests[i]!,
    };
  });

  const registrations = series.reduce((sum, p) => sum + p.registrations, 0);
  const prev = await one<{ n: number }>(
    db,
    sql`SELECT count(*)::int AS n FROM ${registeredUsers} r WHERE r.created_at >= ${ts(period.previous.startUtc)} AND r.created_at < ${ts(period.previous.endUtc)}`,
  );

  const byMethod = await rows<{ method: string; registrations: number }>(
    db,
    sql`SELECT coalesce(fi.provider, 'unknown') AS method, count(*)::int AS registrations
      FROM ${registeredUsers} r
      LEFT JOIN LATERAL (SELECT ai.provider FROM auth_identities ai WHERE ai.user_id = r.id ORDER BY ai.created_at LIMIT 1) fi ON true
      WHERE r.created_at >= ${s} AND r.created_at < ${e} GROUP BY 1 ORDER BY 2 DESC`,
  );
  const bySource = await rows<{ source: string; channel: string | null; registrations: number }>(
    db,
    sql`SELECT coalesce(c.source, 'unknown') AS source, c.channel, count(*)::int AS registrations
      FROM ${registeredUsers} r
      LEFT JOIN user_attributions ua ON ua.user_id = r.id
      LEFT JOIN campaigns c ON c.id = ua.campaign_id
      WHERE r.created_at >= ${s} AND r.created_at < ${e} GROUP BY 1, 2 ORDER BY 3 DESC`,
  );
  const bySubject = await rows<{
    subjectId: string;
    name: string;
    activeUsers: number;
    answers: number;
  }>(
    db,
    sql`SELECT s.id AS "subjectId", s.name, count(DISTINCT a.user_id)::int AS "activeUsers", count(a.id)::int AS answers
      FROM subjects s
      LEFT JOIN tasks t ON t.subject_id = s.id
      LEFT JOIN ${registeredAttempts} a ON a.task_id = t.id AND a.created_at >= ${s} AND a.created_at < ${e}
      GROUP BY s.id, s.name ORDER BY answers DESC, s.name`,
  );

  return {
    trackingSince: since,
    guestData: partialFor(period, since),
    totals: {
      registrations,
      previousRegistrations: prev.n,
      growthPercent: changePercent(registrations, prev.n),
      totalUsersAtEnd: running,
      totalUsersAtStart: startTotal.n,
      userBaseGrowthPercent: changePercent(running, startTotal.n),
    },
    series,
    byMethod,
    bySource,
    bySubject,
  };
}
