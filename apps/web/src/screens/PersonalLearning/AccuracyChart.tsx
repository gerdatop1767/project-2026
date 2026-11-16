import type { AccuracyPoint } from '@zybrilka/shared';
import styles from '../../ui/PersonalLearning/PersonalLearning.module.css';

const W = 600;
const H = 180;
const PAD = 24;

/**
 * 30 days of one number: bars = answers per day, line = accuracy of the
 * last 7 days (gaps where there were no answers). Only real attempts.
 */
export function AccuracyChart({ series }: { series: readonly AccuracyPoint[] }) {
  const maxAttempts = Math.max(1, ...series.map((p) => p.attempts));
  const step = (W - PAD * 2) / Math.max(1, series.length - 1);
  const x = (i: number) => PAD + i * step;
  const y = (acc: number) => H - PAD - ((H - PAD * 2) * acc) / 100;
  const segments: string[] = [];
  let current = '';
  series.forEach((p, i) => {
    if (p.rolling7 === null) {
      if (current) segments.push(current);
      current = '';
      return;
    }
    current += `${current ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.rolling7).toFixed(1)}`;
  });
  if (current) segments.push(current);
  const withData = series.filter((p) => p.rolling7 !== null);
  const last = withData[withData.length - 1];
  const label = last
    ? `Точность за 7 дней на ${last.date}: ${last.rolling7}%. Ответов за 30 дней: ${series.reduce((s, p) => s + p.attempts, 0)}.`
    : 'За последние 30 дней ответов не было.';
  return (
    <svg className={styles.chart} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      {[0, 50, 100].map((v) => (
        <g key={v}>
          <line
            x1={PAD}
            x2={W - PAD}
            y1={y(v)}
            y2={y(v)}
            stroke="currentColor"
            strokeOpacity={0.12}
          />
          <text x={2} y={y(v) + 4} fontSize={10} fill="currentColor" fillOpacity={0.5}>
            {v}%
          </text>
        </g>
      ))}
      {series.map((p, i) =>
        p.attempts > 0 ? (
          <rect
            key={p.date}
            x={x(i) - Math.max(2, step * 0.3)}
            width={Math.max(4, step * 0.6)}
            y={H - PAD - ((H - PAD * 2) * 0.35 * p.attempts) / maxAttempts}
            height={((H - PAD * 2) * 0.35 * p.attempts) / maxAttempts}
            rx={2}
            fill="var(--color-accent-primary)"
            fillOpacity={0.28}
          />
        ) : null,
      )}
      {segments.map((d, i) => (
        <path key={i} d={d} fill="none" stroke="#3ec9f5" strokeWidth={2.5} strokeLinecap="round" />
      ))}
    </svg>
  );
}
