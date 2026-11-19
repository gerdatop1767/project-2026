import { z } from 'zod';
import { isValidTimezone } from './reminders.js';

/**
 * Статистика за период (docs/STATISTICS-PERIODS.md): every number on the
 * statistics page that depends on the chosen range comes from one response
 * built for exactly that range, in the student's own timezone.
 */
export const statsPeriods = ['7d', '15d', '30d', '90d', 'all'] as const;
export type StatsPeriodId = (typeof statsPeriods)[number];

export const STATS_PERIOD_DAYS: Record<Exclude<StatsPeriodId, 'all'>, number> = {
  '7d': 7,
  '15d': 15,
  '30d': 30,
  '90d': 90,
};

export const STATS_PERIOD_LABELS: Record<StatsPeriodId, string> = {
  '7d': '7 дней',
  '15d': '15 дней',
  '30d': '30 дней',
  '90d': '90 дней',
  all: 'Всё время',
};

export const DEFAULT_STATS_TIMEZONE = 'Europe/Moscow';
/** A range longer than this is drawn by weeks, not days. */
export const MAX_DAILY_BUCKETS = 92;

export const progressPeriodQuerySchema = z.object({
  period: z.enum(statsPeriods),
  subject: z.string().min(1).max(40).optional(),
  tz: z
    .string()
    .max(64)
    .refine((t) => isValidTimezone(t), 'invalid_timezone')
    .optional(),
});
export type ProgressPeriodQuery = z.infer<typeof progressPeriodQuerySchema>;

export interface PeriodTotals {
  /** Every answer given in the range. */
  readonly answers: number;
  readonly correct: number;
  readonly wrong: number;
  /** correct / answers, null without answers. */
  readonly accuracyPercent: number | null;
  /** Distinct tasks answered right at least once in the range. */
  readonly solvedTasks: number;
  /** Distinct tasks answered at all in the range. */
  readonly attemptedTasks: number;
  /** Days of the range with at least one answer. */
  readonly activeDays: number;
  /** Sum of recorded solving time, ms (answers without a time are not counted). */
  readonly timeSpentMs: number;
  readonly averageTimeMs: number | null;
  readonly medianTimeMs: number | null;
}

export interface PeriodBucket {
  /** First local day of the bucket (YYYY-MM-DD). */
  readonly start: string;
  /** Last local day of the bucket (YYYY-MM-DD), inclusive. */
  readonly end: string;
  readonly answers: number;
  readonly correct: number;
  /** Distinct tasks answered right in the bucket. */
  readonly solvedTasks: number;
  readonly accuracyPercent: number | null;
}

export interface ProgressPeriodResponse {
  readonly period: StatsPeriodId;
  readonly timezone: string;
  /** Local dates, inclusive; `from` is the first answer's day for «Всё время». */
  readonly from: string;
  readonly to: string;
  readonly subjectId: string | null;
  readonly granularity: 'day' | 'week';
  readonly totals: PeriodTotals;
  /** The range per subject (every subject, even when `subject` filters the totals). */
  readonly bySubject: readonly ({ readonly subjectId: string } & PeriodTotals)[];
  /** The whole range, empty days included (zeros). */
  readonly buckets: readonly PeriodBucket[];
}

/** «2026-11-19» + n days. */
export function addLocalDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round(
    (new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86_400_000,
  );
}

/** The local first day of the range ending today. */
export function periodFrom(
  period: StatsPeriodId,
  today: string,
  firstActive: string | null,
): string {
  if (period === 'all') return firstActive && firstActive < today ? firstActive : today;
  return addLocalDays(today, -(STATS_PERIOD_DAYS[period] - 1));
}

/** Monday of the week of `date`. */
function weekStart(date: string): string {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addLocalDays(date, -((dow + 6) % 7));
}

const pct = (correct: number, answers: number) =>
  answers > 0 ? Math.round((correct / answers) * 1000) / 10 : null;

/**
 * Per-day rows (only days with answers) → the full range as buckets:
 * every day (zeros where nothing happened), or weeks for a long range.
 * Distinct solved tasks of a week come from `weekSolved` (counted by the
 * database per week, a task solved on two days of a week counts once).
 */
export function buildBuckets(
  rows: readonly { date: string; answers: number; correct: number; solvedTasks: number }[],
  from: string,
  to: string,
  weekSolved?: ReadonlyMap<string, number>,
): { granularity: 'day' | 'week'; buckets: PeriodBucket[] } {
  const span = daysBetween(from, to) + 1;
  const byDate = new Map(rows.map((r) => [r.date, r]));
  if (span <= MAX_DAILY_BUCKETS) {
    const buckets: PeriodBucket[] = [];
    for (let i = 0; i < span; i++) {
      const date = addLocalDays(from, i);
      const r = byDate.get(date);
      const answers = r?.answers ?? 0;
      const correct = r?.correct ?? 0;
      buckets.push({
        start: date,
        end: date,
        answers,
        correct,
        solvedTasks: r?.solvedTasks ?? 0,
        accuracyPercent: pct(correct, answers),
      });
    }
    return { granularity: 'day', buckets };
  }
  const buckets: PeriodBucket[] = [];
  for (let start = weekStart(from); start <= to; start = addLocalDays(start, 7)) {
    const first = start < from ? from : start;
    const last = addLocalDays(start, 6) > to ? to : addLocalDays(start, 6);
    let answers = 0;
    let correct = 0;
    let solved = 0;
    for (let d = first; d <= last; d = addLocalDays(d, 1)) {
      const r = byDate.get(d);
      answers += r?.answers ?? 0;
      correct += r?.correct ?? 0;
      solved += r?.solvedTasks ?? 0;
    }
    buckets.push({
      start: first,
      end: last,
      answers,
      correct,
      solvedTasks: weekSolved?.get(start) ?? solved,
      accuracyPercent: pct(correct, answers),
    });
  }
  return { granularity: 'week', buckets };
}

export { pct as accuracyOf };
