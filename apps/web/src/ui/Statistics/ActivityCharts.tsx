import { useEffect, useMemo, useState } from 'react';
import type { ProgressDailyResponse } from '@zybrilka/shared';
import type { StatsPeriod } from '../../data/sampleStatistics.js';
import { getProgressDaily } from '../../lib/api.js';
import { toDailyPoints } from '../../lib/progressAdapter.js';
import { Card } from '../Card/Card.js';
import { Tabs } from '../Tabs/Tabs.js';
import { BarChart } from '../Charts/BarChart.js';
import { LineChart } from '../Charts/LineChart.js';
import { Skeleton } from '../Skeleton/Skeleton.js';
import {
  accuracyLinePoints,
  labelEveryFor,
  periodCaption,
  periodDays,
  periodTabs,
  solvedBarPoints,
} from './dailyCharts.js';
import styles from './ActivityCharts.module.css';

/**
 * Mobile Статистика's daily charts — the same two charts and the same
 * real `/progress/daily` data as desktop: solved tasks per day and the
 * share of correct answers, for 7 / 30 days / «Всё время». Tap a bar or a
 * point to read its exact numbers.
 */
export function ActivityCharts({ subjectId }: { subjectId: string }) {
  const [period, setPeriod] = useState<StatsPeriod>('7d');
  const days = periodDays[period];
  const key = `${subjectId}:${days}`;
  const [data, setData] = useState<{ key: string; items: ProgressDailyResponse['items'] } | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;
    void getProgressDaily({ days, subject: subjectId })
      .then((res) => {
        if (!cancelled) setData({ key, items: res.items });
      })
      .catch(() => {
        if (!cancelled) setData({ key, items: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [days, subjectId, key]);

  // Only data for exactly this subject + period is ever drawn.
  const items = data?.key === key ? data.items : null;
  const points = useMemo(() => (items ? toDailyPoints(items, days) : null), [items, days]);
  const bars = useMemo(() => (points ? solvedBarPoints(points) : []), [points]);
  const line = useMemo(() => (points ? accuracyLinePoints(points) : []), [points]);
  const labelEvery = labelEveryFor(points?.length ?? 0);

  return (
    <Card className={styles.card}>
      <div className={styles.header}>
        <p className="text-h3">Активность</p>
        <p className="text-body-sm text-secondary">{periodCaption(period)}</p>
      </div>
      <Tabs
        items={periodTabs}
        activeId={period}
        onChange={(id) => setPeriod(id as StatsPeriod)}
        aria-label="Период"
      />

      <div className={styles.section}>
        <p className={styles.sectionTitle}>Решённые задания</p>
        {points ? (
          <BarChart points={bars} labelEvery={labelEvery} ariaLabel="Решённые задания по дням" />
        ) : (
          <Skeleton className={styles.placeholder} aria-label="Загрузка графика" />
        )}
      </div>

      <div className={styles.section}>
        <p className={styles.sectionTitle}>Правильные ответы, %</p>
        {points ? (
          <LineChart
            points={line}
            labelEvery={labelEvery}
            ariaLabel="Процент правильных ответов по дням"
          />
        ) : (
          <Skeleton className={styles.placeholder} aria-label="Загрузка графика" />
        )}
      </div>

      <p className={styles.hint}>Нажми на столбец или точку, чтобы увидеть точные цифры</p>
    </Card>
  );
}
