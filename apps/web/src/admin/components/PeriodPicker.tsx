import { useState } from 'react';
import { useAdminRouter } from '../router.js';
import s from '../admin.module.css';

export const periodOptions = [
  { value: 'today', label: 'Сегодня' },
  { value: 'yesterday', label: 'Вчера' },
  { value: '7d', label: '7 дней' },
  { value: '30d', label: '30 дней' },
  { value: '90d', label: '90 дней' },
  { value: 'month', label: 'Текущий месяц' },
  { value: 'prev_month', label: 'Прошлый месяц' },
  { value: 'year', label: 'Год' },
  { value: 'custom', label: 'Свой период' },
] as const;

/** The period (and granularity) from the URL — shared by every report page. */
export function usePeriodQuery(defaultPeriod = '30d') {
  const { location } = useAdminRouter();
  const p = location.params;
  const period = p.get('period') ?? defaultPeriod;
  return {
    period,
    from: period === 'custom' ? (p.get('from') ?? undefined) : undefined,
    to: period === 'custom' ? (p.get('to') ?? undefined) : undefined,
    granularity: p.get('granularity') ?? undefined,
  };
}

/**
 * Period presets + a custom range (Moscow dates). Kept in the URL so a
 * report can be bookmarked or shared with the same numbers.
 */
export function PeriodPicker({ withGranularity = false }: { withGranularity?: boolean }) {
  const { setParams } = useAdminRouter();
  const q = usePeriodQuery();
  const [from, setFrom] = useState(q.from ?? '');
  const [to, setTo] = useState(q.to ?? '');
  return (
    <div className={s.toolbar}>
      <label className={s.srOnly} htmlFor="admin-period">
        Период
      </label>
      <select
        id="admin-period"
        className={s.select}
        value={q.period}
        onChange={(e) =>
          setParams({
            period: e.target.value,
            ...(e.target.value === 'custom' ? {} : { from: null, to: null }),
          })
        }
      >
        {periodOptions.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {q.period === 'custom' && (
        <form
          className={s.toolbar}
          onSubmit={(e) => {
            e.preventDefault();
            setParams({ period: 'custom', from, to });
          }}
        >
          <label className={s.field}>
            С
            <input
              type="date"
              className={s.input}
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              required
            />
          </label>
          <label className={s.field}>
            По
            <input
              type="date"
              className={s.input}
              value={to}
              onChange={(e) => setTo(e.target.value)}
              required
            />
          </label>
          <button type="submit" className={s.button}>
            Применить
          </button>
        </form>
      )}
      {withGranularity && (
        <>
          <label className={s.srOnly} htmlFor="admin-granularity">
            Шаг
          </label>
          <select
            id="admin-granularity"
            className={s.select}
            value={q.granularity ?? ''}
            onChange={(e) => setParams({ granularity: e.target.value || null })}
          >
            <option value="">Шаг: авто</option>
            <option value="day">По дням</option>
            <option value="week">По неделям</option>
            <option value="month">По месяцам</option>
          </select>
        </>
      )}
    </div>
  );
}

export interface PeriodInfo {
  from: string;
  to: string;
  days: number;
  granularity: string;
  timezone: string;
  previous: { from: string; to: string };
}

/** «05.03.2026 – 11.03.2026 (МСК), сравнение с …» — explicit dates under every report. */
export function PeriodCaption({ period }: { period: PeriodInfo }) {
  const d = (x: string) => x.split('-').reverse().join('.');
  return (
    <p className={s.subtitle}>
      {d(period.from)} – {d(period.to)} · дни по Москве · сравнение с {d(period.previous.from)} –{' '}
      {d(period.previous.to)}
    </p>
  );
}
