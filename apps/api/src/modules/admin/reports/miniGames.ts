import type { Database } from '@zybrilka/db';
import { sql } from 'drizzle-orm';
import { moscowDate, type Period } from '../period.js';
import { mskDate } from './common.js';
import { one, rows } from '../sql.js';

/**
 * Мини-игры (docs/ADMIN.md §Мини-игры), per game (`gameId`), so a new game
 * gets the same report with no new code.
 *
 * Two sources, never mixed in one number:
 * - `mini_game_sessions` — one row per handed-out round (guests too, no
 *   user): launches, finished rounds, results, time. Exists only since
 *   migration 0036; `sessionsSince` says from when. Earlier rounds are not
 *   reconstructed.
 * - `mini_game_answers` — every answer of a signed-in player, since the game
 *   launched: active players, answers, accuracy, returning players.
 *
 * Players are registered users (an account with a sign-in identity), as in
 * every admin report. A guest has no id, so guests are counted as launches
 * only, never as players. Time = start of the round to reaching its summary
 * (finished rounds only; a round left open has no end). A round's result
 * is its summary's «N из M с первого раза» (`first_try_correct`); the
 * overall share of right answers counts every answer, retries included.
 */
const registered = sql`(SELECT user_id FROM auth_identities)`;

export const RESULT_BUCKETS = [
  { label: '0–19%', min: 0, max: 20 },
  { label: '20–39%', min: 20, max: 40 },
  { label: '40–59%', min: 40, max: 60 },
  { label: '60–79%', min: 60, max: 80 },
  { label: '80–100%', min: 80, max: 101 },
] as const;

export async function miniGamesReport(
  db: Database,
  period: Period,
  gameId: string,
  now: Date = new Date(),
) {
  const today = moscowDate(now);
  const start = period.startUtc.toISOString();
  const end = period.endUtc.toISOString();
  const inPeriod = (col: ReturnType<typeof sql>) =>
    sql`${col} >= ${start}::timestamptz AND ${col} < ${end}::timestamptz`;

  const sessions = await one<{
    launches: number;
    guestLaunches: number;
    players: number;
    finished: number;
    answered: number;
    correct: number;
    avgCorrect: number | null;
    avgQuestions: number | null;
    avgSeconds: number | null;
    medianSeconds: number | null;
    repeatPlayers: number;
    since: string | null;
  }>(
    db,
    sql`WITH s AS (
        SELECT * FROM mini_game_sessions
        WHERE game_id = ${gameId} AND ${inPeriod(sql`started_at`)}
      ), per_user AS (
        SELECT user_id, count(*) AS n FROM s
        WHERE user_id IN ${registered} GROUP BY user_id
      )
      SELECT count(*)::int AS launches,
        count(*) FILTER (WHERE user_id IS NULL)::int AS "guestLaunches",
        (SELECT count(*) FROM per_user)::int AS players,
        count(*) FILTER (WHERE finished_at IS NOT NULL)::int AS finished,
        coalesce(sum(answered_count), 0)::int AS answered,
        coalesce(sum(correct_count), 0)::int AS correct,
        avg(first_try_correct) FILTER (WHERE finished_at IS NOT NULL)::float8 AS "avgCorrect",
        avg(question_count) FILTER (WHERE finished_at IS NOT NULL AND first_try_correct IS NOT NULL)::float8 AS "avgQuestions",
        avg(extract(epoch FROM finished_at - started_at)) FILTER (WHERE finished_at IS NOT NULL)::float8 AS "avgSeconds",
        percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM finished_at - started_at))
          FILTER (WHERE finished_at IS NOT NULL)::float8 AS "medianSeconds",
        (SELECT count(*) FROM per_user WHERE n >= 2)::int AS "repeatPlayers",
        (SELECT min(started_at)::text FROM mini_game_sessions WHERE game_id = ${gameId}) AS since
      FROM s`,
  );

  const answers = await one<{
    players: number;
    answers: number;
    correct: number;
    newPlayers: number;
    multiDayPlayers: number;
    since: string | null;
  }>(
    db,
    sql`WITH a AS (
        SELECT user_id, correct, ${mskDate(sql`created_at`)} AS d FROM mini_game_answers
        WHERE game_id = ${gameId} AND user_id IN ${registered} AND ${inPeriod(sql`created_at`)}
      ), firsts AS (
        SELECT user_id, min(created_at) AS first_at FROM mini_game_answers
        WHERE game_id = ${gameId} GROUP BY user_id
      ), days AS (SELECT user_id, count(DISTINCT d) AS n FROM a GROUP BY user_id)
      SELECT (SELECT count(DISTINCT user_id) FROM a)::int AS players,
        (SELECT count(*) FROM a)::int AS answers,
        (SELECT count(*) FILTER (WHERE correct) FROM a)::int AS correct,
        (SELECT count(*) FROM firsts WHERE user_id IN ${registered} AND ${inPeriod(sql`first_at`)})::int AS "newPlayers",
        (SELECT count(*) FROM days WHERE n >= 2)::int AS "multiDayPlayers",
        (SELECT min(created_at)::text FROM mini_game_answers WHERE game_id = ${gameId}) AS since`,
  );

  // Returning: of the players whose FIRST game day falls in the period,
  // how many played again on a later day within 1 / 7 days.
  const returning = await one<{ cohort: number; d1: number; d7: number; eligible7: number }>(
    db,
    sql`WITH days AS (
        SELECT DISTINCT user_id, ${mskDate(sql`created_at`)} AS d FROM mini_game_answers
        WHERE game_id = ${gameId} AND user_id IN ${registered}
      ), first AS (SELECT user_id, min(d) AS d0 FROM days GROUP BY user_id),
      cohort AS (SELECT * FROM first WHERE d0 BETWEEN ${period.from}::date AND ${period.to}::date)
      SELECT count(*)::int AS cohort,
        count(*) FILTER (WHERE EXISTS (SELECT 1 FROM days x WHERE x.user_id = c.user_id AND x.d = c.d0 + 1))::int AS d1,
        count(*) FILTER (WHERE c.d0 + 7 <= ${today}::date)::int AS eligible7,
        count(*) FILTER (WHERE c.d0 + 7 <= ${today}::date
          AND EXISTS (SELECT 1 FROM days x WHERE x.user_id = c.user_id AND x.d > c.d0 AND x.d <= c.d0 + 7))::int AS d7
      FROM cohort c`,
  );

  const daily = await rows<{
    day: string;
    launches: number;
    finished: number;
    sessionPlayers: number;
    players: number;
    answers: number;
    correct: number;
  }>(
    db,
    sql`WITH span AS (
        SELECT gs::date AS d FROM generate_series(${period.from}::date, ${period.to}::date, interval '1 day') gs
      ), s AS (
        SELECT ${mskDate(sql`started_at`)} AS d, count(*) AS launches,
          count(*) FILTER (WHERE finished_at IS NOT NULL) AS finished,
          count(DISTINCT user_id) FILTER (WHERE user_id IN ${registered}) AS players
        FROM mini_game_sessions WHERE game_id = ${gameId} AND ${inPeriod(sql`started_at`)} GROUP BY 1
      ), a AS (
        SELECT ${mskDate(sql`created_at`)} AS d, count(DISTINCT user_id) AS players, count(*) AS answers,
          count(*) FILTER (WHERE correct) AS correct
        FROM mini_game_answers
        WHERE game_id = ${gameId} AND user_id IN ${registered} AND ${inPeriod(sql`created_at`)} GROUP BY 1
      )
      SELECT span.d::text AS day, coalesce(s.launches, 0)::int AS launches,
        coalesce(s.finished, 0)::int AS finished, coalesce(s.players, 0)::int AS "sessionPlayers",
        coalesce(a.players, 0)::int AS players, coalesce(a.answers, 0)::int AS answers,
        coalesce(a.correct, 0)::int AS correct
      FROM span LEFT JOIN s ON s.d = span.d LEFT JOIN a ON a.d = span.d ORDER BY span.d`,
  );

  const buckets = await rows<{ bucket: number; rounds: number }>(
    db,
    sql`SELECT CASE ${sql.join(
      RESULT_BUCKETS.map(
        (b, i) =>
          sql`WHEN 100.0 * first_try_correct / nullif(question_count, 0) >= ${b.min} AND 100.0 * first_try_correct / nullif(question_count, 0) < ${b.max} THEN ${i}`,
      ),
      sql` `,
    )} ELSE ${RESULT_BUCKETS.length - 1} END AS bucket, count(*)::int AS rounds
      FROM mini_game_sessions
      WHERE game_id = ${gameId} AND finished_at IS NOT NULL AND first_try_correct IS NOT NULL
        AND ${inPeriod(sql`started_at`)}
      GROUP BY 1 ORDER BY 1`,
  );
  const byBucket = new Map(buckets.map((b) => [Number(b.bucket), b.rounds]));

  const modes = await rows<{ mode: string; launches: number; finished: number }>(
    db,
    sql`SELECT mode, count(*)::int AS launches, count(*) FILTER (WHERE finished_at IS NOT NULL)::int AS finished
      FROM mini_game_sessions WHERE game_id = ${gameId} AND ${inPeriod(sql`started_at`)}
      GROUP BY mode ORDER BY launches DESC`,
  );

  const pct = (part: number, whole: number) =>
    whole > 0 ? Math.round((part / whole) * 1000) / 10 : null;
  const round1 = (v: number | null) => (v === null ? null : Math.round(v * 10) / 10);

  return {
    gameId,
    /** Launch/round data exists from here on (null: none yet). */
    sessionsSince: sessions.since,
    /** Signed-in answers exist from here on. */
    answersSince: answers.since,
    rounds: {
      launches: sessions.launches,
      guestLaunches: sessions.guestLaunches,
      players: sessions.players,
      repeatPlayers: sessions.repeatPlayers,
      repeatPlayersPercent: pct(sessions.repeatPlayers, sessions.players),
      launchesPerPlayer:
        sessions.players > 0
          ? round1((sessions.launches - sessions.guestLaunches) / sessions.players)
          : null,
      finished: sessions.finished,
      finishedPercent: pct(sessions.finished, sessions.launches),
      avgCorrect: round1(sessions.avgCorrect),
      avgQuestions: round1(sessions.avgQuestions),
      correctPercent: pct(sessions.correct, sessions.answered),
      avgSeconds: sessions.avgSeconds === null ? null : Math.round(sessions.avgSeconds),
      medianSeconds: sessions.medianSeconds === null ? null : Math.round(sessions.medianSeconds),
      results: RESULT_BUCKETS.map((b, i) => ({ label: b.label, rounds: byBucket.get(i) ?? 0 })),
      modes,
    },
    answers: {
      players: answers.players,
      newPlayers: answers.newPlayers,
      answers: answers.answers,
      correctPercent: pct(answers.correct, answers.answers),
      multiDayPlayers: answers.multiDayPlayers,
      multiDayPercent: pct(answers.multiDayPlayers, answers.players),
      returning: {
        cohort: returning.cohort,
        d1: returning.d1,
        d1Percent: pct(returning.d1, returning.cohort),
        eligible7: returning.eligible7,
        d7: returning.d7,
        d7Percent: pct(returning.d7, returning.eligible7),
      },
    },
    daily,
  };
}
