import { useId } from 'react';
import { CoordinatePlaneBase, type CoordinatePlaneBaseProps } from './CoordinatePlaneBase.js';

export interface PlaneVector {
  x: number;
  y: number;
  /** Tail of the vector — the origin unless the source draws it elsewhere. */
  fromX?: number;
  fromY?: number;
  label: string;
  /**
   * Where the label sits (plane coordinates). Omitted: next to the tip,
   * as for a vector built from given coordinates. Given: the place the
   * printed original puts its name, and the label is drawn as a bare
   * vector name with an arrow over it — no coordinates, since reading
   * them off the grid is the task.
   */
  labelAt?: { x: number; y: number };
  color: string;
}

export interface CoordinatePlaneSVGProps {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  gridStep?: number;
  tickLabels?: CoordinatePlaneBaseProps['tickLabels'];
  squareCells?: boolean;
  maxWidth?: number;
  vectors: readonly PlaneVector[];
  ariaLabel: string;
}

/**
 * Plots vectors exactly at their coordinates on a grid — from the origin
 * for tasks that give the components, or tail-to-tip as the printed
 * original draws them for tasks that ask to read them off the grid.
 */
export function CoordinatePlaneSVG({
  xMin,
  xMax,
  yMin,
  yMax,
  gridStep = 1,
  tickLabels,
  squareCells,
  maxWidth,
  vectors,
  ariaLabel,
}: CoordinatePlaneSVGProps) {
  const idPrefix = `cp-vec-${useId().replace(/:/g, '')}`;
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
      {({ toSvgX, toSvgY }) => (
        <>
          <defs>
            {vectors.map((v, i) => (
              <marker
                key={i}
                id={`${idPrefix}-${i}`}
                markerWidth="8"
                markerHeight="8"
                refX="7"
                refY="4"
                orient="auto"
              >
                <path d="M0,0 L8,4 L0,8 Z" fill={v.color} />
              </marker>
            ))}
          </defs>
          {vectors.map((v, i) => (
            <g key={i}>
              <line
                x1={toSvgX(v.fromX ?? 0)}
                y1={toSvgY(v.fromY ?? 0)}
                x2={toSvgX(v.x)}
                y2={toSvgY(v.y)}
                stroke={v.color}
                strokeWidth={2.5}
                markerEnd={`url(#${idPrefix}-${i})`}
              />
              {v.labelAt ? (
                <VectorName
                  name={v.label}
                  x={toSvgX(v.labelAt.x)}
                  y={toSvgY(v.labelAt.y)}
                  color={v.color}
                />
              ) : (
                <text
                  x={toSvgX(v.x) + (v.x >= 0 ? 8 : -8)}
                  y={toSvgY(v.y) + (v.y >= 0 ? -8 : 16)}
                  fontSize={13}
                  fontStyle="italic"
                  fill={v.color}
                  textAnchor={v.x >= 0 ? 'start' : 'end'}
                >
                  {v.label}
                </text>
              )}
            </g>
          ))}
        </>
      )}
    </CoordinatePlaneBase>
  );
}

/** «a» with a small arrow over it, centred on (x, y). */
function VectorName({ name, x, y, color }: { name: string; x: number; y: number; color: string }) {
  return (
    <g>
      <text
        x={x}
        y={y + 5}
        fontSize={15}
        fontStyle="italic"
        fontWeight={600}
        fill={color}
        textAnchor="middle"
      >
        {name}
      </text>
      <path
        d={`M${x - 5},${y - 9} L${x + 5},${y - 9} M${x + 2},${y - 11.5} L${x + 5},${y - 9} L${x + 2},${y - 6.5}`}
        stroke={color}
        strokeWidth={1.3}
        fill="none"
      />
    </g>
  );
}
