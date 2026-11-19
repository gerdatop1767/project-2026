import {
  STATS_PERIOD_LABELS,
  statsPeriods,
  type PeriodBucket,
  type StatsPeriodId,
} from '@zybrilka/shared';
import type { DailyPoint } from '../../data/sampleStatistics.js';
import { pluralRu } from '../../lib/plural.js';
import type { BarChartPoint } from '../Charts/BarChart.js';
import type { LineChartPoint } from '../Charts/LineChart.js';

export const periodTabs = statsPeriods.map((id) => ({ id, label: STATS_PERIOD_LABELS[id] }));

/** The caption under a chart: the exact range it draws. */
export function periodCaption(
  period: StatsPeriodId,
  range?: { from: string; to: string; granularity: 'day' | 'week' },
): string {
  if (period !== 'all') return `За последние ${STATS_PERIOD_LABELS[period]}`;
  if (!range) return 'За всё время';
  const since = new Date(`${range.from}T00:00:00Z`).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  return `За всё время — с ${since}${range.granularity === 'week' ? ', по неделям' : ''}`;
}

const shortDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });

/** The period's buckets as chart points (a day, or a week labelled by its first day). */
export function bucketPoints(buckets: readonly PeriodBucket[]): DailyPoint[] {
  return buckets.map((b) => ({
    date: b.start,
    ...(b.end !== b.start ? { end: b.end } : {}),
    label: shortDate(b.start),
    solved: b.solvedTasks,
    accuracyPercent: b.accuracyPercent ?? 0,
    answers: b.answers,
  }));
}

/** Axis labels: ~3–5 per chart, so they never collide even at 320 px. */
export function labelEveryFor(count: number): number {
  return count > 40 ? 30 : count > 14 ? 7 : 3;
}

const tasks = (n: number) => `${n} ${pluralRu(n, ['задание', 'задания', 'заданий'])}`;

const answersWord = (n: number) => `${n} ${pluralRu(n, ['ответу', 'ответам', 'ответам'])}`;

/** The tooltip title: «пн, 18 октября», or «11 – 17 ноября» for a week. */
function titleOf(p: DailyPoint): string {
  if (!p.end) return fullDate(p.date);
  const d = (iso: string) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString('ru-RU', {
      day: 'numeric',
      month: 'long',
      timeZone: 'UTC',
    });
  return `${d(p.date)} – ${d(p.end)}`;
}

/** "пн, 18 октября" — the student's local calendar day the server counted. */
function fullDate(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString('ru-RU', {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });
}

/** "Активность по дням": tap a bar → that day's exact solved count. */
export function solvedBarPoints(points: readonly DailyPoint[]): BarChartPoint[] {
  return points.map((p) => ({
    label: p.label,
    value: p.solved,
    tooltip: {
      title: titleOf(p),
      value: p.solved > 0 ? `Решено ${tasks(p.solved)}` : 'Ничего не решено',
      detail:
        p.solved > 0 || (p.answers ?? 0) > 0
          ? `${Math.round(p.accuracyPercent)}% правильных`
          : undefined,
    },
  }));
}

/** "Динамика правильных ответов": tap a point → its exact % and what it's based on. */
export function accuracyLinePoints(points: readonly DailyPoint[]): LineChartPoint[] {
  return points.map((p) => ({
    label: p.label,
    value: p.accuracyPercent,
    tooltip:
      p.answers !== undefined
        ? {
            title: titleOf(p),
            value:
              p.answers > 0
                ? `${Math.round(p.accuracyPercent)}% правильных ответов`
                : 'Нет ответов',
            detail: p.answers > 0 ? `по ${answersWord(p.answers)}` : undefined,
          }
        : {
            title: fullDate(p.date),
            value:
              p.solved > 0
                ? `${Math.round(p.accuracyPercent)}% правильных ответов`
                : 'Нет решённых заданий',
            detail: p.solved > 0 ? `по ${tasks(p.solved)}` : undefined,
          },
  }));
}
