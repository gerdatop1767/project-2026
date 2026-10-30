import { useMemo } from 'react';
import {
  CoordinatePlaneBase,
  type CoordinatePlaneBaseProps,
  type CoordinateTransform,
} from './CoordinatePlaneBase.js';

export interface FunctionGraphMarkedPoint {
  x: number;
  y: number;
  /** Optional text label — omit when the source graph marks the point with a bare dot only. */
  label?: string;
  /** Label position relative to the point — avoids the label overlapping the curve/axis. */
  labelOffset?: { dx: number; dy: number };
}

export interface FunctionGraphSVGProps {
  /** The function to plot — sampled densely across [xMin, xMax]. */
  fn: (x: number) => number;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  /** Grid line spacing on each axis (default 1). */
  gridStep?: number;
  /** 'unitOnly' matches a source graph that only labels 0 and the unit tick. */
  tickLabels?: CoordinatePlaneBaseProps['tickLabels'];
  /** Further functions drawn on the same axes (e.g. the line next to a parabola). */
  extraCurves?: readonly ((x: number) => number)[];
  squareCells?: boolean;
  maxWidth?: number;
  /** Points to mark on the curve/axes (roots, intercepts, ...) with a filled dot + optional label. */
  points?: readonly FunctionGraphMarkedPoint[];
  /** Dashed horizontal lines y = c, e.g. an asymptote the source draws dashed. */
  dashedHorizontals?: readonly number[];
  ariaLabel: string;
}

/**
 * A real, mathematically plotted function graph (not a static image) —
 * for tasks where the graph's algebraic form is fully determined by
 * the task's own given data (e.g. a parabola whose roots/intercept are
 * derived in the solution), so the curve drawn here is exactly the
 * function described, not an approximation or invention.
 */
export function FunctionGraphSVG({
  fn,
  xMin,
  xMax,
  yMin,
  yMax,
  gridStep = 1,
  tickLabels = 'all',
  extraCurves = [],
  squareCells,
  maxWidth,
  points = [],
  dashedHorizontals = [],
  ariaLabel,
}: FunctionGraphSVGProps) {
  return (
    <CoordinatePlaneBase
      xMin={xMin}
      xMax={xMax}
      yMin={yMin}
      yMax={yMax}
      gridStep={gridStep}
      tickLabels={tickLabels}
      squareCells={squareCells}
      maxWidth={maxWidth}
      ariaLabel={ariaLabel}
    >
      {({ toSvgX, toSvgY, clipPathUrl }: CoordinateTransform) => (
        <>
          {dashedHorizontals.map((c) => (
            <line
              key={`h${c}`}
              x1={toSvgX(xMin)}
              y1={toSvgY(c)}
              x2={toSvgX(xMax)}
              y2={toSvgY(c)}
              stroke="var(--color-text-secondary)"
              strokeWidth={1.25}
              strokeDasharray="6 4"
            />
          ))}
          {extraCurves.map((extra, i) => (
            <Curve
              key={i}
              fn={extra}
              xMin={xMin}
              xMax={xMax}
              yMin={yMin}
              yMax={yMax}
              toSvgX={toSvgX}
              toSvgY={toSvgY}
              clipPathUrl={clipPathUrl}
              points={[]}
            />
          ))}
          <Curve
            fn={fn}
            xMin={xMin}
            xMax={xMax}
            yMin={yMin}
            yMax={yMax}
            toSvgX={toSvgX}
            toSvgY={toSvgY}
            clipPathUrl={clipPathUrl}
            points={points}
          />
        </>
      )}
    </CoordinatePlaneBase>
  );
}

function Curve({
  fn,
  xMin,
  xMax,
  yMin,
  yMax,
  toSvgX,
  toSvgY,
  clipPathUrl,
  points,
}: {
  fn: (x: number) => number;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  toSvgX: (x: number) => number;
  toSvgY: (y: number) => number;
  clipPathUrl: string;
  points: readonly FunctionGraphMarkedPoint[];
}) {
  const curvePath = useMemo(() => {
    const steps = 400;
    const segments: string[] = [];
    // A point outside the drawn band (or where fn is undefined) breaks
    // the line: the next point starts a new segment, never a stray "L".
    let penDown = false;
    for (let i = 0; i <= steps; i += 1) {
      const x = xMin + (i / steps) * (xMax - xMin);
      const y = fn(x);
      if (
        Number.isFinite(y) &&
        y >= yMin - (yMax - yMin) * 0.2 &&
        y <= yMax + (yMax - yMin) * 0.2
      ) {
        segments.push(`${penDown ? 'L' : 'M'} ${toSvgX(x).toFixed(2)} ${toSvgY(y).toFixed(2)}`);
        penDown = true;
      } else {
        penDown = false;
      }
    }
    return segments.join(' ');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fn, xMin, xMax, yMin, yMax]);

  return (
    <>
      <path
        d={curvePath}
        fill="none"
        stroke="var(--color-text-primary)"
        strokeWidth={2.5}
        clipPath={clipPathUrl}
      />
      {points.map((p, i) => (
        <g key={i}>
          <circle cx={toSvgX(p.x)} cy={toSvgY(p.y)} r={3.5} fill="var(--color-accent-secondary)" />
          {p.label && (
            <text
              x={toSvgX(p.x) + (p.labelOffset?.dx ?? 6)}
              y={toSvgY(p.y) + (p.labelOffset?.dy ?? -6)}
              fontSize={12}
              fill="var(--color-text-primary)"
            >
              {p.label}
            </text>
          )}
        </g>
      ))}
    </>
  );
}
