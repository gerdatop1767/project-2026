import type { ReactElement } from 'react';
import { mathFigures } from './mathFigures.js';
import { mathFiguresPart2 } from './mathFiguresPart2.js';
import styles from './TheoryFigure.module.css';

/**
 * Exact drawings for the theory (`![[id]]` in a theory file). Every number
 * on a drawing is computed here from the same data the text uses, so a
 * picture can never disagree with its explanation. Colours come from the
 * theme tokens, so drawings read in the dark and the light theme alike.
 */

interface Bar {
  label: string;
  /** Probability as a fraction p/q, drawn as its exact value. */
  p: number;
  q: number;
}

/** A discrete distribution as bars, with the expectation marked. */
function DistributionChart({
  bars,
  title,
  xName,
}: {
  bars: readonly Bar[];
  title: string;
  xName: string;
}) {
  const W = 320;
  const H = 216;
  const left = 44;
  const bottom = 34;
  // Room above the bars for the E(X) label, so it never meets a bar label.
  const top = 36;
  const plotW = W - left - 16;
  const plotH = H - top - bottom;
  const maxP = Math.max(...bars.map((b) => b.p / b.q));
  const yMax = Math.ceil(maxP * 4) / 4; // round up to a quarter
  const slot = plotW / bars.length;
  const values = bars.map((b) => Number(b.label));
  const mean = bars.reduce((s, b, i) => s + values[i]! * (b.p / b.q), 0);
  // Expectation on the same axis as the bars (between slot centres).
  const xOf = (v: number) => {
    const first = values[0]!;
    const step = values.length > 1 ? values[1]! - first : 1;
    return left + slot * ((v - first) / step + 0.5);
  };
  const yOf = (p: number) => top + plotH * (1 - p / yMax);
  const ticks = [0, yMax / 2, yMax];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={styles.svg} role="img" aria-label={title}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={left} x2={W - 16} y1={yOf(t)} y2={yOf(t)} className={styles.grid} />
          <text x={left - 6} y={yOf(t) + 4} className={styles.tickY}>
            {String(Math.round(t * 100) / 100).replace('.', ',')}
          </text>
        </g>
      ))}
      {bars.map((b, i) => {
        const x = left + slot * i + slot * 0.22;
        const y = yOf(b.p / b.q);
        return (
          <g key={b.label}>
            <rect
              x={x}
              y={y}
              width={slot * 0.56}
              height={top + plotH - y}
              rx={4}
              className={styles.bar}
            />
            <text x={x + slot * 0.28} y={y - 5} className={styles.barLabel}>
              {b.p}/{b.q}
            </text>
            <text x={x + slot * 0.28} y={H - bottom + 18} className={styles.tickX}>
              {b.label}
            </text>
          </g>
        );
      })}
      <line x1={left} x2={W - 16} y1={top + plotH} y2={top + plotH} className={styles.axis} />
      <line x1={xOf(mean)} x2={xOf(mean)} y1={18} y2={top + plotH} className={styles.meanLine} />
      <text x={xOf(mean)} y={12} className={styles.meanLabel}>
        E(X) = {String(mean).replace('.', ',')}
      </text>
      <text x={W - 16} y={H - 4} className={styles.axisName}>
        {xName}
      </text>
    </svg>
  );
}

/** Remaining debt month by month: differentiated vs annuity payments. */
function DebtScheduleChart() {
  // 1 200 000 ₽ for 6 months at 2 % a month — the numbers of the worked
  // example in the text («Финансовая математика»).
  const S = 1200;
  const r = 0.02;
  const n = 6;
  const diff = Array.from({ length: n + 1 }, (_, k) => S - (S / n) * k);
  const q = 1 + r;
  const x = (S * q ** n * (q - 1)) / (q ** n - 1);
  const ann: number[] = [S];
  for (let k = 1; k <= n; k++) ann.push(ann[k - 1]! * q - x);
  ann[n] = 0;

  const W = 320;
  const H = 210;
  const left = 46;
  const top = 16;
  const bottom = 36;
  const plotW = W - left - 14;
  const plotH = H - top - bottom;
  const xOf = (k: number) => left + (plotW * k) / n;
  const yOf = (v: number) => top + plotH * (1 - v / S);
  const path = (vals: readonly number[]) =>
    vals.map((v, k) => `${k === 0 ? 'M' : 'L'}${xOf(k).toFixed(1)},${yOf(v).toFixed(1)}`).join(' ');

  return (
    <>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className={styles.svg}
        role="img"
        aria-label="Остаток долга по месяцам: дифференцированные и аннуитетные платежи"
      >
        {[0, S / 2, S].map((v) => (
          <g key={v}>
            <line x1={left} x2={W - 14} y1={yOf(v)} y2={yOf(v)} className={styles.grid} />
            <text x={left - 6} y={yOf(v) + 4} className={styles.tickY}>
              {v}
            </text>
          </g>
        ))}
        {diff.map((_, k) => (
          <text key={k} x={xOf(k)} y={H - bottom + 16} className={styles.tickX}>
            {k}
          </text>
        ))}
        <path d={path(diff)} className={styles.lineA} />
        <path d={path(ann)} className={styles.lineB} />
        {diff.map((v, k) => (
          <circle key={`a${k}`} cx={xOf(k)} cy={yOf(v)} r={3} className={styles.dotA} />
        ))}
        {ann.map((v, k) => (
          <circle key={`b${k}`} cx={xOf(k)} cy={yOf(v)} r={3} className={styles.dotB} />
        ))}
        <text x={W - 14} y={H - 2} className={styles.axisName}>
          месяц
        </text>
        <text x={left} y={top - 4} className={styles.axisNameLeft}>
          долг, тыс. ₽
        </text>
      </svg>
      <ul className={styles.legendList}>
        <li>
          <span className={styles.swatchA} aria-hidden="true" /> дифференцированные платежи: долг
          уменьшается равными долями
        </li>
        <li>
          <span className={styles.swatchB} aria-hidden="true" /> аннуитет: равные платежи, долг
          сначала уменьшается медленнее
        </li>
      </ul>
    </>
  );
}

const figures: Record<string, () => ReactElement> = {
  'rv-two-coins': () => (
    <DistributionChart
      title="Распределение числа орлов при двух бросках монеты"
      xName="X — число орлов"
      bars={[
        { label: '0', p: 1, q: 4 },
        { label: '1', p: 1, q: 2 },
        { label: '2', p: 1, q: 4 },
      ]}
    />
  ),
  'rv-die': () => (
    <DistributionChart
      title="Распределение очков на игральной кости"
      xName="X — очки"
      bars={['1', '2', '3', '4', '5', '6'].map((label) => ({ label, p: 1, q: 6 }))}
    />
  ),
  'finance-debt-schedule': () => <DebtScheduleChart />,
  ...mathFigures,
  ...mathFiguresPart2,
};

export const theoryFigureIds: readonly string[] = Object.keys(figures);

export function TheoryFigure({ id }: { id: string }) {
  const Figure = figures[id];
  if (!Figure) return null;
  return (
    <div className={styles.frame}>
      <Figure />
    </div>
  );
}
