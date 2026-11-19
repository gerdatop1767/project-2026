import {
  buildBuckets,
  periodFrom,
  type PeriodTotals,
  type ProgressPeriodResponse,
  type StatsPeriodId,
} from '@zybrilka/shared';

/** «Today» of the fixtures. */
export const FIXTURE_TODAY = '2026-11-19';

const EMPTY: PeriodTotals = {
  answers: 0,
  correct: 0,
  wrong: 0,
  accuracyPercent: null,
  solvedTasks: 0,
  attemptedTasks: 0,
  activeDays: 0,
  timeSpentMs: 0,
  averageTimeMs: null,
  medianTimeMs: null,
};

/**
 * A `/progress/period` response as the server builds it (same bucket
 * builder): the range ending today, empty days included.
 */
export function periodResponse(
  period: StatsPeriodId,
  opts: {
    subjectId?: string;
    totals?: Partial<PeriodTotals>;
    days?: readonly { date: string; answers: number; correct: number; solvedTasks: number }[];
    bySubject?: ProgressPeriodResponse['bySubject'];
    firstActive?: string;
  } = {},
): ProgressPeriodResponse {
  const from = periodFrom(period, FIXTURE_TODAY, opts.firstActive ?? null);
  const days = (opts.days ?? []).filter((d) => d.date >= from);
  const { granularity, buckets } = buildBuckets(days, from, FIXTURE_TODAY);
  return {
    period,
    timezone: 'Europe/Moscow',
    from,
    to: FIXTURE_TODAY,
    subjectId: opts.subjectId ?? null,
    granularity,
    totals: { ...EMPTY, ...opts.totals },
    bySubject: opts.bySubject ?? [],
    buckets,
  };
}
