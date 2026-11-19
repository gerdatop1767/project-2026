import { useMemo } from 'react';
import type { StatsPeriodId } from '@zybrilka/shared';
import type { PeriodStatsState } from '../../lib/usePeriodStats.js';
import { Card } from '../Card/Card.js';
import { BarChart } from '../Charts/BarChart.js';
import { LineChart } from '../Charts/LineChart.js';
import { Skeleton } from '../Skeleton/Skeleton.js';
import {
  accuracyLinePoints,
  bucketPoints,
  labelEveryFor,
  periodCaption,
  solvedBarPoints,
} from './dailyCharts.js';
import styles from './ActivityCharts.module.css';

/**
 * Статистика's two charts — solved tasks and the share of right answers
 * per day (per week for a long «Всё время») — drawn from the same period
 * response as the numbers above them, so a chart never shows another range.
 */
export function ActivityCharts({
  period,
  stats,
}: {
  period: StatsPeriodId;
  stats: PeriodStatsState;
}) {
  const data = stats.status === 'ready' ? stats.data : null;
  const points = useMemo(() => (data ? bucketPoints(data.buckets) : null), [data]);
  const bars = useMemo(() => (points ? solvedBarPoints(points) : []), [points]);
  const line = useMemo(() => (points ? accuracyLinePoints(points) : []), [points]);
  const labelEvery = labelEveryFor(points?.length ?? 0);
  const unit = data?.granularity === 'week' ? 'неделям' : 'дням';

  return (
    <Card className={styles.card}>
      <div className={styles.header}>
        <p className="text-h3">Активность</p>
        <p className="text-body-sm text-secondary">{periodCaption(period, data ?? undefined)}</p>
      </div>

      {stats.status === 'error' ? (
        <p className="text-body-sm text-secondary" role="alert">
          Не удалось загрузить график — попробуй позже.
        </p>
      ) : (
        <>
          <div className={styles.section}>
            <p className={styles.sectionTitle}>Решённые задания</p>
            {points ? (
              <BarChart
                points={bars}
                labelEvery={labelEvery}
                ariaLabel={`Решённые задания по ${unit}`}
              />
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
                ariaLabel={`Процент правильных ответов по ${unit}`}
              />
            ) : (
              <Skeleton className={styles.placeholder} aria-label="Загрузка графика" />
            )}
          </div>
          {data && data.totals.answers === 0 && (
            <p className={styles.hint}>За этот период ответов нет.</p>
          )}
        </>
      )}

      <p className={styles.hint}>Нажми на столбец или точку, чтобы увидеть точные цифры</p>
    </Card>
  );
}
