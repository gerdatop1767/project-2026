import type { Database } from '@zybrilka/db';
import { sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { moscowDate } from '../period.js';
import { one, registeredAttempts, rows } from './common.js';

/**
 * Пользователи — registered accounts only (see common.ts). Never returned:
 * emails, provider user ids, session ids, tokens, entered answers. "Last
 * activity" is the last checked answer or the last time this account's
 * browser was seen by analytics — never "online now".
 */
export const userListQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  segment: z.enum(['all', 'new7', 'active7', 'active30', 'dormant', 'no_solves']).default('all'),
  minSolves: z.coerce
    .number()
    .int()
    .refine((n) => [1, 5, 10, 25, 50, 100].includes(n))
    .optional(),
  subject: z.string().max(32).optional(),
  source: z.string().max(64).optional(),
  registeredFrom: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  registeredTo: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  sort: z
    .enum(['registered', 'lastActivity', 'solves', 'accuracy', 'activeDays'])
    .default('registered'),
  dir: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().min(5).max(100).default(25),
});
export type UserListQuery = z.infer<typeof userListQuerySchema>;

/** The per-user aggregate every list/export row is built from. */
export function userRowsSql(): SQL {
  return sql`SELECT u.id,
      coalesce(nullif(u.display_name, ''), nullif(trim(concat_ws(' ', u.first_name, u.last_name)), '')) AS name,
      u.created_at AS registered_at,
      coalesce(st.attempts, 0)::int AS solves,
      coalesce(st.correct, 0)::int AS correct,
      coalesce(st.attempts, 0)::int - coalesce(st.correct, 0)::int AS incorrect,
      st.first_at, st.last_at,
      greatest(st.last_at, vs.last_seen) AS last_activity,
      coalesce(st.active_days, 0)::int AS active_days,
      (SELECT array_agg(p.subject_id ORDER BY p.subject_id) FROM user_subject_profiles p WHERE p.user_id = u.id) AS subjects,
      coalesce(c.source, 'unknown') AS source, c.name AS campaign,
      (SELECT array_agg(DISTINCT ai.provider) FROM auth_identities ai WHERE ai.user_id = u.id) AS methods
    FROM users u
    LEFT JOIN (
      SELECT a.user_id, count(*) AS attempts, count(*) FILTER (WHERE a.is_correct) AS correct,
        min(a.created_at) AS first_at, max(a.created_at) AS last_at,
        count(DISTINCT (a.created_at AT TIME ZONE 'Europe/Moscow')::date) AS active_days
      FROM ${registeredAttempts} a GROUP BY a.user_id
    ) st ON st.user_id = u.id
    LEFT JOIN (SELECT v.user_id, max(v.last_seen_at) AS last_seen FROM analytics_visitors v WHERE v.user_id IS NOT NULL GROUP BY v.user_id) vs ON vs.user_id = u.id
    LEFT JOIN user_attributions ua ON ua.user_id = u.id
    LEFT JOIN campaigns c ON c.id = ua.campaign_id
    WHERE EXISTS (SELECT 1 FROM auth_identities ai WHERE ai.user_id = u.id)`;
}

export function userFilters(q: UserListQuery, now: Date): SQL {
  const where: SQL[] = [sql`true`];
  const day = 24 * 60 * 60 * 1000;
  const ago = (days: number) =>
    sql`${new Date(now.getTime() - days * day).toISOString()}::timestamptz`;
  if (q.q) {
    if (/^[0-9a-f-]{4,36}$/i.test(q.q)) where.push(sql`x.id::text LIKE ${q.q.toLowerCase() + '%'}`);
    else where.push(sql`x.name ILIKE ${'%' + q.q.replace(/[\\%_]/g, (c) => '\\' + c) + '%'}`);
  }
  switch (q.segment) {
    case 'new7':
      where.push(sql`x.registered_at >= ${ago(7)}`);
      break;
    case 'active7':
      where.push(sql`x.last_at >= ${ago(7)}`);
      break;
    case 'active30':
      where.push(sql`x.last_at >= ${ago(30)}`);
      break;
    case 'dormant':
      where.push(sql`x.solves > 0 AND x.last_at < ${ago(30)}`);
      break;
    case 'no_solves':
      where.push(sql`x.solves = 0`);
      break;
  }
  if (q.minSolves) where.push(sql`x.solves >= ${q.minSolves}`);
  if (q.subject) where.push(sql`${q.subject} = ANY(x.subjects)`);
  if (q.source) where.push(sql`x.source = ${q.source}`);
  if (q.registeredFrom)
    where.push(
      sql`x.registered_at >= (${q.registeredFrom}::date::timestamp AT TIME ZONE 'Europe/Moscow')`,
    );
  if (q.registeredTo)
    where.push(
      sql`x.registered_at < ((${q.registeredTo}::date + 1)::timestamp AT TIME ZONE 'Europe/Moscow')`,
    );
  return sql.join(where, sql` AND `);
}

const listColumns = sql`x.id, x.name, x.registered_at::text AS "registeredAt", x.last_activity::text AS "lastActivity",
  x.subjects, x.solves, x.correct, x.incorrect,
  CASE WHEN x.solves > 0 THEN x.correct::float8 / x.solves END AS accuracy,
  x.active_days AS "activeDays", x.source, x.campaign, x.methods,
  CASE WHEN x.registered_at >= now() - interval '7 days' THEN 'new'
       WHEN x.last_at >= now() - interval '7 days' THEN 'active'
       WHEN x.solves = 0 THEN 'no_solves'
       WHEN x.last_at < now() - interval '30 days' THEN 'dormant'
       ELSE 'idle' END AS status`;

export async function usersListReport(db: Database, q: UserListQuery, now = new Date()) {
  const where = userFilters(q, now);
  const dir = sql.raw(q.dir === 'asc' ? 'ASC' : 'DESC');
  const order = {
    registered: sql`x.registered_at ${dir}`,
    lastActivity: sql`x.last_activity ${dir} NULLS LAST`,
    solves: sql`x.solves ${dir}`,
    accuracy: sql`(CASE WHEN x.solves > 0 THEN x.correct::float8 / x.solves END) ${dir} NULLS LAST`,
    activeDays: sql`x.active_days ${dir}`,
  }[q.sort];
  const total = await one<{ n: number }>(
    db,
    sql`SELECT count(*)::int AS n FROM (${userRowsSql()}) x WHERE ${where}`,
  );
  const items = await rows<Record<string, unknown>>(
    db,
    sql`SELECT ${listColumns} FROM (${userRowsSql()}) x WHERE ${where}
      ORDER BY ${order}, x.id LIMIT ${q.pageSize} OFFSET ${(q.page - 1) * q.pageSize}`,
  );
  return { total: total.n, page: q.page, pageSize: q.pageSize, items };
}

export async function userCardReport(db: Database, userId: string, now = new Date()) {
  const [user] = await rows<Record<string, unknown>>(
    db,
    sql`SELECT ${listColumns}, x.first_at::text AS "firstAnswer", x.last_at::text AS "lastAnswer"
      FROM (${userRowsSql()}) x WHERE x.id = ${userId}`,
  );
  if (!user) return null;
  const firstSolve = await one<{ at: string | null }>(
    db,
    sql`SELECT min(created_at)::text AS at FROM attempts WHERE user_id = ${userId} AND is_correct`,
  );
  const days = await rows<{ day: string; attempts: number; correct: number }>(
    db,
    sql`SELECT ((a.created_at AT TIME ZONE 'Europe/Moscow')::date)::text AS day, count(*)::int AS attempts,
      count(*) FILTER (WHERE a.is_correct)::int AS correct
      FROM attempts a WHERE a.user_id = ${userId} AND a.created_at >= now() - interval '90 days'
      GROUP BY 1 ORDER BY 1`,
  );
  const activeDates = await rows<{ day: string }>(
    db,
    sql`SELECT DISTINCT ((a.created_at AT TIME ZONE 'Europe/Moscow')::date)::text AS day FROM attempts a WHERE a.user_id = ${userId} ORDER BY 1`,
  );
  const bySubject = await rows<Record<string, unknown>>(
    db,
    sql`SELECT t.subject_id AS "subjectId", count(*)::int AS attempts, count(*) FILTER (WHERE a.is_correct)::int AS correct,
      count(DISTINCT CASE WHEN a.is_correct THEN a.task_id END)::int AS solved
      FROM attempts a JOIN tasks t ON t.id = a.task_id WHERE a.user_id = ${userId} GROUP BY 1 ORDER BY 2 DESC`,
  );
  const byNumber = await rows<Record<string, unknown>>(
    db,
    sql`SELECT t.subject_id AS "subjectId", t.task_number AS "taskNumber", count(*)::int AS attempts,
      count(*) FILTER (WHERE a.is_correct)::int AS correct
      FROM attempts a JOIN tasks t ON t.id = a.task_id WHERE a.user_id = ${userId} GROUP BY 1, 2 ORDER BY 1, 2`,
  );
  const byTopic = await rows<Record<string, unknown>>(
    db,
    sql`SELECT tp.name AS topic, t.subject_id AS "subjectId", count(*)::int AS attempts,
      count(*) FILTER (WHERE a.is_correct)::int AS correct
      FROM attempts a JOIN tasks t ON t.id = a.task_id JOIN topics tp ON tp.id = t.topic_id
      WHERE a.user_id = ${userId} GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 30`,
  );
  const mistakes = await rows<Record<string, unknown>>(
    db,
    sql`SELECT m.task_id AS "taskId", t.subject_id AS "subjectId", t.task_number AS "taskNumber",
      m.times_wrong AS "timesWrong", m.status, m.updated_at::text AS "updatedAt"
      FROM mistakes m JOIN tasks t ON t.id = m.task_id WHERE m.user_id = ${userId}
      ORDER BY m.times_wrong DESC, m.updated_at DESC LIMIT 20`,
  );
  const history = await rows<Record<string, unknown>>(
    db,
    sql`SELECT a.id, a.task_id AS "taskId", t.subject_id AS "subjectId", t.task_number AS "taskNumber",
      a.is_correct AS correct, a.time_spent_ms AS "timeSpentMs", a.created_at::text AS "createdAt"
      FROM attempts a JOIN tasks t ON t.id = a.task_id WHERE a.user_id = ${userId}
      ORDER BY a.created_at DESC LIMIT 50`,
  );
  const complaints = await rows<Record<string, unknown>>(
    db,
    sql`SELECT c.id, c.task_id AS "taskId", c.reason, c.status, c.created_at::text AS "createdAt"
      FROM task_complaints c WHERE c.user_id = ${userId} ORDER BY c.created_at DESC LIMIT 50`,
  );
  const sessions = await one<{ active: number }>(
    db,
    sql`SELECT count(*)::int AS active FROM auth_sessions WHERE user_id = ${userId} AND expires_at > now()`,
  );
  return {
    user: { ...user, firstSolve: firstSolve.at },
    streaks: streaks(
      activeDates.map((d) => d.day),
      moscowDate(now),
    ),
    activity90d: days,
    bySubject,
    byNumber,
    byTopic,
    mistakes,
    history,
    complaints,
    activeSessions: sessions.active,
  };
}

/** Current and best run of consecutive Moscow days with ≥1 answer. A current
 * streak survives until the end of the day after the last active day. */
export function streaks(sortedDays: string[], today: string) {
  let best = 0;
  let run = 0;
  let prev: number | null = null;
  const dayNum = (d: string) => Math.round(Date.parse(`${d}T00:00:00Z`) / 86_400_000);
  for (const d of sortedDays) {
    const n = dayNum(d);
    run = prev !== null && n === prev + 1 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = n;
  }
  const current = prev !== null && dayNum(today) - prev <= 1 ? run : 0;
  return { current, best };
}
