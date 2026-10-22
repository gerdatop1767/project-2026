import type { Database } from '@zybrilka/db';
import { sql } from 'drizzle-orm';
import { addDays, changePercent, makeRange, type Period, type Range } from '../period.js';
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

interface PeriodTotals {
  registrations: number;
  registeredAnswers: number;
  registeredCorrect: number;
  guestAnswers: number;
  guestCorrect: number;
  activeRegistered: number;
  activeGuests: number;
  solvedTasks: number;
  sessionsStarted: number;
  sessionsCompleted: number;
  guestsStartedTraining: number;
  complaints: number;
}

async function totals(db: Database, range: Range): Promise<PeriodTotals> {
  const s = ts(range.startUtc);
  const e = ts(range.endUtc);
  return one<PeriodTotals>(
    db,
    sql`SELECT
      (SELECT count(*)::int FROM ${registeredUsers} r WHERE r.created_at >= ${s} AND r.created_at < ${e}) AS "registrations",
      (SELECT count(*)::int FROM ${registeredAttempts} a WHERE a.created_at >= ${s} AND a.created_at < ${e}) AS "registeredAnswers",
      (SELECT count(*)::int FROM ${registeredAttempts} a WHERE a.created_at >= ${s} AND a.created_at < ${e} AND a.is_correct) AS "registeredCorrect",
      (SELECT count(*)::int FROM ${guestAnswers} g WHERE g.occurred_at >= ${s} AND g.occurred_at < ${e}) AS "guestAnswers",
      (SELECT count(*)::int FROM ${guestAnswers} g WHERE g.occurred_at >= ${s} AND g.occurred_at < ${e} AND (g.props->>'correct')::boolean) AS "guestCorrect",
      (SELECT count(DISTINCT a.user_id)::int FROM ${registeredAttempts} a WHERE a.created_at >= ${s} AND a.created_at < ${e}) AS "activeRegistered",
      (SELECT count(DISTINCT g.visitor_id)::int FROM ${guestAnswers} g WHERE g.occurred_at >= ${s} AND g.occurred_at < ${e} AND g.visitor_id IS NOT NULL) AS "activeGuests",
      (SELECT count(*)::int FROM (SELECT DISTINCT a.user_id, a.task_id FROM ${registeredAttempts} a WHERE a.created_at >= ${s} AND a.created_at < ${e} AND a.is_correct) x) AS "solvedTasks",
      (SELECT count(*)::int FROM learning_sessions ls WHERE ls.started_at >= ${s} AND ls.started_at < ${e}) AS "sessionsStarted",
      (SELECT count(*)::int FROM learning_sessions ls WHERE ls.completed_at >= ${s} AND ls.completed_at < ${e}) AS "sessionsCompleted",
      (SELECT count(DISTINCT ev.visitor_id)::int FROM analytics_events ev WHERE ev.type = 'task_started' AND ev.user_id IS NULL AND ev.occurred_at >= ${s} AND ev.occurred_at < ${e}) AS "guestsStartedTraining",
      (SELECT count(*)::int FROM task_complaints c WHERE c.created_at >= ${s} AND c.created_at < ${e}) AS "complaints"`,
  );
}

/** Unique active (≥1 checked answer) in a window ending at `to` (inclusive). */
async function activeWindow(db: Database, to: string, days: number) {
  const range = makeRange(addDays(to, -(days - 1)), to);
  const row = await one<{ registered: number; guests: number }>(
    db,
    sql`SELECT
      (SELECT count(DISTINCT a.user_id)::int FROM ${registeredAttempts} a WHERE a.created_at >= ${ts(range.startUtc)} AND a.created_at < ${ts(range.endUtc)}) AS "registered",
      (SELECT count(DISTINCT g.visitor_id)::int FROM ${guestAnswers} g WHERE g.occurred_at >= ${ts(range.startUtc)} AND g.occurred_at < ${ts(range.endUtc)} AND g.visitor_id IS NOT NULL) AS "guests"`,
  );
  return { ...row, from: range.from, to: range.to };
}

const compare = (current: number, previous: number) => ({
  current,
  previous,
  changePercent: changePercent(current, previous),
});

export async function overviewReport(db: Database, period: Period) {
  const since = await trackingSince(db);
  const [cur, prev] = await Promise.all([totals(db, period), totals(db, period.previous)]);
  const [dau, wau, mau] = await Promise.all([
    activeWindow(db, period.to, 1),
    activeWindow(db, period.to, 7),
    activeWindow(db, period.to, 30),
  ]);
  const base = await one<{
    totalRegistered: number;
    totalAtStart: number;
    legacyAnonymousUsers: number;
  }>(
    db,
    sql`SELECT
      (SELECT count(*)::int FROM ${registeredUsers} r WHERE r.created_at < ${ts(period.endUtc)}) AS "totalRegistered",
      (SELECT count(*)::int FROM ${registeredUsers} r WHERE r.created_at < ${ts(period.startUtc)}) AS "totalAtStart",
      (SELECT count(*)::int FROM users u WHERE NOT EXISTS (SELECT 1 FROM auth_identities ai WHERE ai.user_id = u.id)) AS "legacyAnonymousUsers"`,
  );
  const tasks = await rows<{ status: string; n: number }>(
    db,
    sql`SELECT status, count(*)::int AS n FROM tasks GROUP BY status`,
  );
  const complaintsOpen = await one<{ new: number; inProgress: number }>(
    db,
    sql`SELECT count(*) FILTER (WHERE status = 'new')::int AS "new", count(*) FILTER (WHERE status = 'in_progress')::int AS "inProgress" FROM task_complaints`,
  );

  const g = period.granularity;
  const s = ts(period.startUtc);
  const e = ts(period.endUtc);
  const regSeries = await rows<{ bucket: string; registrations: number }>(
    db,
    sql`SELECT ${bucketExpr(sql`r.created_at`, g)} AS bucket, count(*)::int AS registrations FROM ${registeredUsers} r WHERE r.created_at >= ${s} AND r.created_at < ${e} GROUP BY 1`,
  );
  const answerSeries = await rows<{
    bucket: string;
    correct: number;
    incorrect: number;
    activeRegistered: number;
  }>(
    db,
    sql`SELECT ${bucketExpr(sql`a.created_at`, g)} AS bucket,
      count(*) FILTER (WHERE a.is_correct)::int AS correct,
      count(*) FILTER (WHERE NOT a.is_correct)::int AS incorrect,
      count(DISTINCT a.user_id)::int AS "activeRegistered"
      FROM ${registeredAttempts} a WHERE a.created_at >= ${s} AND a.created_at < ${e} GROUP BY 1`,
  );
  const guestSeries = await rows<{
    bucket: string;
    guestCorrect: number;
    guestIncorrect: number;
    activeGuests: number;
  }>(
    db,
    sql`SELECT ${bucketExpr(sql`g.occurred_at`, g)} AS bucket,
      count(*) FILTER (WHERE (g.props->>'correct')::boolean)::int AS "guestCorrect",
      count(*) FILTER (WHERE NOT (g.props->>'correct')::boolean)::int AS "guestIncorrect",
      count(DISTINCT g.visitor_id)::int AS "activeGuests"
      FROM ${guestAnswers} g WHERE g.occurred_at >= ${s} AND g.occurred_at < ${e} GROUP BY 1`,
  );
  const answersFilled = fillSeries(period, g, answerSeries, [
    'correct',
    'incorrect',
    'activeRegistered',
  ] as const);
  const guestsFilled = fillSeries(period, g, guestSeries, [
    'guestCorrect',
    'guestIncorrect',
    'activeGuests',
  ] as const);
  const series = fillSeries(period, g, regSeries, ['registrations'] as const).map((point, i) => ({
    ...point,
    ...answersFilled[i]!,
    ...guestsFilled[i]!,
  }));

  const bySubject = await rows<{
    subjectId: string;
    name: string;
    answers: number;
    correct: number;
    guestAnswers: number;
  }>(
    db,
    sql`SELECT s.id AS "subjectId", s.name,
      coalesce(a.answers, 0)::int AS answers, coalesce(a.correct, 0)::int AS correct,
      coalesce(gq.answers, 0)::int AS "guestAnswers"
      FROM subjects s
      LEFT JOIN (SELECT t.subject_id, count(*) AS answers, count(*) FILTER (WHERE a.is_correct) AS correct
        FROM ${registeredAttempts} a JOIN tasks t ON t.id = a.task_id
        WHERE a.created_at >= ${s} AND a.created_at < ${e} GROUP BY t.subject_id) a ON a.subject_id = s.id
      LEFT JOIN (SELECT t.subject_id, count(*) AS answers FROM ${guestAnswers} gq0 JOIN tasks t ON t.id = gq0.task_id
        WHERE gq0.occurred_at >= ${s} AND gq0.occurred_at < ${e} GROUP BY t.subject_id) gq ON gq.subject_id = s.id
      ORDER BY coalesce(a.answers, 0) + coalesce(gq.answers, 0) DESC, s.name`,
  );
  const bySource = await rows<{ source: string; registrations: number }>(
    db,
    sql`SELECT coalesce(c.source, 'unknown') AS source, count(*)::int AS registrations
      FROM ${registeredUsers} r
      LEFT JOIN user_attributions ua ON ua.user_id = r.id
      LEFT JOIN campaigns c ON c.id = ua.campaign_id
      WHERE r.created_at >= ${s} AND r.created_at < ${e}
      GROUP BY 1 ORDER BY 2 DESC`,
  );

  return {
    trackingSince: since,
    guestData: partialFor(period, since),
    users: {
      totalRegistered: base.totalRegistered,
      totalAtStart: base.totalAtStart,
      registrations: compare(cur.registrations, prev.registrations),
      legacyAnonymousUsers: base.legacyAnonymousUsers,
    },
    active: { dau, wau, mau },
    activeInPeriod: {
      registered: compare(cur.activeRegistered, prev.activeRegistered),
      guests: compare(cur.activeGuests, prev.activeGuests),
    },
    training: {
      guestsStarted: compare(cur.guestsStartedTraining, prev.guestsStartedTraining),
      sessionsStarted: compare(cur.sessionsStarted, prev.sessionsStarted),
      sessionsCompleted: compare(cur.sessionsCompleted, prev.sessionsCompleted),
    },
    answers: {
      registered: compare(cur.registeredAnswers, prev.registeredAnswers),
      registeredCorrect: compare(cur.registeredCorrect, prev.registeredCorrect),
      guests: compare(cur.guestAnswers, prev.guestAnswers),
      guestsCorrect: compare(cur.guestCorrect, prev.guestCorrect),
      solvedTasks: compare(cur.solvedTasks, prev.solvedTasks),
      uniqueSolvers: compare(cur.activeRegistered, prev.activeRegistered),
    },
    tasks: Object.fromEntries(tasks.map((t) => [t.status, t.n])) as Record<string, number>,
    complaints: {
      inPeriod: compare(cur.complaints, prev.complaints),
      new: complaintsOpen.new,
      inProgress: complaintsOpen.inProgress,
    },
    series,
    bySubject,
    bySource,
  };
}
