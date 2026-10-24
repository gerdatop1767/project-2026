import type { CSSProperties } from 'react';
import { clsx } from '../../lib/clsx.js';
import { ChartTooltip, chartAnnouncement, type ChartTooltipContent } from './ChartTooltip.js';
import { useChartSelection } from './useChartSelection.js';
import styles from './BarChart.module.css';

export interface BarChartPoint {
  /** Short axis label ("18 окт."). */
  label: string;
  value: number;
  /** What the tooltip says about this bar; defaults to label + value. */
  tooltip?: ChartTooltipContent;
}

export interface BarChartProps {
  points: readonly BarChartPoint[];
  /** Show every Nth label to avoid crowding on long series. */
  labelEvery?: number;
  /** Accessible name of the chart. */
  ariaLabel?: string;
  className?: string;
}

/**
 * Lightweight bar chart (Statistics — "Активность по дням"): plain DOM
 * bars, no chart library. Tap/hover/drag or ←/→ picks a day and shows its
 * exact count in a tooltip that never leaves the card; the other bars dim.
 *
 * Motion is transform/opacity only: each bar is a full-height block scaled
 * to its value (`scaleY`), so it grows in once on mount and glides to its
 * new height when the period or subject changes — no layout per frame.
 */
export function BarChart({
  points,
  labelEvery = 1,
  ariaLabel = 'График активности по дням',
  className,
}: BarChartProps) {
  const max = Math.max(1, ...points.map((p) => p.value));
  const { ref, active, handlers } = useChartSelection(points.length, 'band');
  const activePoint = active !== null ? points[active] : undefined;
  const tooltip: ChartTooltipContent | null = activePoint
    ? (activePoint.tooltip ?? { title: activePoint.label, value: String(activePoint.value) })
    : null;
  const anchor = active !== null ? ((active + 0.5) / points.length) * 100 : 0;

  // 4 px between bars, but a long series (90 days on a 320 px phone) must
  // still fit every bar — today included — so the gap shrinks with it.
  const gap = points.length > 45 ? '1px' : points.length > 20 ? '2px' : '4px';

  return (
    <div className={styles.root} style={{ ['--gap' as string]: gap } as CSSProperties}>
      <div
        ref={ref}
        className={clsx(styles.chart, className)}
        role="group"
        aria-roledescription="график"
        aria-label={`${ariaLabel}. Стрелки влево и вправо выбирают день.`}
        tabIndex={0}
        data-has-active={active !== null || undefined}
        {...handlers}
      >
        {tooltip && <ChartTooltip x={anchor} content={tooltip} />}
        <div className={styles.bars}>
          {points.map((p, i) => (
            <div
              key={i}
              className={styles.barTrack}
              data-active={i === active || undefined}
              title={p.tooltip ? undefined : `${p.label}: ${p.value}`}
            >
              <div
                className={styles.bar}
                style={
                  {
                    // A zero still shows a 2 px stub, so the day is visibly "there".
                    ['--h' as string]: Math.max(p.value / max, 0.015),
                    ['--i' as string]: Math.min(i, 30),
                  } as CSSProperties
                }
              />
            </div>
          ))}
        </div>
      </div>
      <div className={styles.labels} aria-hidden="true">
        {points.map((p, i) => (
          <span key={i} className={styles.labelCell}>
            {i % labelEvery === 0 && <span>{p.label}</span>}
          </span>
        ))}
      </div>
      <p className={styles.srOnly} aria-live="polite">
        {chartAnnouncement(tooltip)}
      </p>
    </div>
  );
}
