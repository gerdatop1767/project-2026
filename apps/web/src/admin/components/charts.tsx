import { useState, type KeyboardEvent, type PointerEvent } from 'react';
import { num } from '../format.js';
import s from '../admin.module.css';
import c from './charts.module.css';

/**
 * Admin charts: plain SVG/DOM, one y-axis, thin marks, a legend for ≥2
 * series, a crosshair + tooltip on hover/touch/keyboard, and a table view
 * for every chart (identity is never colour-alone). Colours come from the
 * validated --admin-s1..s4 tokens in admin.module.css.
 */
export interface Series {
  key: string;
  label: string;
  color: string;
}

export interface ChartRow {
  label: string;
  values: Record<string, number | null>;
}

function niceMax(max: number): number {
  if (max <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(max));
  for (const step of [1, 2, 2.5, 5, 10]) if (max <= step * pow) return step * pow;
  return 10 * pow;
}

function Legend({ series }: { series: Series[] }) {
  if (series.length < 2) return null;
  return (
    <ul className={s.legend}>
      {series.map((sr) => (
        <li key={sr.key} className={s.legendItem}>
          <span className={s.swatch} style={{ background: sr.color }} aria-hidden="true" />
          {sr.label}
        </li>
      ))}
    </ul>
  );
}

function TableView({
  rows,
  series,
  caption,
}: {
  rows: ChartRow[];
  series: Series[];
  caption: string;
}) {
  return (
    <div className={s.tableWrap}>
      <table className={s.table}>
        <caption className={s.srOnly}>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Период</th>
            {series.map((sr) => (
              <th key={sr.key} scope="col" className={s.num}>
                {sr.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <td>{r.label}</td>
              {series.map((sr) => (
                <td key={sr.key} className={s.num}>
                  {num(r.values[sr.key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function useHover(n: number) {
  const [active, setActive] = useState<number | null>(null);
  const pick = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - rect.left) / Math.max(1, rect.width);
    setActive(Math.max(0, Math.min(n - 1, Math.round(x * (n - 1)))));
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowRight') setActive((a) => Math.min(n - 1, (a ?? -1) + 1));
    else if (event.key === 'ArrowLeft') setActive((a) => Math.max(0, (a ?? n) - 1));
    else if (event.key === 'Escape') setActive(null);
    else return;
    event.preventDefault();
  };
  return {
    active,
    handlers: {
      onPointerMove: pick,
      onPointerDown: pick,
      onPointerLeave: (e: PointerEvent<HTMLDivElement>) => {
        if (e.pointerType === 'mouse') setActive(null);
      },
      onKeyDown,
      onBlur: () => setActive(null),
    },
  };
}

function Tooltip({ row, series, x }: { row: ChartRow; series: Series[]; x: number }) {
  return (
    <div className={c.tooltip} style={{ ['--x' as string]: x }} aria-hidden="true">
      <strong>{row.label}</strong>
      {series.map((sr) => (
        <span key={sr.key} className={c.tipRow}>
          <span className={s.swatch} style={{ background: sr.color }} />
          {sr.label}: <b>{num(row.values[sr.key])}</b>
        </span>
      ))}
    </div>
  );
}

const W = 600;
const H = 180;

/** Several series over time on ONE shared axis (counts of the same unit). */
export function LineSeriesChart({
  rows,
  series,
  title,
  labelEvery,
  unit,
}: {
  rows: ChartRow[];
  series: Series[];
  title: string;
  labelEvery?: number;
  /** What the y-axis counts, e.g. «человек», «ответов». */
  unit?: string;
}) {
  const [asTable, setAsTable] = useState(false);
  const { active, handlers } = useHover(rows.length);
  const max = niceMax(
    Math.max(0, ...rows.flatMap((r) => series.map((sr) => r.values[sr.key] ?? 0))),
  );
  if (rows.length === 0) return <p className={s.muted}>Нет данных за период.</p>;
  const n = rows.length;
  const xPct = (i: number) => (n > 1 ? (i / (n - 1)) * 100 : 50);
  const y = (v: number) => H - (v / max) * H;
  const every = labelEvery ?? Math.max(1, Math.ceil(n / 8));
  return (
    <div>
      <div className={c.chartHead}>
        {unit && <span className={c.unit}>{unit}</span>}
        <Legend series={series} />
        <button type="button" className={c.toggle} onClick={() => setAsTable((v) => !v)}>
          {asTable ? 'График' : 'Таблица'}
        </button>
      </div>
      {asTable ? (
        <TableView rows={rows} series={series} caption={title} />
      ) : (
        <>
          <div className={c.frame}>
            <div className={c.axis} aria-hidden="true">
              <span>{num(max)}</span>
              <span>{num(max / 2)}</span>
              <span>0</span>
            </div>
            <div
              className={c.plot}
              role="group"
              aria-label={`${title}. Стрелки влево и вправо выбирают период, кнопка «Таблица» показывает все значения.`}
              tabIndex={0}
              {...handlers}
            >
              <svg
                viewBox={`0 0 ${W} ${H}`}
                preserveAspectRatio="none"
                className={c.svg}
                aria-hidden="true"
              >
                {[0, 0.5, 1].map((g) => (
                  <line key={g} x1={0} x2={W} y1={H * g} y2={H * g} className={c.grid} />
                ))}
                {series.map((sr) => (
                  <path
                    key={sr.key}
                    d={rows
                      .map(
                        (r, i) =>
                          `${i === 0 ? 'M' : 'L'}${(xPct(i) / 100) * W},${y(r.values[sr.key] ?? 0)}`,
                      )
                      .join(' ')}
                    fill="none"
                    stroke={sr.color}
                    strokeWidth={2}
                    vectorEffect="non-scaling-stroke"
                    strokeLinejoin="round"
                  />
                ))}
              </svg>
              {active !== null && rows[active] && (
                <>
                  <span className={c.guide} style={{ left: `${xPct(active)}%` }} />
                  {series.map((sr) => (
                    <span
                      key={sr.key}
                      className={c.dot}
                      style={{
                        left: `${xPct(active)}%`,
                        top: `${(y(rows[active]!.values[sr.key] ?? 0) / H) * 100}%`,
                        background: sr.color,
                      }}
                    />
                  ))}
                  <Tooltip row={rows[active]!} series={series} x={xPct(active)} />
                </>
              )}
            </div>
          </div>
          <div className={c.labels} aria-hidden="true">
            {rows.map((r, i) =>
              i % every === 0 ? (
                <span key={r.label} style={{ left: `${xPct(i)}%` }}>
                  {r.label}
                </span>
              ) : null,
            )}
          </div>
          <p className={s.srOnly} aria-live="polite">
            {active !== null && rows[active]
              ? `${rows[active]!.label}: ${series.map((sr) => `${sr.label} ${num(rows[active]!.values[sr.key])}`).join(', ')}`
              : ''}
          </p>
        </>
      )}
    </div>
  );
}

/** Stacked columns (parts of one whole per period), 2px surface gaps. */
export function StackedBarsChart({
  rows,
  series,
  title,
  unit,
}: {
  rows: ChartRow[];
  series: Series[];
  title: string;
  unit?: string;
}) {
  const [asTable, setAsTable] = useState(false);
  const { active, handlers } = useHover(rows.length);
  const totals = rows.map((r) => series.reduce((sum, sr) => sum + (r.values[sr.key] ?? 0), 0));
  const max = niceMax(Math.max(0, ...totals));
  const n = rows.length;
  const every = Math.max(1, Math.ceil(n / 8));
  return (
    <div>
      <div className={c.chartHead}>
        {unit && <span className={c.unit}>{unit}</span>}
        <Legend series={series} />
        <button type="button" className={c.toggle} onClick={() => setAsTable((v) => !v)}>
          {asTable ? 'График' : 'Таблица'}
        </button>
      </div>
      {asTable ? (
        <TableView rows={rows} series={series} caption={title} />
      ) : (
        <>
          <div className={c.frame}>
            <div className={c.axis} aria-hidden="true">
              <span>{num(max)}</span>
              <span>{num(max / 2)}</span>
              <span>0</span>
            </div>
            <div
              className={c.bars}
              role="group"
              aria-label={`${title}. Стрелки влево и вправо выбирают период.`}
              tabIndex={0}
              {...handlers}
            >
              {rows.map((r, i) => (
                <div key={r.label} className={c.barCol} data-active={active === i || undefined}>
                  {series.map((sr) => {
                    const v = r.values[sr.key] ?? 0;
                    return v > 0 ? (
                      <span
                        key={sr.key}
                        className={c.barSeg}
                        style={{ height: `${(v / max) * 100}%`, background: sr.color }}
                      />
                    ) : null;
                  })}
                </div>
              ))}
              {active !== null && rows[active] && (
                <Tooltip
                  row={rows[active]!}
                  series={series}
                  x={n > 1 ? ((active + 0.5) / n) * 100 : 50}
                />
              )}
            </div>
          </div>
          <div className={c.labels} aria-hidden="true">
            {rows.map((r, i) =>
              i % every === 0 ? (
                <span key={r.label} style={{ left: `${((i + 0.5) / n) * 100}%` }}>
                  {r.label}
                </span>
              ) : null,
            )}
          </div>
          <p className={s.srOnly} aria-live="polite">
            {active !== null && rows[active]
              ? `${rows[active]!.label}: ${series.map((sr) => `${sr.label} ${num(rows[active]!.values[sr.key])}`).join(', ')}`
              : ''}
          </p>
        </>
      )}
    </div>
  );
}

/** Horizontal bars for ranked categories / funnel steps, values labelled. */
export function HBars({
  items,
  color = 'var(--admin-s1)',
}: {
  items: { label: string; value: number; detail?: string; color?: string }[];
  color?: string;
}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className={c.hbars}>
      {items.map((item) => (
        <li key={item.label} className={c.hbar}>
          <span className={c.hbarLabel}>{item.label}</span>
          <span className={c.hbarTrack}>
            <span
              className={c.hbarFill}
              style={{ width: `${(item.value / max) * 100}%`, background: item.color ?? color }}
            />
          </span>
          <span className={c.hbarValue}>
            {num(item.value)}
            {item.detail && <span className={s.muted}> · {item.detail}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}
