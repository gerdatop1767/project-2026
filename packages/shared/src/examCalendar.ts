/**
 * The EGE calendar: the ONE place the exam dates live (docs/REMINDERS.md
 * § Напоминания неактивным). Anything that counts days to the exam reads
 * `examCountdown`, never a date of its own — updating the schedule is an
 * edit of `EGE_MAIN_PERIODS` only.
 *
 * Only the MAIN period (основной период) is listed — the early period
 * (досрочный, March–April) and the September retakes are not «the first
 * EGE» for a student and must not drive a countdown.
 *
 * `status`:
 * - `project` — the dates of a published draft order (Минпросвещения +
 *   Рособрнадзор). Countdowns say «по проекту расписания».
 * - `approved` — the registered order. Switch to it (and fix the dates if
 *   they moved) once the order is published.
 * A year whose dates are not published yet is simply not listed: no
 * countdown is shown rather than a guessed one.
 */
export interface EgeMainPeriod {
  year: number;
  /** First exam day of the main period, Moscow calendar date (YYYY-MM-DD). */
  firstExamDate: string;
  /** Last day of the main period, retake days included (YYYY-MM-DD). */
  lastDate: string;
  status: 'project' | 'approved';
  source: string;
}

export const EGE_MAIN_PERIODS: readonly EgeMainPeriod[] = [
  {
    year: 2027,
    // Проект расписания (опубликован в октябре 2026): основной период
    // 1 июня — 9 июля 2027, первым днём — история, литература, химия.
    firstExamDate: '2027-06-01',
    lastDate: '2027-07-09',
    status: 'project',
    source:
      'Проект приказа Минпросвещения и Рособрнадзора о расписании ЕГЭ-2027 (regulation.gov.ru)',
  },
];

export const EXAM_TIMEZONE = 'Europe/Moscow';

export type ExamCountdown =
  /** Before the first main-period exam: whole days left (0 = today is not
   * possible here — that day is already `during`). */
  | { kind: 'before'; days: number; period: EgeMainPeriod }
  /** Between the first exam and the end of the main period. */
  | { kind: 'during'; period: EgeMainPeriod }
  /** No configured main period lies ahead (dates not published yet). */
  | { kind: 'unknown' };

/** The calendar date (YYYY-MM-DD) of `now` in Moscow. */
export function moscowDate(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: EXAM_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Whole days from calendar date `from` to `to` (both YYYY-MM-DD). */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/**
 * Where `now` (Moscow date) stands relative to the nearest main period that
 * has not ended. A malformed or inverted entry is ignored, never guessed
 * around.
 */
export function examCountdown(
  now: Date,
  periods: readonly EgeMainPeriod[] = EGE_MAIN_PERIODS,
): ExamCountdown {
  const today = moscowDate(now);
  const valid = [...periods]
    .filter(
      (p) =>
        DATE_RE.test(p.firstExamDate) &&
        DATE_RE.test(p.lastDate) &&
        !Number.isNaN(Date.parse(p.firstExamDate)) &&
        p.firstExamDate <= p.lastDate,
    )
    .sort((a, b) => a.firstExamDate.localeCompare(b.firstExamDate));
  const next = valid.find((p) => p.lastDate >= today);
  if (!next) return { kind: 'unknown' };
  if (today >= next.firstExamDate) return { kind: 'during', period: next };
  return { kind: 'before', days: daysBetween(today, next.firstExamDate), period: next };
}

/** «1 день», «3 дня», «184 дня», «11 дней». */
export function daysWordRu(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'день';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'дня';
  return 'дней';
}
