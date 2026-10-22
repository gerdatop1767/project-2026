import { useId, type CSSProperties } from 'react';
import { clsx } from '../../lib/clsx.js';
import { ChartTooltip, chartAnnouncement, type ChartTooltipContent } from './ChartTooltip.js';
import { useChartSelection } from './useChartSelection.js';
import styles from './LineChart.module.css';

export interface LineChartPoint {
  label: string;
  value: number;
  /** What the tooltip says about this point; defaults to label + value %. */
  tooltip?: ChartTooltipContent;
}

export interface LineChartProps {
  points: readonly LineChartPoint[];
  max?: number;
  labelEvery?: number;
  ariaLabel?: string;
  className?: string;
}

const VIEW_W = 600;
const VIEW_H = 160;
/** Above this many points the dots would merge into a bead string — only the picked one shows. */
const MAX_DOTS = 31;

/**
 * Lightweight SVG line chart (Statistics — "Динамика правильных
 * ответов"). The line draws itself in once; tap/hover/drag or ←/→ snaps
 * to the nearest day, shows a guide, a highlighted point and a tooltip
 * with its exact percentage and the related numbers.
 *
 * The SVG is stretched to the card (`preserveAspectRatio="none"`), so the
 * round markers are HTML on top of it — in the SVG they became ellipses.
 */
export function LineChart({
  points,
  max = 100,
  labelEvery = 1,
  ariaLabel = 'График динамики правильных ответов',
  className,
}: LineChartProps) {
  const gradientId = useId();
  const { ref, active, handlers } = useChartSelection(points.length, 'point');
  if (points.length === 0) return null;

  const n = points.length;
  const xPct = (i: number) => (n > 1 ? (i / (n - 1)) * 100 : 50);
  const yPct = (v: number) => 100 - (Math.min(max, Math.max(0, v)) / max) * 100;

  const linePath = points
    .map(
      (p, i) =>
        `${i === 0 ? 'M' : 'L'}${(xPct(i) / 100) * VIEW_W},${(yPct(p.value) / 100) * VIEW_H}`,
    )
    .join(' ');
  const areaPath = `${linePath} L${(xPct(n - 1) / 100) * VIEW_W},${VIEW_H} L0,${VIEW_H} Z`;

  const activePoint = active !== null ? points[active] : undefined;
  const tooltip: ChartTooltipContent | null = activePoint
    ? (activePoint.tooltip ?? { title: activePoint.label, value: `${activePoint.value}%` })
    : null;

  return (
    <div className={styles.wrap}>
      <div
        ref={ref}
        className={clsx(styles.chart, className)}
        role="group"
        aria-roledescription="график"
        aria-label={`${ariaLabel}. Стрелки влево и вправо выбирают день.`}
        tabIndex={0}
        {...handlers}
      >
        {tooltip && active !== null && <ChartTooltip x={xPct(active)} content={tooltip} />}
        <div className={styles.plot}>
          <svg
            className={styles.svg}
            viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <defs>
              <linearGradient id={`lineChartGradient-${gradientId}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--color-accent-primary-end)" />
                <stop offset="100%" stopColor="var(--color-accent-primary-end)" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path
              className={styles.area}
              d={areaPath}
              style={{ fill: `url(#lineChartGradient-${gradientId})` }}
            />
            <path className={styles.line} d={linePath} pathLength={1} />
          </svg>
          {n <= MAX_DOTS &&
            points.map((p, i) => (
              <span
                key={i}
                className={styles.dot}
                style={{ left: `${xPct(i)}%`, top: `${yPct(p.value)}%` } as CSSProperties}
              />
            ))}
          {active !== null && activePoint && (
            <>
              <span className={styles.guide} style={{ left: `${xPct(active)}%` }} />
              <span
                className={styles.activeDot}
                style={{ left: `${xPct(active)}%`, top: `${yPct(activePoint.value)}%` }}
              />
            </>
          )}
        </div>
      </div>
      <div className={styles.labels} aria-hidden="true">
        {points.map((p, i) =>
          i % labelEvery === 0 ? (
            <span
              key={i}
              className={styles.label}
              style={{ ['--x' as string]: xPct(i) } as CSSProperties}
            >
              {p.label}
            </span>
          ) : null,
        )}
      </div>
      <p className={styles.srOnly} aria-live="polite">
        {chartAnnouncement(tooltip)}
      </p>
    </div>
  );
}
