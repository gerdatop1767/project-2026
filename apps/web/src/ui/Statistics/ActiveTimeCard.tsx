import type { ActivityDay, ActivityStatsResponse } from '@zybrilka/shared';
import { formatDurationLong } from '../../lib/statisticsDetailFormat.js';
import { BarChart } from '../Charts/BarChart.js';
import { SkeletonValue } from '../Skeleton/Skeleton.js';
import styles from './ActiveTimeCard.module.css';

const dayLabel = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});

/** «0 мин» when there was no activity — a real zero, not a missing number. */
export const activeTime = (seconds: number) =>
  seconds === 0 ? '0 мин' : formatDurationLong(seconds * 1000);

export function ActiveTimeView({ data }: { data: ActivityStatsResponse | null | undefined }) {
  const tiles = [
    { label: 'Сегодня', value: data?.todaySeconds },
    { label: '7 дней', value: data?.last7Seconds },
    { label: '30 дней', value: data?.last30Seconds },
    { label: 'Всё время', value: data?.allSeconds },
  ];
  const points = (data?.days ?? []).map((d: ActivityDay) => {
    const label = dayLabel.format(new Date(`${d.date}T00:00:00Z`));
    return {
      label,
      value: Math.round(d.seconds / 60),
      tooltip: { title: label, value: activeTime(d.seconds) },
    };
  });
  return (
    <div className={styles.body}>
      <dl className={styles.tiles}>
        {tiles.map((t) => (
          <div key={t.label} className={styles.tile}>
            <dt>{t.label}</dt>
            <dd>
              {t.value === undefined ? (
                data === null ? (
                  '—'
                ) : (
                  <SkeletonValue width="4ch" />
                )
              ) : (
                activeTime(t.value)
              )}
            </dd>
          </div>
        ))}
      </dl>
      {data && (
        <>
          <p className={styles.caption}>По дням, минуты — последние 30 дней</p>
          <BarChart points={points} labelEvery={7} ariaLabel="Активное время по дням, минуты" />
        </>
      )}
      <p className={styles.note}>
        Считается только активное время: страница открыта и пользователь что-то делает. Вкладка без
        действий, свёрнутое приложение и несколько вкладок сразу время не добавляют.
      </p>
    </div>
  );
}
