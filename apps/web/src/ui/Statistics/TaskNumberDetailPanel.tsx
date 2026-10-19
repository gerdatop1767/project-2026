import type { TaskNumberStatisticsDetail } from '@zybrilka/shared';
import { formatDuration, errorSignatureLabel } from '../../lib/statisticsDetailFormat.js';
import { Card } from '../Card/Card.js';
import { StatTile } from './StatTile.js';
import { LineChart } from '../Charts/LineChart.js';
import { RankedBarList } from '../Charts/RankedBarList.js';
import styles from './TaskNumberDetailPanel.module.css';

const CHART_COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
  'var(--chart-6)',
  'var(--chart-7)',
];

export interface TaskNumberDetailPanelProps {
  taskNumber: number;
  /** `undefined` while loading, `null` on a failed fetch. */
  detail: TaskNumberStatisticsDetail | null | undefined;
}

/**
 * Statistics 2.0 — the "По номерам → №N" detail (Steps 4-10). Reuses
 * the exact same Card/StatTile/LineChart/RankedBarList the rest of
 * Statistics already uses — same spacing/typography/colors — so this
 * reads as an extension of Statistics, not a separate screen. Shared
 * between Desktop (rendered in a detail panel) and Mobile (rendered as
 * a full-screen view) so both platforms show identical real numbers.
 */
export function TaskNumberDetailPanel({ taskNumber, detail }: TaskNumberDetailPanelProps) {
  if (detail === undefined) {
    return <p className="text-body-sm text-secondary">Загрузка…</p>;
  }

  if (detail === null) {
    return (
      <p className="text-body-sm text-secondary">
        Не удалось загрузить статистику по №{taskNumber}.
      </p>
    );
  }

  if (detail.attempts === 0) {
    return <p className="text-body-sm text-secondary">Пока нет данных по №{taskNumber}.</p>;
  }

  const accuracyTrendPoints = detail.accuracyTrend.map((p, i) => ({
    label: String(i + 1),
    value: p.isCorrect ? 100 : 0,
  }));
  const timeTrendPoints = detail.timeTrend.map((p, i) => ({
    label: String(i + 1),
    value: Math.round(p.timeSpentMs / 1000),
  }));
  const timeTrendMax =
    timeTrendPoints.length === 0 ? 60 : Math.max(10, ...timeTrendPoints.map((p) => p.value));

  return (
    <div className={styles.stack}>
      <div className={styles.statsGrid}>
        <StatTile
          animate
          icon="progress"
          iconColor="var(--color-accent-secondary)"
          label="Точность"
          value={detail.accuracy ?? 0}
          suffix="%"
          deltaLabel={`${detail.correctAttempts} из ${detail.attempts}`}
        />
        <StatTile
          animate
          icon="variant"
          iconColor="var(--color-accent-primary-end)"
          label="Уникальных заданий"
          value={detail.uniqueTasksAttempted}
          deltaLabel={`${detail.attempts} попыток`}
        />
        <StatTile
          animate
          icon="time"
          iconColor="var(--color-warning)"
          label="Среднее время"
          value={detail.averageTimeMs === null ? '—' : formatDuration(detail.averageTimeMs)}
          deltaLabel={
            detail.medianTimeMs === null
              ? undefined
              : `медиана ${formatDuration(detail.medianTimeMs)}`
          }
        />
        <StatTile
          animate
          icon="success"
          iconColor="var(--color-success)"
          label="Ошибок"
          value={detail.incorrectAttempts}
          deltaLabel={
            detail.lastAttemptAt
              ? `посл. попытка ${new Date(detail.lastAttemptAt).toLocaleDateString('ru-RU')}`
              : undefined
          }
        />
      </div>

      <Card>
        <div className={styles.cardHeaderRow}>
          <p className="text-h3">Тип задания</p>
        </div>
        <p className="text-body-sm text-secondary">
          {detail.taskType ?? 'Тип задания для этого номера пока не определён.'}
        </p>
      </Card>

      {detail.recentAccuracy !== null && detail.previousAccuracy !== null && (
        <Card>
          <div className={styles.cardHeaderRow}>
            <p className="text-h3">Динамика</p>
          </div>
          <p className="text-body-sm text-secondary">
            Последние 10: <strong>{detail.recentAccuracy}%</strong> · предыдущие 10:{' '}
            <strong>{detail.previousAccuracy}%</strong>
          </p>
        </Card>
      )}
      {(detail.recentAccuracy === null || detail.previousAccuracy === null) && (
        <Card>
          <div className={styles.cardHeaderRow}>
            <p className="text-h3">Динамика</p>
          </div>
          <p className="text-body-sm text-secondary">
            Нужно ещё несколько решений, чтобы показать динамику.
          </p>
        </Card>
      )}

      <Card>
        <div className={styles.cardHeaderRow}>
          <p className="text-h3">Динамика правильных ответов</p>
        </div>
        {accuracyTrendPoints.length < 2 ? (
          <p className="text-body-sm text-secondary">
            Нужно ещё несколько решений, чтобы показать динамику.
          </p>
        ) : (
          <LineChart points={accuracyTrendPoints} max={100} labelEvery={2} />
        )}
      </Card>

      <Card>
        <div className={styles.cardHeaderRow}>
          <p className="text-h3">Динамика времени решения</p>
        </div>
        {timeTrendPoints.length < 2 ? (
          <p className="text-body-sm text-secondary">
            Нужно ещё несколько решений с таймером, чтобы показать динамику.
          </p>
        ) : (
          <LineChart points={timeTrendPoints} max={timeTrendMax} labelEvery={2} />
        )}
      </Card>

      <Card>
        <div className={styles.cardHeaderRow}>
          <p className="text-h3">Какие навыки проверяет №{taskNumber}</p>
        </div>
        {detail.skillBreakdown.length === 0 ? (
          <p className="text-body-sm text-secondary">
            Для этого номера пока нет размеченных навыков.
          </p>
        ) : (
          <RankedBarList
            items={detail.skillBreakdown.map((s, i) => ({
              label: s.skillName,
              value: s.mastery,
              color: CHART_COLORS[i % CHART_COLORS.length]!,
              displayValue: `${s.mastery}%`,
            }))}
            maxValue={100}
          />
        )}
      </Card>

      {/* Secondary/additional stat (Step 7) — "Тип задания" above is now
          the main informational block; this stays real error-signature
          data, just no longer the headline. */}
      <Card>
        <div className={styles.cardHeaderRow}>
          <p className="text-h3">Ошибки в ответах</p>
        </div>
        {detail.errorBreakdown.length === 0 ? (
          <p className="text-body-sm text-secondary">Пока нет ошибок по этому номеру.</p>
        ) : (
          <RankedBarList
            items={detail.errorBreakdown.map((e, i) => ({
              label: errorSignatureLabel(e.signature),
              value: e.count,
              color: CHART_COLORS[i % CHART_COLORS.length]!,
            }))}
          />
        )}
      </Card>

      <Card>
        <div className={styles.cardHeaderRow}>
          <p className="text-h3">Скорость решения</p>
        </div>
        {detail.speedSignal.value === null ? (
          <p className="text-body-sm text-secondary">
            Недостаточно данных по времени решения для сравнения.
          </p>
        ) : (
          <p className="text-body-sm text-secondary">
            {detail.speedSignal.value === 0
              ? 'Скорость соответствует твоему обычному темпу.'
              : `Решаешь медленнее обычного на ${detail.speedSignal.value}%.`}
          </p>
        )}
      </Card>
    </div>
  );
}
