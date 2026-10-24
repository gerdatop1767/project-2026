import type { DailyPoint, StatsPeriod } from '../../data/sampleStatistics.js';
import { pluralRu } from '../../lib/plural.js';
import type { BarChartPoint } from '../Charts/BarChart.js';
import type { LineChartPoint } from '../Charts/LineChart.js';

export const periodTabs = [
  { id: '7d', label: '7 дней' },
  { id: '30d', label: '30 дней' },
  { id: 'all', label: 'Всё время' },
] as const;

/** `/progress/daily` returns at most 90 days, so "Всё время" is the last 90 — and says so. */
export const periodDays: Record<StatsPeriod, number> = { '7d': 7, '30d': 30, all: 90 };

export function periodCaption(period: StatsPeriod): string {
  return period === 'all' ? 'За последние 90 дней' : `За последние ${periodDays[period]} дней`;
}

/** Axis labels: ~3–5 per chart, so they never collide even at 320 px. */
export function labelEveryFor(count: number): number {
  return count > 40 ? 30 : count > 14 ? 7 : 3;
}

const tasks = (n: number) => `${n} ${pluralRu(n, ['задание', 'задания', 'заданий'])}`;

/** "пн, 18 октября" — the day the server counted (UTC calendar day). */
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
      title: fullDate(p.date),
      value: p.solved > 0 ? `Решено ${tasks(p.solved)}` : 'Ничего не решено',
      detail: p.solved > 0 ? `${Math.round(p.accuracyPercent)}% правильных` : undefined,
    },
  }));
}

/** "Динамика правильных ответов": tap a point → its exact % and what it's based on. */
export function accuracyLinePoints(points: readonly DailyPoint[]): LineChartPoint[] {
  return points.map((p) => ({
    label: p.label,
    value: p.accuracyPercent,
    tooltip: {
      title: fullDate(p.date),
      value:
        p.solved > 0
          ? `${Math.round(p.accuracyPercent)}% правильных ответов`
          : 'Нет решённых заданий',
      detail: p.solved > 0 ? `по ${tasks(p.solved)}` : undefined,
    },
  }));
}
