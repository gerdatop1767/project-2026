import { schema, type Database } from '@zybrilka/db';
import {
  DEFAULT_STATS_TIMEZONE,
  MAX_DAILY_BUCKETS,
  accuracyOf,
  buildBuckets,
  calculateMedian,
  daysBetween,
  localClock,
  periodFrom,
  type PeriodTotals,
  type ProgressPeriodResponse,
  type StatsPeriodId,
} from '@zybrilka/shared';
import { and, eq, gte, lt, sql, type SQL } from 'drizzle-orm';

type Row = Record<string, unknown>;
const rowsOf = (result: unknown): Row[] =>
  Array.isArray(result) ? (result as Row[]) : ((result as { rows?: Row[] }).rows ?? []);

/**
 * Statistics for one period (docs/STATISTICS-PERIODS.md). Days are the
 * student's local calendar days in `timezone`; the range is [from, to]
 * inclusive, `to` = today there. Every number — totals, per subject, the
 * chart — is computed from the same answers of the same range.
 */
export async function getPeriodStats(
  db: Database,
  userId: string,
  input: { period: StatsPeriodId; subjectId?: string; timezone?: string; now?: Date },
): Promise<ProgressPeriodResponse> {
  const timezone = input.timezone ?? DEFAULT_STATS_TIMEZONE;
  const now = input.now ?? new Date();
  const today = localClock(now, timezone).date;
  const localDay = sql<string>`to_char(${schema.attempts.createdAt} at time zone ${timezone}, 'YYYY-MM-DD')`;

  let firstActive: string | null = null;
  if (input.period === 'all') {
    const [first] = await db
      .select({ day: sql<string | null>`min(${localDay})` })
      .from(schema.attempts)
      .innerJoin(schema.tasks, eq(schema.tasks.id, schema.attempts.taskId))
      .where(
        and(
          eq(schema.attempts.userId, userId),
          input.subjectId ? eq(schema.tasks.subjectId, input.subjectId) : undefined,
        ),
      );
    firstActive = first?.day ?? null;
  }
  const from = periodFrom(input.period, today, firstActive);
  // Local midnight of `from` and of the day after `to`, as instants.
  const startsAt = sql`(${from}::date)::timestamp at time zone ${timezone}`;
  const endsAt = sql`((${today}::date + 1))::timestamp at time zone ${timezone}`;
  const inRange: SQL = and(
    eq(schema.attempts.userId, userId),
    gte(schema.attempts.createdAt, startsAt as unknown as Date),
    lt(schema.attempts.createdAt, endsAt as unknown as Date),
  )!;
  const subjectFilter = input.subjectId ? eq(schema.tasks.subjectId, input.subjectId) : undefined;

  const [perSubject, perDay, times] = await Promise.all([
    db
      .select({
        subjectId: schema.tasks.subjectId,
        answers: sql<number>`count(*)::int`,
        correct: sql<number>`count(*) filter (where ${schema.attempts.isCorrect})::int`,
        solvedTasks: sql<number>`count(distinct ${schema.attempts.taskId}) filter (where ${schema.attempts.isCorrect})::int`,
        attemptedTasks: sql<number>`count(distinct ${schema.attempts.taskId})::int`,
        activeDays: sql<number>`count(distinct ${localDay})::int`,
      })
      .from(schema.attempts)
      .innerJoin(schema.tasks, eq(schema.tasks.id, schema.attempts.taskId))
      .where(inRange)
      .groupBy(schema.tasks.subjectId),
    db
      .select({
        date: localDay,
        answers: sql<number>`count(*)::int`,
        correct: sql<number>`count(*) filter (where ${schema.attempts.isCorrect})::int`,
        solvedTasks: sql<number>`count(distinct ${schema.attempts.taskId}) filter (where ${schema.attempts.isCorrect})::int`,
      })
      .from(schema.attempts)
      .innerJoin(schema.tasks, eq(schema.tasks.id, schema.attempts.taskId))
      .where(and(inRange, subjectFilter))
      // By position: the timezone is a parameter, and «group by <expr>» with
      // another placeholder would not match the selected expression.
      .groupBy(sql`1`),
    db
      .select({ subjectId: schema.tasks.subjectId, ms: schema.attempts.timeSpentMs })
      .from(schema.attempts)
      .innerJoin(schema.tasks, eq(schema.tasks.id, schema.attempts.taskId))
      .where(and(inRange, sql`${schema.attempts.timeSpentMs} is not null`)),
  ]);

  const timesOf = (subjectId?: string) =>
    times.filter((t) => !subjectId || t.subjectId === subjectId).map((t) => t.ms!);
  const timeStats = (ms: number[]) => ({
    timeSpentMs: ms.reduce((s, t) => s + t, 0),
    averageTimeMs: ms.length ? Math.round(ms.reduce((s, t) => s + t, 0) / ms.length) : null,
    medianTimeMs: ms.length ? Math.round(calculateMedian(ms)!) : null,
  });
  const totalsOf = (
    r: {
      answers: number;
      correct: number;
      solvedTasks: number;
      attemptedTasks: number;
      activeDays: number;
    },
    ms: number[],
  ): PeriodTotals => ({
    answers: r.answers,
    correct: r.correct,
    wrong: r.answers - r.correct,
    accuracyPercent: accuracyOf(r.correct, r.answers),
    solvedTasks: r.solvedTasks,
    attemptedTasks: r.attemptedTasks,
    activeDays: r.activeDays,
    ...timeStats(ms),
  });

  const bySubject = perSubject
    .map((r) => ({ subjectId: r.subjectId, ...totalsOf(r, timesOf(r.subjectId)) }))
    .sort((a, b) => b.answers - a.answers);

  // Totals for the filter: the subject's row, or the whole range (distinct
  // counts and active days over all subjects are counted by the database).
  let totals: PeriodTotals;
  if (input.subjectId) {
    const row = perSubject.find((r) => r.subjectId === input.subjectId);
    totals = totalsOf(
      row ?? { answers: 0, correct: 0, solvedTasks: 0, attemptedTasks: 0, activeDays: 0 },
      timesOf(input.subjectId),
    );
  } else {
    const [all] = await db
      .select({
        answers: sql<number>`count(*)::int`,
        correct: sql<number>`count(*) filter (where ${schema.attempts.isCorrect})::int`,
        solvedTasks: sql<number>`count(distinct ${schema.attempts.taskId}) filter (where ${schema.attempts.isCorrect})::int`,
        attemptedTasks: sql<number>`count(distinct ${schema.attempts.taskId})::int`,
        activeDays: sql<number>`count(distinct ${localDay})::int`,
      })
      .from(schema.attempts)
      .where(inRange);
    totals = totalsOf(all!, timesOf());
  }

  // A long range is drawn by weeks; distinct solved tasks per week from the database.
  let weekSolved: Map<string, number> | undefined;
  if (daysBetween(from, today) + 1 > MAX_DAILY_BUCKETS) {
    const week = sql<string>`to_char(date_trunc('week', ${schema.attempts.createdAt} at time zone ${timezone}), 'YYYY-MM-DD')`;
    const result = await db.execute(sql`
      select ${week} as week,
             count(distinct ${schema.attempts.taskId}) filter (where ${schema.attempts.isCorrect})::int as solved
      from ${schema.attempts}
      inner join ${schema.tasks} on ${schema.tasks.id} = ${schema.attempts.taskId}
      where ${and(inRange, subjectFilter)}
      group by 1`);
    weekSolved = new Map(rowsOf(result).map((r) => [String(r.week), Number(r.solved)]));
  }
  const { granularity, buckets } = buildBuckets(perDay, from, today, weekSolved);

  return {
    period: input.period,
    timezone,
    from,
    to: today,
    subjectId: input.subjectId ?? null,
    granularity,
    totals,
    bySubject,
    buckets,
  };
}
