import type { Database } from '@zybrilka/db';
import { sql } from 'drizzle-orm';
import { addDays, makeRange, moscowDate, type Period } from '../period.js';
import {
  one,
  partialFor,
  registeredAttempts,
  registeredUsers,
  rows,
  trackingSince,
} from './common.js';

const ts = (d: Date) => sql`${d.toISOString()}::timestamptz`;

export const THRESHOLDS = [1, 5, 10, 25, 50, 100] as const;

interface Step {
  key: string;
  label: string;
  count: number;
}

function withConversion(steps: Step[]) {
  const first = steps[0]?.count ?? 0;
  return steps.map((step, i) => {
    const prev = i === 0 ? null : steps[i - 1]!.count;
    return {
      ...step,
      fromPrevious: prev === null ? null : prev > 0 ? step.count / prev : null,
      fromStart: first > 0 ? step.count / first : null,
      dropOff: prev === null ? null : prev - step.count,
    };
  });
}

/**
 * Воронки (docs/ADMIN.md §Воронки).
 *
 * Visitor funnel (events — exists only since tracking started): cohort =
 * browsers first seen in the period; each step = that browser did the
 * thing at any time so far. Steps: visit → subject selected → task opened
 * → ≥1 / ≥5 / ≥10 checked answers → registration (an account signed in
 * with this browser) → return (a visit on a later Moscow day).
 * `audience`: guests = browsers never linked to an account.
 *
 * Registered funnel (full history): cohort = accounts registered in the
 * period: registration → subjects chosen → ≥1 / ≥5 / ≥10 / ≥25 answers →
 * return (an answer on a later Moscow day than the first one).
 */
export async function funnelReport(db: Database, period: Period) {
  const s = ts(period.startUtc);
  const e = ts(period.endUtc);
  const since = await trackingSince(db);
  const v = await one<Record<string, number>>(
    db,
    sql`WITH cohort AS (
        SELECT id, user_id, (created_at AT TIME ZONE 'Europe/Moscow')::date AS first_day
        FROM analytics_visitors WHERE created_at >= ${s} AND created_at < ${e}
      ), ev AS (
        SELECT c.id, c.user_id, c.first_day,
          bool_or(x.type = 'subject_selected') AS subject,
          bool_or(x.type = 'task_started') AS task,
          count(*) FILTER (WHERE x.type = 'answer_checked') AS answers,
          bool_or(x.type = 'registration_completed') AS registered,
          bool_or(x.type = 'visit' AND (x.occurred_at AT TIME ZONE 'Europe/Moscow')::date > c.first_day) AS returned
        FROM cohort c LEFT JOIN analytics_events x ON x.visitor_id = c.id GROUP BY c.id, c.user_id, c.first_day
      )
      SELECT count(*)::int AS visit,
        count(*) FILTER (WHERE subject)::int AS subject,
        count(*) FILTER (WHERE task)::int AS task,
        count(*) FILTER (WHERE answers >= 1)::int AS a1,
        count(*) FILTER (WHERE answers >= 5)::int AS a5,
        count(*) FILTER (WHERE answers >= 10)::int AS a10,
        count(*) FILTER (WHERE registered)::int AS registered,
        count(*) FILTER (WHERE returned)::int AS returned,
        count(*) FILTER (WHERE user_id IS NULL AND NOT coalesce(registered, false))::int AS "guestOnly",
        count(*) FILTER (WHERE user_id IS NULL AND NOT coalesce(registered, false) AND answers >= 1)::int AS "guestAnswered",
        count(*) FILTER (WHERE user_id IS NULL AND NOT coalesce(registered, false) AND returned)::int AS "guestReturned"
      FROM ev`,
  );
  const r = await one<Record<string, number>>(
    db,
    sql`WITH cohort AS (SELECT r.id FROM ${registeredUsers} r WHERE r.created_at >= ${s} AND r.created_at < ${e}),
      st AS (
        SELECT c.id,
          EXISTS (SELECT 1 FROM user_subject_profiles p WHERE p.user_id = c.id) AS subjects,
          (SELECT count(*) FROM attempts a WHERE a.user_id = c.id) AS answers,
          (SELECT count(DISTINCT (a.created_at AT TIME ZONE 'Europe/Moscow')::date) FROM attempts a WHERE a.user_id = c.id) AS days
        FROM cohort c
      )
      SELECT count(*)::int AS registered,
        count(*) FILTER (WHERE subjects)::int AS subjects,
        count(*) FILTER (WHERE answers >= 1)::int AS a1,
        count(*) FILTER (WHERE answers >= 5)::int AS a5,
        count(*) FILTER (WHERE answers >= 10)::int AS a10,
        count(*) FILTER (WHERE answers >= 25)::int AS a25,
        count(*) FILTER (WHERE days >= 2)::int AS returned
      FROM st`,
  );
  return {
    trackingSince: since,
    visitorData: partialFor(period, since),
    visitors: withConversion([
      { key: 'visit', label: 'Визит', count: v.visit! },
      { key: 'subject', label: 'Выбрал предмет', count: v.subject! },
      { key: 'task', label: 'Открыл задание', count: v.task! },
      { key: 'a1', label: 'Первый ответ проверен', count: v.a1! },
      { key: 'a5', label: '5 ответов', count: v.a5! },
      { key: 'a10', label: '10 ответов', count: v.a10! },
      { key: 'registered', label: 'Регистрация', count: v.registered! },
      { key: 'returned', label: 'Вернулся в другой день', count: v.returned! },
    ]),
    guests: { visitors: v.guestOnly!, answered: v.guestAnswered!, returned: v.guestReturned! },
    registered: withConversion([
      { key: 'registered', label: 'Регистрация', count: r.registered! },
      { key: 'subjects', label: 'Выбрал предметы', count: r.subjects! },
      { key: 'a1', label: 'Первый ответ', count: r.a1! },
      { key: 'a5', label: '5 ответов', count: r.a5! },
      { key: 'a10', label: '10 ответов', count: r.a10! },
      { key: 'a25', label: '25 ответов', count: r.a25! },
      { key: 'returned', label: 'Вернулся в другой день', count: r.returned! },
    ]),
  };
}

/**
 * Пороги решений: registered users whose N-th checked answer happened in
 * the period ("reached in period") and those with ≥N answers by the end of
 * the period ("reached ever, as of the period end").
 */
export async function thresholdsReport(db: Database, period: Period) {
  const e = ts(period.endUtc);
  const s = ts(period.startUtc);
  const result = await rows<{ threshold: number; inPeriod: number; ever: number }>(
    db,
    sql`WITH numbered AS (
        SELECT a.user_id, a.created_at, row_number() OVER (PARTITION BY a.user_id ORDER BY a.created_at, a.id) AS n
        FROM ${registeredAttempts} a WHERE a.created_at < ${e}
      ), t(threshold) AS (VALUES ${sql.join(
        THRESHOLDS.map((n) => sql`(${n}::int)`),
        sql`, `,
      )})
      SELECT t.threshold,
        count(*) FILTER (WHERE nb.created_at >= ${s})::int AS "inPeriod",
        count(nb.user_id)::int AS ever
      FROM t LEFT JOIN numbered nb ON nb.n = t.threshold GROUP BY t.threshold ORDER BY t.threshold`,
  );
  return { thresholds: result };
}

/**
 * Удержание (registered users; activity = ≥1 checked answer that Moscow
 * day — full history). Cohort basis: the registration day, or the day of
 * the first answer. Dn = share of the cohort active exactly n days after
 * their own cohort day; null while the cohort is too young to know.
 * Weekly/monthly cohorts group users by the week/month of that day.
 */
export async function retentionReport(
  db: Database,
  opts: { cohort: 'week' | 'month'; basis: 'registration' | 'first_activity'; count: number },
  now = new Date(),
) {
  const today = moscowDate(now);
  const span = opts.cohort === 'week' ? 7 * opts.count : 31 * opts.count;
  const since = makeRange(addDays(today, -span), today);
  const cohortDay =
    opts.basis === 'registration'
      ? sql`(SELECT r.id AS user_id, (r.created_at AT TIME ZONE 'Europe/Moscow')::date AS day FROM ${registeredUsers} r)`
      : sql`(SELECT a.user_id, min((a.created_at AT TIME ZONE 'Europe/Moscow')::date) AS day FROM ${registeredAttempts} a GROUP BY a.user_id)`;
  const unit = sql.raw(opts.cohort === 'week' ? `'week'` : `'month'`);
  const data = await rows<{
    cohort: string;
    size: number;
    d1: number;
    d7: number;
    d30: number;
    w1: number;
    m1: number;
  }>(
    db,
    sql`WITH c AS (SELECT * FROM ${cohortDay} cd WHERE cd.day >= ${since.from}::date),
      act AS (SELECT DISTINCT a.user_id, (a.created_at AT TIME ZONE 'Europe/Moscow')::date AS day FROM ${registeredAttempts} a
        WHERE a.user_id IN (SELECT user_id FROM c))
      SELECT date_trunc(${unit}, c.day)::date::text AS cohort, count(*)::int AS size,
        count(*) FILTER (WHERE EXISTS (SELECT 1 FROM act WHERE act.user_id = c.user_id AND act.day = c.day + 1))::int AS d1,
        count(*) FILTER (WHERE EXISTS (SELECT 1 FROM act WHERE act.user_id = c.user_id AND act.day = c.day + 7))::int AS d7,
        count(*) FILTER (WHERE EXISTS (SELECT 1 FROM act WHERE act.user_id = c.user_id AND act.day = c.day + 30))::int AS d30,
        count(*) FILTER (WHERE EXISTS (SELECT 1 FROM act WHERE act.user_id = c.user_id AND act.day BETWEEN c.day + 7 AND c.day + 13))::int AS w1,
        count(*) FILTER (WHERE EXISTS (SELECT 1 FROM act WHERE act.user_id = c.user_id AND act.day BETWEEN c.day + 30 AND c.day + 59))::int AS m1
      FROM c GROUP BY 1 ORDER BY 1`,
  );
  // A cohort's Dn is only known once its LAST member could have reached day n.
  const cohortEnd = (cohort: string) => {
    if (opts.cohort === 'week') return addDays(cohort, 6);
    const [y, m] = cohort.split('-').map(Number) as [number, number];
    const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
    return addDays(next, -1);
  };
  const known = (cohort: string, n: number) => addDays(cohortEnd(cohort), n) < today;
  const share = (value: number, size: number, ok: boolean) =>
    ok && size > 0 ? value / size : null;
  return {
    basis: opts.basis,
    cohortUnit: opts.cohort,
    cohorts: data.map((row) => ({
      cohort: row.cohort,
      size: row.size,
      d1: share(row.d1, row.size, known(row.cohort, 1)),
      d7: share(row.d7, row.size, known(row.cohort, 7)),
      d30: share(row.d30, row.size, known(row.cohort, 30)),
      week1: share(row.w1, row.size, known(row.cohort, 13)),
      month1: share(row.m1, row.size, known(row.cohort, 59)),
    })),
  };
}
