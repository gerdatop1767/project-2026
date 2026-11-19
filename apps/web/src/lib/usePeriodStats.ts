import { useEffect, useState } from 'react';
import { isValidTimezone, type ProgressPeriodResponse, type StatsPeriodId } from '@zybrilka/shared';
import { getProgressPeriod } from './api.js';

/** The device's timezone, when the server will accept it. */
export function deviceTimezone(): string | undefined {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return tz && isValidTimezone(tz) ? tz : undefined;
  } catch {
    return undefined;
  }
}

export type PeriodStatsState =
  { status: 'loading' } | { status: 'error' } | { status: 'ready'; data: ProgressPeriodResponse };

/**
 * Statistics for exactly this period and subject. While another period's
 * numbers are in memory and the new ones are loading, the state is
 * `loading` — the screen shows skeletons, never the old figures.
 */
export function usePeriodStats(period: StatsPeriodId, subjectId?: string): PeriodStatsState {
  const tz = deviceTimezone();
  const key = `${period}|${subjectId ?? ''}|${tz ?? ''}`;
  const [result, setResult] = useState<{ key: string; state: PeriodStatsState } | null>(null);
  useEffect(() => {
    let live = true;
    getProgressPeriod({ period, subject: subjectId, tz }).then(
      (data) => live && setResult({ key, state: { status: 'ready', data } }),
      () => live && setResult({ key, state: { status: 'error' } }),
    );
    return () => {
      live = false;
    };
  }, [key, period, subjectId, tz]);
  return result?.key === key ? result.state : { status: 'loading' };
}
