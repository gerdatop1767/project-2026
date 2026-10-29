import { useMemo } from 'react';

export interface TracedGraphMark {
  /** Abscissa marked on the x-axis; a dot on the curve and a dashed line join them. */
  x: number;
  label: string;
}

export interface TracedGraphSVGProps {
  /** [x, y] points read off the printed curve, left to right (plane units). */
  waypoints: readonly (readonly [number, number])[];
  marks: readonly TracedGraphMark[];
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  maxWidth?: number;
  ariaLabel: string;
}

const VIEW_W = 400;
const PAD = 26;

/**
 * A graph with no formula behind it — a printed curve digitised point by
 * point (same idea as Task8DerivativeGraphSVG) and drawn as a smooth
 * Catmull-Rom spline through those points, on bare axes with the marked
 * abscissas the task asks about: a dashed line from the axis up/down to
 * a dot on the curve, the label on the far side of the axis from the dot.
 * Equal scale on both axes, so slopes look as steep as in the original.
 */
export function TracedGraphSVG({
  waypoints,
  marks,
  xMin,
  xMax,
  yMin,
  yMax,
  maxWidth = 440,
  ariaLabel,
}: TracedGraphSVGProps) {
  const unit = (VIEW_W - 2 * PAD) / (xMax - xMin);
  const viewH = unit * (yMax - yMin) + 2 * PAD;
  const toX = (x: number) => PAD + (x - xMin) * unit;
  const toY = (y: number) => PAD + (yMax - y) * unit;

  const path = useMemo(() => {
    const p = waypoints.map(([x, y]) => [toX(x), toY(y)] as const);
    let d = `M ${p[0]![0].toFixed(1)} ${p[0]![1].toFixed(1)}`;
    for (let i = 0; i < p.length - 1; i += 1) {
      const p0 = p[Math.max(0, i - 1)]!;
      const p1 = p[i]!;
      const p2 = p[i + 1]!;
      const p3 = p[Math.min(p.length - 1, i + 2)]!;
      const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
      const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
      d += ` C ${c1[0]!.toFixed(1)} ${c1[1]!.toFixed(1)}, ${c2[0]!.toFixed(1)} ${c2[1]!.toFixed(1)}, ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
    }
    return d;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waypoints, xMin, xMax, yMin, yMax]);

  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${viewH.toFixed(1)}`}
      role="img"
      aria-label={ariaLabel}
      style={{ width: '100%', height: 'auto', display: 'block', maxWidth, marginInline: 'auto' }}
    >
      <defs>
        <marker id="tg-arrow" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto">
          <path d="M0,0 L8,4 L0,8 Z" fill="var(--color-text-primary)" />
        </marker>
      </defs>
      <line
        x1={PAD - 6}
        y1={toY(0)}
        x2={VIEW_W - PAD + 10}
        y2={toY(0)}
        stroke="var(--color-text-primary)"
        strokeWidth={1.5}
        markerEnd="url(#tg-arrow)"
      />
      <line
        x1={toX(0)}
        y1={viewH - PAD + 6}
        x2={toX(0)}
        y2={PAD - 10}
        stroke="var(--color-text-primary)"
        strokeWidth={1.5}
        markerEnd="url(#tg-arrow)"
      />
      <text
        x={VIEW_W - PAD + 8}
        y={toY(0) + 18}
        fontSize={13}
        fontStyle="italic"
        fill="var(--color-text-secondary)"
      >
        x
      </text>
      <text
        x={toX(0) - 14}
        y={PAD - 6}
        fontSize={13}
        fontStyle="italic"
        fill="var(--color-text-secondary)"
      >
        y
      </text>

      {marks.map((m) => {
        const y = curveY(waypoints, m.x);
        const above = y > 0;
        return (
          <g key={m.x}>
            <line
              x1={toX(m.x)}
              y1={toY(0)}
              x2={toX(m.x)}
              y2={toY(y)}
              stroke="var(--color-text-secondary)"
              strokeWidth={1}
              strokeDasharray="4 3"
            />
            <text
              x={toX(m.x)}
              y={above ? toY(0) + 16 : toY(0) - 7}
              fontSize={12}
              textAnchor="middle"
              fill="var(--color-text-secondary)"
            >
              {m.label}
            </text>
          </g>
        );
      })}

      <path d={path} fill="none" stroke="var(--color-text-primary)" strokeWidth={2.25} />

      {marks.map((m) => (
        <circle
          key={m.x}
          cx={toX(m.x)}
          cy={toY(curveY(waypoints, m.x))}
          r={3.5}
          fill="var(--color-accent-secondary)"
        />
      ))}
    </svg>
  );
}

/** Height of the traced curve at x, by linear interpolation between waypoints. */
export function curveY(waypoints: readonly (readonly [number, number])[], x: number): number {
  for (let i = 0; i < waypoints.length - 1; i += 1) {
    const [x0, y0] = waypoints[i]!;
    const [x1, y1] = waypoints[i + 1]!;
    if (x >= x0 && x <= x1) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
  throw new Error(`x=${x} is outside the traced curve`);
}
