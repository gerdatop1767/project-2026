import { z } from 'zod';

/**
 * Report periods (docs/ADMIN.md §Периоды). Every day boundary is a
 * Europe/Moscow calendar day — the same zone `user_daily_activity` and the
 * streaks already use. Moscow has been fixed UTC+3 with no DST since 2014,
 * so a plain offset is exact and no tz database is needed here (SQL uses
 * `AT TIME ZONE 'Europe/Moscow'` for the same days).
 *
 * `to` is inclusive for display; `endUtc` is the exclusive instant after it.
 * The comparison period is the same number of days immediately before.
 */
export const REPORT_TZ = 'Europe/Moscow';
const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Upper bound for a custom range — keeps every aggregate query bounded. */
export const MAX_PERIOD_DAYS = 3 * 366;

export const periodPresets = [
  'today',
  'yesterday',
  '7d',
  '30d',
  '90d',
  'month',
  'prev_month',
  'year',
  'custom',
] as const;
export type PeriodPreset = (typeof periodPresets)[number];

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const periodQuerySchema = z.object({
  period: z.enum(periodPresets).default('30d'),
  from: isoDate.optional(),
  to: isoDate.optional(),
  granularity: z.enum(['day', 'week', 'month']).optional(),
});
export type PeriodQuery = z.infer<typeof periodQuerySchema>;

export interface Range {
  /** Inclusive Moscow dates, YYYY-MM-DD. */
  from: string;
  to: string;
  startUtc: Date;
  endUtc: Date;
  days: number;
}

export interface Period extends Range {
  preset: PeriodPreset;
  previous: Range;
  granularity: 'day' | 'week' | 'month';
  timezone: typeof REPORT_TZ;
}

export class PeriodError extends Error {}

/** Today's Moscow calendar date. */
export function moscowDate(now: Date): string {
  return new Date(now.getTime() + MSK_OFFSET_MS).toISOString().slice(0, 10);
}

function dateStartUtc(date: string): Date {
  return new Date(Date.parse(`${date}T00:00:00Z`) - MSK_OFFSET_MS);
}

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

function isRealDate(date: string): boolean {
  const parsed = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

export function makeRange(from: string, to: string): Range {
  const startUtc = dateStartUtc(from);
  const endUtc = dateStartUtc(addDays(to, 1));
  return {
    from,
    to,
    startUtc,
    endUtc,
    days: Math.round((endUtc.getTime() - startUtc.getTime()) / DAY_MS),
  };
}

export function resolvePeriod(query: PeriodQuery, now: Date = new Date()): Period {
  const today = moscowDate(now);
  let from: string;
  let to = today;
  switch (query.period) {
    case 'today':
      from = today;
      break;
    case 'yesterday':
      from = to = addDays(today, -1);
      break;
    case '7d':
      from = addDays(today, -6);
      break;
    case '30d':
      from = addDays(today, -29);
      break;
    case '90d':
      from = addDays(today, -89);
      break;
    case 'month':
      from = `${today.slice(0, 7)}-01`;
      break;
    case 'prev_month': {
      const firstThis = `${today.slice(0, 7)}-01`;
      to = addDays(firstThis, -1);
      from = `${to.slice(0, 7)}-01`;
      break;
    }
    case 'year':
      from = addDays(today, -364);
      break;
    case 'custom': {
      if (!query.from || !query.to) throw new PeriodError('custom_period_needs_from_and_to');
      if (!isRealDate(query.from) || !isRealDate(query.to)) throw new PeriodError('invalid_date');
      from = query.from;
      to = query.to;
      if (from > to) throw new PeriodError('from_after_to');
      if (to > today) to = today;
      if (from > today) throw new PeriodError('period_in_future');
      break;
    }
  }
  const range = makeRange(from, to);
  if (range.days > MAX_PERIOD_DAYS) throw new PeriodError('period_too_long');
  const previous = makeRange(addDays(from, -range.days), addDays(from, -1));
  const granularity =
    query.granularity ?? (range.days <= 62 ? 'day' : range.days <= 366 ? 'week' : 'month');
  return { ...range, preset: query.period, previous, granularity, timezone: REPORT_TZ };
}

/** Relative change in percent, or null when there is no base to compare
 * with (previous = 0) — the UI says «нет базы для сравнения», never ∞ or 0. */
export function changePercent(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

/** Every bucket start (Moscow date) in the range, so a series has explicit
 * zero buckets for days that had no rows instead of gaps. */
export function bucketStarts(range: Range, granularity: Period['granularity']): string[] {
  const out: string[] = [];
  let cursor = bucketOf(range.from, granularity);
  while (cursor <= range.to) {
    out.push(cursor);
    cursor =
      granularity === 'day'
        ? addDays(cursor, 1)
        : granularity === 'week'
          ? addDays(cursor, 7)
          : nextMonth(cursor);
  }
  return out;
}

/** The bucket a Moscow date falls into: itself, its ISO week's Monday, or the 1st. */
export function bucketOf(date: string, granularity: Period['granularity']): string {
  if (granularity === 'day') return date;
  if (granularity === 'month') return `${date.slice(0, 7)}-01`;
  const weekday = (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0
  return addDays(date, -weekday);
}

function nextMonth(firstOfMonth: string): string {
  const [y, m] = firstOfMonth.split('-').map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
}

export { addDays };
