import type { Database } from '@zybrilka/db';
import { MINI_GAMES } from '@zybrilka/shared';
import { sql, type SQL } from 'drizzle-orm';
import { changePercent, type Period, type Range } from '../period.js';
import { bucketExpr, fillSeries } from './common.js';
import { one, rows } from '../sql.js';

/**
 * Мини-игры — общая статистика (docs/ADMIN.md §Мини-игры). Definitions,
 * the same on the overview and on a game's own page:
 * - ЗАПУСК: a handed-out round (`mini_game_sessions`), guests included.
 * - ИГРОК: a registered user (a sign-in identity) with a round in the
 *   range; a guest has no id and is never a player (counted as a launch).
 * - ЗАВЕРШЁН: the round reached its summary (`finished_at`). A round left
 *   open is never finished.
 * - РЕШЁННЫЙ ВОПРОС: a question answered in a round — one row of
 *   `mini_game_round_answers` per (round, question), so a retry or a
 *   re-sent answer is not counted twice. ПРАВИЛЬНЫЙ: its first answer was
 *   right. Exists since migration 0045 (`questionsSince`).
 * - ВРЕМЯ: start of a finished round to its summary.
 * Days are Moscow days, as in every admin report.
 */
const registered = sql`(SELECT user_id FROM auth_identities)`;

export interface GameTotals {
  launches: number;
  guestLaunches: number;
  players: number;
  finished: number;
  solved: number;
  correct: number;
  wrong: number;
  correctPercent: number | null;
  avgSeconds: number | null;
  medianSeconds: number | null;
  /** Questions answered per round that had at least one answer. */
  avgQuestions: number | null;
  /** Registered players with 2+ rounds in the range. */
  repeatPlayers: number;
}

const pct = (part: number, whole: number) =>
  whole > 0 ? Math.round((part / whole) * 1000) / 10 : null;
const round1 = (v: number | null) => (v === null ? null : Math.round(v * 10) / 10);

function inRange(col: SQL, range: Range): SQL {
  return sql`${col} >= ${range.startUtc.toISOString()}::timestamptz AND ${col} < ${range.endUtc.toISOString()}::timestamptz`;
}

/** Totals per game (and all games together, gameId = null) for a range. */
export async function gameTotals(
  db: Database,
  range: Range,
  gameId: string | null = null,
): Promise<Map<string | null, GameTotals>> {
  const game = (col: SQL) => (gameId ? sql`AND ${col} = ${gameId}` : sql``);
  const s = await rows<{
    gameId: string | null;
    launches: number;
    guestLaunches: number;
    players: number;
    finished: number;
    avgSeconds: number | null;
    medianSeconds: number | null;
    repeatPlayers: number;
  }>(
    db,
    sql`WITH s AS (
        SELECT * FROM mini_game_sessions
        WHERE ${inRange(sql`started_at`, range)} ${game(sql`game_id`)}
      ), per_user AS (
        SELECT game_id, user_id, count(*) AS n FROM s
        WHERE user_id IN ${registered} GROUP BY GROUPING SETS ((game_id, user_id), (user_id))
      )
      SELECT s.game_id AS "gameId",
        count(*)::int AS launches,
        count(*) FILTER (WHERE s.user_id IS NULL)::int AS "guestLaunches",
        count(DISTINCT s.user_id) FILTER (WHERE s.user_id IN ${registered})::int AS players,
        count(*) FILTER (WHERE s.finished_at IS NOT NULL)::int AS finished,
        avg(extract(epoch FROM s.finished_at - s.started_at)) FILTER (WHERE s.finished_at IS NOT NULL)::float8 AS "avgSeconds",
        percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM s.finished_at - s.started_at))
          FILTER (WHERE s.finished_at IS NOT NULL)::float8 AS "medianSeconds",
        (SELECT count(*) FROM per_user p
          WHERE p.n >= 2 AND p.game_id IS NOT DISTINCT FROM s.game_id)::int AS "repeatPlayers"
      FROM s GROUP BY GROUPING SETS ((s.game_id), ())`,
  );
  const a = await rows<{ gameId: string | null; solved: number; correct: number; rounds: number }>(
    db,
    sql`SELECT game_id AS "gameId", count(*)::int AS solved,
        count(*) FILTER (WHERE first_correct)::int AS correct,
        count(DISTINCT session_id)::int AS rounds
      FROM mini_game_round_answers
      WHERE ${inRange(sql`answered_at`, range)} ${game(sql`game_id`)}
      GROUP BY GROUPING SETS ((game_id), ())`,
  );
  const answersOf = new Map(a.map((r) => [r.gameId, r]));
  const out = new Map<string | null, GameTotals>();
  for (const r of s) {
    const q = answersOf.get(r.gameId) ?? { solved: 0, correct: 0, rounds: 0 };
    out.set(r.gameId, {
      launches: r.launches,
      guestLaunches: r.guestLaunches,
      players: r.players,
      finished: r.finished,
      solved: q.solved,
      correct: q.correct,
      wrong: q.solved - q.correct,
      correctPercent: pct(q.correct, q.solved),
      avgSeconds: r.avgSeconds === null ? null : Math.round(r.avgSeconds),
      medianSeconds: r.medianSeconds === null ? null : Math.round(r.medianSeconds),
      avgQuestions: q.rounds > 0 ? round1(q.solved / q.rounds) : null,
      repeatPlayers: r.repeatPlayers,
    });
  }
  // A game (or the whole range) with answers but no launch row in range —
  // only possible for a round started before the range — still shows its answers.
  for (const r of a) {
    if (out.has(r.gameId)) continue;
    out.set(r.gameId, {
      ...emptyTotals(),
      solved: r.solved,
      correct: r.correct,
      wrong: r.solved - r.correct,
      correctPercent: pct(r.correct, r.solved),
      avgQuestions: r.rounds > 0 ? round1(r.solved / r.rounds) : null,
    });
  }
  return out;
}

export function emptyTotals(): GameTotals {
  return {
    launches: 0,
    guestLaunches: 0,
    players: 0,
    finished: 0,
    solved: 0,
    correct: 0,
    wrong: 0,
    correctPercent: null,
    avgSeconds: null,
    medianSeconds: null,
    avgQuestions: null,
    repeatPlayers: 0,
  };
}

/** Each number with its previous-period value and change (%, or null without a base). */
export function compareTotals(current: GameTotals, previous: GameTotals) {
  const keys = [
    'launches',
    'players',
    'finished',
    'solved',
    'correct',
    'avgSeconds',
    'avgQuestions',
  ] as const;
  const out: Record<string, { previous: number | null; changePercent: number | null }> = {};
  for (const k of keys) {
    const cur = current[k];
    const prev = previous[k];
    out[k] = {
      previous: prev,
      changePercent: cur === null || prev === null ? null : changePercent(cur, prev),
    };
  }
  // A share changes in percentage points, not percent.
  out.correctPercent = {
    previous: previous.correctPercent,
    changePercent:
      current.correctPercent === null || previous.correctPercent === null
        ? null
        : Math.round((current.correctPercent - previous.correctPercent) * 10) / 10,
  };
  return out;
}

/** Launches, players, solved and right answers per bucket of the period. */
export async function gameSeries(db: Database, period: Period, gameId: string | null = null) {
  const game = (col: SQL) => (gameId ? sql`AND ${col} = ${gameId}` : sql``);
  const sb = bucketExpr(sql`started_at`, period.granularity);
  const ab = bucketExpr(sql`answered_at`, period.granularity);
  const s = await rows<{
    bucket: string;
    launches: number;
    finished: number;
    players: number;
    guestLaunches: number;
  }>(
    db,
    sql`SELECT ${sb} AS bucket, count(*)::int AS launches,
        count(*) FILTER (WHERE finished_at IS NOT NULL)::int AS finished,
        count(DISTINCT user_id) FILTER (WHERE user_id IN ${registered})::int AS players,
        count(*) FILTER (WHERE user_id IS NULL)::int AS "guestLaunches"
      FROM mini_game_sessions
      WHERE ${inRange(sql`started_at`, period)} ${game(sql`game_id`)}
      GROUP BY 1`,
  );
  const a = await rows<{ bucket: string; solved: number; correct: number }>(
    db,
    sql`SELECT ${ab} AS bucket, count(*)::int AS solved,
        count(*) FILTER (WHERE first_correct)::int AS correct
      FROM mini_game_round_answers
      WHERE ${inRange(sql`answered_at`, period)} ${game(sql`game_id`)}
      GROUP BY 1`,
  );
  const launches = fillSeries(period, period.granularity, s, [
    'launches',
    'finished',
    'players',
    'guestLaunches',
  ] as const);
  const answers = fillSeries(period, period.granularity, a, ['solved', 'correct'] as const);
  return launches.map((p, i) => {
    const q = answers[i]!;
    return {
      bucket: p.bucket,
      launches: p.launches,
      finished: p.finished,
      players: p.players,
      guestLaunches: p.guestLaunches,
      solved: q.solved,
      correct: q.correct,
      correctPercent: pct(q.correct, q.solved),
    };
  });
}

/** When launch / per-question data starts (null: none yet). */
export async function miniGameDataSince(db: Database, gameId: string | null = null) {
  const game = (col: SQL) => (gameId ? sql`WHERE ${col} = ${gameId}` : sql``);
  return one<{ sessionsSince: string | null; questionsSince: string | null }>(
    db,
    sql`SELECT (SELECT min(started_at)::text FROM mini_game_sessions ${game(sql`game_id`)}) AS "sessionsSince",
      (SELECT min(answered_at)::text FROM mini_game_round_answers ${game(sql`game_id`)}) AS "questionsSince"`,
  );
}

/** A game ranks by success only with enough answered questions. */
export const MIN_SOLVED_FOR_RANK = 20;

export async function miniGamesOverview(db: Database, period: Period) {
  const [current, previous, series, since] = await Promise.all([
    gameTotals(db, period),
    gameTotals(db, period.previous),
    gameSeries(db, period),
    miniGameDataSince(db),
  ]);
  const total = current.get(null) ?? emptyTotals();
  const totalPrev = previous.get(null) ?? emptyTotals();
  const games = MINI_GAMES.map((g) => {
    const t = current.get(g.id) ?? emptyTotals();
    const p = previous.get(g.id) ?? emptyTotals();
    return {
      id: g.id,
      title: g.title,
      subjectId: g.subjectId,
      ...t,
      launchesChange: changePercent(t.launches, p.launches),
    };
  });
  const ranked = games.filter((g) => g.solved >= MIN_SOLVED_FOR_RANK);
  const bySuccess = [...ranked].sort(
    (a, b) => (b.correctPercent ?? 0) - (a.correctPercent ?? 0) || b.solved - a.solved,
  );
  return {
    ...since,
    totals: total,
    compare: compareTotals(total, totalPrev),
    games,
    popular: [...games]
      .filter((g) => g.launches > 0)
      .sort((a, b) => b.launches - a.launches || a.title.localeCompare(b.title, 'ru'))
      .slice(0, 5)
      .map((g) => ({ id: g.id, title: g.title, launches: g.launches, players: g.players })),
    bestSuccess: bySuccess.slice(0, 3).map((g) => ({
      id: g.id,
      title: g.title,
      correctPercent: g.correctPercent,
      solved: g.solved,
    })),
    worstSuccess: [...bySuccess]
      .reverse()
      .slice(0, 3)
      .map((g) => ({
        id: g.id,
        title: g.title,
        correctPercent: g.correctPercent,
        solved: g.solved,
      })),
    minSolvedForRank: MIN_SOLVED_FOR_RANK,
    series,
  };
}
