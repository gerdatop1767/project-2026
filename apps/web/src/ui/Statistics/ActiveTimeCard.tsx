import { useEffect, useState } from 'react';
import type { ActivityDay, ActivityStatsResponse } from '@zybrilka/shared';
import { getActivityStats } from '../../lib/api.js';
import { formatDurationLong } from '../../lib/statisticsDetailFormat.js';
import { BarChart } from '../Charts/BarChart.js';
import { Card } from '../Card/Card.js';
import { Icon } from '../Icon/Icon.js';
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
        Считается только активное время: страница открыта и ты что-то делаешь. Вкладка без действий,
        свёрнутое приложение и несколько вкладок сразу время не добавляют.
      </p>
    </div>
  );
}

/** «Время на платформе» in the profile: the signed-in user's own. */
export function ActiveTimeCard() {
  const [data, setData] = useState<ActivityStatsResponse | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    getActivityStats().then(
      (d) => live && setData(d),
      () => live && setData(null),
    );
    return () => {
      live = false;
    };
  }, []);
  return (
    <Card>
      <h2 className={styles.title}>
        <Icon name="time" size={20} /> Время на платформе
      </h2>
      <ActiveTimeView data={data} />
    </Card>
  );
}
