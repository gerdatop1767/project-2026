import type { StatsPeriodId } from '@zybrilka/shared';
import { STATS_PERIOD_LABELS } from '@zybrilka/shared';
import { formatDuration, formatDurationLong } from '../../lib/statisticsDetailFormat.js';
import type { PeriodStatsState } from '../../lib/usePeriodStats.js';
import { subjects } from '../../data/subjects.js';
import { pluralRu } from '../../lib/plural.js';
import { Card } from '../Card/Card.js';
import { Skeleton } from '../Skeleton/Skeleton.js';
import { StatTile } from './StatTile.js';
import styles from './PeriodSummary.module.css';

const days = (n: number) => `${n} ${pluralRu(n, ['день', 'дня', 'дней'])}`;

/**
 * The period's headline numbers: solved, right answers, mistakes, time —
 * all for the chosen range; skeletons while it loads (never the previous
 * period's figures).
 */
export function PeriodTiles({
  stats,
  gridClassName,
}: {
  stats: PeriodStatsState;
  gridClassName?: string;
}) {
  const loading = stats.status === 'loading';
  const t = stats.status === 'ready' ? stats.data.totals : null;
  return (
    <div className={gridClassName}>
      <StatTile
        animate
        icon="variant"
        iconColor="var(--color-accent-primary-end)"
        label="Решено заданий"
        value={t ? t.answers : '—'}
        deltaLabel={t ? `верно ${t.correct} · неверно ${t.wrong}` : undefined}
        loading={loading}
        deltaDirection="none"
      />
      <StatTile
        animate
        icon="success"
        iconColor="var(--color-success)"
        label="Правильных ответов"
        value={t?.accuracyPercent !== null && t ? Math.round(t.accuracyPercent!) : '—'}
        suffix={t?.accuracyPercent !== null && t ? '%' : undefined}
        deltaLabel={t ? `${t.correct} из ${t.answers}` : undefined}
        loading={loading}
        deltaDirection="none"
      />
      <StatTile
        animate
        icon="errorCircle"
        iconColor="var(--color-error)"
        label="Ошибок"
        value={t ? t.wrong : '—'}
        deltaLabel={t ? `активных ${days(t.activeDays)}` : undefined}
        loading={loading}
        deltaDirection="none"
      />
      <StatTile
        animate
        icon="time"
        iconColor="var(--color-warning)"
        label="Время занятий"
        value={t && t.timeSpentMs > 0 ? formatDurationLong(t.timeSpentMs) : '—'}
        deltaLabel={
          t?.averageTimeMs ? `в среднем ${formatDuration(t.averageTimeMs)} на ответ` : 'нет данных'
        }
        loading={loading}
        deltaDirection="none"
      />
    </div>
  );
}

/** «Распределение по предметам» for the period. */
export function PeriodSubjects({
  stats,
  period,
}: {
  stats: PeriodStatsState;
  period: StatsPeriodId;
}) {
  const rows = stats.status === 'ready' ? stats.data.bySubject : null;
  const max = rows?.reduce((m, r) => Math.max(m, r.answers), 0) ?? 0;
  return (
    <Card className={styles.card} aria-label="Распределение по предметам">
      <div className={styles.head}>
        <p className="text-h3">По предметам</p>
        <p className="text-body-sm text-secondary">{STATS_PERIOD_LABELS[period]}</p>
      </div>
      {stats.status === 'loading' ? (
        <Skeleton height={64} aria-label="Загрузка распределения" />
      ) : stats.status === 'error' ? (
        <p className="text-body-sm text-secondary" role="alert">
          Не удалось загрузить.
        </p>
      ) : rows!.length === 0 ? (
        <p className="text-body-sm text-secondary">За этот период ответов нет.</p>
      ) : (
        <ul className={styles.list}>
          {rows!.map((r) => (
            <li key={r.subjectId} className={styles.row}>
              <span className={styles.name}>
                {subjects.find((s) => s.id === r.subjectId)?.shortName ?? r.subjectId}
              </span>
              <span className={styles.bar} aria-hidden="true">
                <span style={{ width: `${max ? (r.answers / max) * 100 : 0}%` }} />
              </span>
              <span className={styles.value}>
                {r.answers} отв. ·{' '}
                {r.accuracyPercent === null ? '—' : `${Math.round(r.accuracyPercent)}%`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
