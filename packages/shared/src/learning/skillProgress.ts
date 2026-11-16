import type { SkillLevel } from './mastery.js';

/**
 * Progress of one EGE number (docs/learning/PERSONAL-PLANS.md § Прогресс по
 * номеру): the accuracy chart and the 7/30-day dynamics, from the attempts
 * only. Mastery is a separate value (`calculateSkillMastery`, with a prior
 * and a confidence) and is shown as a percentage only from `developing`
 * data on: one correct answer never reads as 100 %.
 */
export interface DatedAttempt {
  readonly isCorrect: boolean;
  /** Local calendar date YYYY-MM-DD of the attempt. */
  readonly date: string;
}

export interface AccuracyPoint {
  readonly date: string;
  readonly attempts: number;
  readonly correct: number;
  /** Accuracy of the attempts of the last 7 days up to this date, null without any. */
  readonly rolling7: number | null;
}

function shift(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** One point per day of the last `days` days, ending `today`. */
export function accuracySeries(
  attempts: readonly DatedAttempt[],
  today: string,
  days = 30,
): AccuracyPoint[] {
  const byDate = new Map<string, { a: number; c: number }>();
  for (const x of attempts) {
    const s = byDate.get(x.date) ?? { a: 0, c: 0 };
    byDate.set(x.date, { a: s.a + 1, c: s.c + (x.isCorrect ? 1 : 0) });
  }
  const out: AccuracyPoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = shift(today, -i);
    const day = byDate.get(date) ?? { a: 0, c: 0 };
    let a = 0;
    let c = 0;
    for (let k = 0; k < 7; k++) {
      const s = byDate.get(shift(date, -k));
      if (s) {
        a += s.a;
        c += s.c;
      }
    }
    out.push({
      date,
      attempts: day.a,
      correct: day.c,
      rolling7: a ? Math.round((c / a) * 100) : null,
    });
  }
  return out;
}

export interface PeriodAccuracy {
  readonly attempts: number;
  readonly accuracy: number | null;
}

function period(attempts: readonly DatedAttempt[], from: string, to: string): PeriodAccuracy {
  const list = attempts.filter((a) => a.date >= from && a.date <= to);
  const ok = list.filter((a) => a.isCorrect).length;
  return {
    attempts: list.length,
    accuracy: list.length ? Math.round((ok / list.length) * 100) : null,
  };
}

export interface Dynamics {
  readonly last7: PeriodAccuracy;
  readonly prev7: PeriodAccuracy;
  readonly last30: PeriodAccuracy;
  readonly prev30: PeriodAccuracy;
  /** Change of accuracy, null when either period has fewer than 3 attempts. */
  readonly delta7: number | null;
  readonly delta30: number | null;
}

export function dynamicsOf(attempts: readonly DatedAttempt[], today: string): Dynamics {
  const last7 = period(attempts, shift(today, -6), today);
  const prev7 = period(attempts, shift(today, -13), shift(today, -7));
  const last30 = period(attempts, shift(today, -29), today);
  const prev30 = period(attempts, shift(today, -59), shift(today, -30));
  const delta = (a: PeriodAccuracy, b: PeriodAccuracy) =>
    a.attempts >= 3 && b.attempts >= 3 ? a.accuracy! - b.accuracy! : null;
  return {
    last7,
    prev7,
    last30,
    prev30,
    delta7: delta(last7, prev7),
    delta30: delta(last30, prev30),
  };
}

/** Mastery as shown: no percentage until there is enough data for a level. */
export function displayMastery(level: SkillLevel, mastery: number): number | null {
  return level === 'none' || level === 'low_data' ? null : mastery;
}
