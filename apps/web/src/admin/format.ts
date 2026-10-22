/** Formatting helpers. Unknown values render as «нет данных», never 0. */
const nf = new Intl.NumberFormat('ru-RU');

export const NO_DATA = 'нет данных';

export function num(value: number | null | undefined): string {
  return value === null || value === undefined || Number.isNaN(value) ? NO_DATA : nf.format(value);
}

export function pct(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || Number.isNaN(value)) return NO_DATA;
  return `${(value * 100).toFixed(digits).replace('.', ',')}%`;
}

export function ratio(part: number, whole: number): number | null {
  return whole > 0 ? part / whole : null;
}

export function changeText(change: number | null): string {
  if (change === null) return 'нет базы для сравнения';
  const sign = change > 0 ? '+' : change < 0 ? '−' : '';
  return `${sign}${Math.abs(change).toFixed(1).replace('.', ',')}%`;
}

const dtf = new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'Europe/Moscow',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});
const df = new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'Europe/Moscow',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

/** Postgres `timestamptz::text` ("2026-03-05 10:00:00.12+00") or ISO. */
export function parseTs(value: string): Date {
  return new Date(value.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00'));
}

/** A timestamp from the API shown in Moscow time. */
export function dateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const d = parseTs(value);
  return Number.isNaN(d.getTime()) ? '—' : `${dtf.format(d)} МСК`;
}

export function date(value: string | null | undefined): string {
  if (!value) return '—';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split('-');
    return `${d}.${m}.${y}`;
  }
  const d = parseTs(value);
  return Number.isNaN(d.getTime()) ? '—' : df.format(d);
}

/** Short bucket label for chart axes: 05.03 (day/week) or 03.2026 (month). */
export function bucketLabel(bucket: string, granularity: string): string {
  const [y, m, d] = bucket.split('-');
  return granularity === 'month' ? `${m}.${y}` : `${d}.${m}`;
}

export const subjectNames: Record<string, string> = {
  math: 'Математика',
  russian: 'Русский язык',
  english: 'Английский',
  social: 'Обществознание',
  informatics: 'Информатика',
  physics: 'Физика',
  chemistry: 'Химия',
  biology: 'Биология',
  history: 'История',
};

export const complaintReasonText: Record<string, string> = {
  wrong_answer: 'Неверный ответ',
  condition_error: 'Ошибка в условии',
  typo: 'Опечатка',
  bad_explanation: 'Плохое объяснение',
  display_problem: 'Проблема отображения',
  other: 'Другое',
};

export const complaintStatusText: Record<string, string> = {
  new: 'Новая',
  in_progress: 'В работе',
  fixed: 'Исправлено',
  rejected: 'Отклонено',
};

export const taskStatusText: Record<string, string> = {
  published: 'Опубликовано',
  draft: 'Черновик',
  archived: 'Скрыто',
  needs_review: 'Нужна проверка',
};

export const sourceText = (source: string) =>
  source === 'unknown' ? 'Неизвестно / прямой' : source;
