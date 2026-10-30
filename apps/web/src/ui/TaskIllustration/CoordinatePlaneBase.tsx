import { useId, type ReactNode } from 'react';

export const PLANE_PADDING = 28;
export const PLANE_VIEW_W = 400;
export const PLANE_VIEW_H = 280;

export interface CoordinateTransform {
  toSvgX: (x: number) => number;
  toSvgY: (y: number) => number;
  /** Clips to the plotted area — for curves that leave the grid. */
  clipPathUrl: string;
}

export interface CoordinatePlaneBaseProps {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  /** Grid line spacing on each axis (default 1). */
  gridStep?: number;
  /**
   * 'all' numbers every grid line (needed when a task's own coordinates
   * must be read precisely off the axes, e.g. plotted vectors). 'unitOnly'
   * labels just 0 and the first unit tick on each axis — for tasks whose
   * printed original only marks the unit length, not a numbered grid.
   */
  tickLabels?:
    'all' | 'unitOnly' | { readonly x: readonly number[]; readonly y: readonly number[] };
  /**
   * Square grid cells (the printed ЕГЭ grids are square): the view's
   * height follows from the x/y ranges instead of the fixed 400×280, and
   * the drawing is capped at `maxWidth` px so a tall grid stays a
   * sensible size on a wide screen.
   */
  squareCells?: boolean;
  maxWidth?: number;
  /**
   * Which side of the y-axis the origin's «0» sits on. 'left' is for a
   * grid with narrow cells, where «0» to the right would run into the
   * «1» tick one cell away (as the printed original places it).
   */
  originLabel?: 'right' | 'left';
  /** Which side of the y-axis its tick numbers sit on (the curve may run along the other). */
  yTickSide?: 'left' | 'right';
  ariaLabel: string;
  /** Anything plotted on top of the grid/axes — a curve, vectors, points. */
  children: (transform: CoordinateTransform) => ReactNode;
}

/**
 * The shared grid+axes chrome behind every coordinate-based
 * illustration (function_graph, coordinate_plane) — one visual
 * language (line weights, grid color, tick labels, arrowheads) across
 * every task that plots something on x/y axes, instead of each
 * renderer drawing its own.
 */
export function CoordinatePlaneBase({
  xMin,
  xMax,
  yMin,
  yMax,
  gridStep = 1,
  tickLabels = 'all',
  squareCells = false,
  maxWidth,
  originLabel = 'right',
  yTickSide = 'left',
  ariaLabel,
  children,
}: CoordinatePlaneBaseProps) {
  const plotW = PLANE_VIEW_W - 2 * PLANE_PADDING;
  const plotH = squareCells
    ? (plotW / (xMax - xMin)) * (yMax - yMin)
    : PLANE_VIEW_H - 2 * PLANE_PADDING;
  const viewH = plotH + 2 * PLANE_PADDING;
  const clipId = `cp-clip-${useId().replace(/:/g, '')}`;
  // The ЕГЭ grids are read cell by cell, at phone width: a visible grid
  // and labels that stay legible once the 400-wide view is scaled down.
  const gridStroke = squareCells
    ? 'color-mix(in srgb, var(--color-text-secondary) 38%, transparent)'
    : 'var(--color-border-subtle)';
  const tickFont = squareCells ? 14 : 11;
  const axisFont = squareCells ? 16 : 13;

  const toSvgX = (x: number) => PLANE_PADDING + ((x - xMin) / (xMax - xMin)) * plotW;
  const toSvgY = (y: number) => PLANE_PADDING + plotH - ((y - yMin) / (yMax - yMin)) * plotH;

  const verticalGridLines = [];
  for (let x = Math.ceil(xMin / gridStep) * gridStep; x <= xMax; x += gridStep) {
    verticalGridLines.push(x);
  }
  const horizontalGridLines = [];
  for (let y = Math.ceil(yMin / gridStep) * gridStep; y <= yMax; y += gridStep) {
    horizontalGridLines.push(y);
  }

  return (
    <svg
      viewBox={`0 0 ${PLANE_VIEW_W} ${viewH}`}
      role="img"
      aria-label={ariaLabel}
      style={{
        width: '100%',
        height: 'auto',
        display: 'block',
        ...(maxWidth ? { maxWidth, marginInline: 'auto' } : {}),
      }}
    >
      {verticalGridLines.map((x) => (
        <line
          key={`v${x}`}
          x1={toSvgX(x)}
          y1={PLANE_PADDING}
          x2={toSvgX(x)}
          y2={viewH - PLANE_PADDING}
          style={{ stroke: gridStroke }}
          strokeWidth={1}
        />
      ))}
      {horizontalGridLines.map((y) => (
        <line
          key={`h${y}`}
          x1={PLANE_PADDING}
          y1={toSvgY(y)}
          x2={PLANE_VIEW_W - PLANE_PADDING}
          y2={toSvgY(y)}
          style={{ stroke: gridStroke }}
          strokeWidth={1}
        />
      ))}

      <defs>
        <marker id="cp-arrow" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto">
          <path d="M0,0 L8,4 L0,8 Z" fill="var(--color-text-primary)" />
        </marker>
      </defs>

      <line
        x1={PLANE_PADDING}
        y1={toSvgY(0)}
        x2={PLANE_VIEW_W - PLANE_PADDING}
        y2={toSvgY(0)}
        stroke="var(--color-text-primary)"
        strokeWidth={1.5}
        markerEnd="url(#cp-arrow)"
      />
      <line
        x1={toSvgX(0)}
        y1={viewH - PLANE_PADDING}
        x2={toSvgX(0)}
        y2={PLANE_PADDING}
        stroke="var(--color-text-primary)"
        strokeWidth={1.5}
        markerEnd="url(#cp-arrow)"
      />

      <text
        x={PLANE_VIEW_W - PLANE_PADDING + 10}
        y={toSvgY(0) + 4}
        fontSize={axisFont}
        fontStyle="italic"
        fill="var(--color-text-secondary)"
      >
        x
      </text>
      <text
        x={toSvgX(0) - 14}
        y={PLANE_PADDING - 8}
        fontSize={axisFont}
        fontStyle="italic"
        fill="var(--color-text-secondary)"
      >
        y
      </text>
      <text
        x={originLabel === 'left' ? toSvgX(0) - 4 : toSvgX(0) + 4}
        y={toSvgY(0) + 14}
        fontSize={tickFont}
        textAnchor={originLabel === 'left' ? 'end' : 'start'}
        fill="var(--color-text-secondary)"
      >
        0
      </text>

      {(tickLabels === 'all'
        ? verticalGridLines.filter((x) => x !== 0)
        : (tickLabels === 'unitOnly' ? [1] : tickLabels.x).filter((x) => x >= xMin && x <= xMax)
      ).map((x) => (
        <text
          key={`vx${x}`}
          x={toSvgX(x)}
          y={toSvgY(0) + 14}
          fontSize={tickFont}
          textAnchor="middle"
          fill="var(--color-text-secondary)"
        >
          {x}
        </text>
      ))}
      {(tickLabels === 'all'
        ? horizontalGridLines.filter((y) => y !== 0)
        : (tickLabels === 'unitOnly' ? [1] : tickLabels.y).filter((y) => y >= yMin && y <= yMax)
      ).map((y) => (
        <text
          key={`hy${y}`}
          x={yTickSide === 'right' ? toSvgX(0) + 8 : toSvgX(0) - 8}
          y={toSvgY(y) + 4}
          fontSize={tickFont}
          textAnchor={yTickSide === 'right' ? 'start' : 'end'}
          fill="var(--color-text-secondary)"
        >
          {y}
        </text>
      ))}

      <clipPath id={clipId}>
        <rect x={PLANE_PADDING} y={PLANE_PADDING} width={plotW} height={plotH} />
      </clipPath>
      {children({ toSvgX, toSvgY, clipPathUrl: `url(#${clipId})` })}
    </svg>
  );
}
