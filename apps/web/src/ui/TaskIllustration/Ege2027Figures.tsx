import { CoordinatePlaneBase } from './CoordinatePlaneBase.js';
import { FunctionGraphSVG } from './FunctionGraphSVG.js';
import { splinePath } from './TracedGraphSVG.js';

/**
 * Figures of ЕГЭ 2027 Ященко, Вариант 2, drawn from the book's own scan
 * (the 8-page scan of book pages 11–18; see
 * docs/imports/ege-2027-yashchenko-v1-v2-report.md). Grids were found
 * on the scan by pixel projections; every point was read off that grid
 * and the figure re-derives the task's recorded answer in tests.
 */

const LINE = 'var(--color-text-primary)';
const MUTED = 'var(--color-text-secondary)';

/**
 * В2 №9 (скан стр. 6): y = f′(x) on (−7; 7), open circles at both
 * ends. The printed curve, traced every 0.25 on x at the scan's own
 * scale (31 px per cell on both axes) — zeros at −6, −2 and 2.
 */
export const EGE_2027_V2_T9_WAYPOINTS: readonly (readonly [number, number])[] = [
  [-7, 1.45],
  [-6.75, 1.09],
  [-6.5, 0.74],
  [-6.25, 0.36],
  [-6, -0.06],
  [-5.75, -0.5],
  [-5.5, -0.91],
  [-5.25, -1.3],
  [-5, -1.69],
  [-4.75, -2.02],
  [-4.5, -2.32],
  [-4.25, -2.56],
  [-4, -2.66],
  [-3.75, -2.56],
  [-3.5, -2.3],
  [-3.25, -1.92],
  [-3, -1.5],
  [-2.75, -1.19],
  [-2.5, -0.88],
  [-2.25, -0.5],
  [-2, 0.06],
  [-1.75, 1.04],
  [-1.5, 2.06],
  [-1.25, 2.76],
  [-1, 3.01],
  [-0.75, 2.98],
  [-0.5, 2.89],
  [-0.25, 2.74],
  [0, 2.57],
  [0.25, 2.32],
  [0.5, 2.01],
  [0.75, 1.68],
  [1, 1.4],
  [1.25, 1.15],
  [1.5, 0.89],
  [1.75, 0.46],
  [2, -0.12],
  [2.25, -0.85],
  [2.5, -1.76],
  [2.75, -2.6],
  [3, -3.05],
  [3.25, -3.23],
  [3.5, -3.24],
  [3.75, -3.08],
  [4, -2.74],
  [4.25, -2.29],
  [4.5, -1.88],
  [4.75, -1.59],
  [5, -1.53],
  [5.25, -1.73],
  [5.5, -2.08],
  [5.75, -2.38],
  [6, -2.46],
  [6.25, -2.34],
  [6.5, -2.1],
  [6.75, -1.78],
  [7, -1.52],
];

export function Ege2027V2Task9() {
  const first = EGE_2027_V2_T9_WAYPOINTS[0]!;
  const last = EGE_2027_V2_T9_WAYPOINTS[EGE_2027_V2_T9_WAYPOINTS.length - 1]!;
  return (
    <CoordinatePlaneBase
      xMin={-8}
      xMax={8}
      yMin={-4}
      yMax={4}
      tickLabels={{ x: [1], y: [1] }}
      squareCells
      maxWidth={520}
      ariaLabel="График производной y = f′(x) на интервале (−7; 7), концы выколоты (вариант 2, задание 9)"
    >
      {({ toSvgX, toSvgY }) => (
        <>
          {/* «−7» under the axis and «7» above it, joined to the open ends by dashes. */}
          {[first, last].map(([x, y]) => (
            <line
              key={x}
              x1={toSvgX(x)}
              y1={toSvgY(0)}
              x2={toSvgX(x)}
              y2={toSvgY(y)}
              stroke={MUTED}
              strokeWidth={1}
              strokeDasharray="4 3"
            />
          ))}
          <text x={toSvgX(-7)} y={toSvgY(0) + 15} fontSize={14} textAnchor="middle" fill={MUTED}>
            −7
          </text>
          <text x={toSvgX(7)} y={toSvgY(0) - 7} fontSize={14} textAnchor="middle" fill={MUTED}>
            7
          </text>
          <path
            d={splinePath(
              EGE_2027_V2_T9_WAYPOINTS.map(([x, y]) => [toSvgX(x), toSvgY(y)] as const),
            )}
            fill="none"
            stroke={LINE}
            strokeWidth={2.25}
          />
          {[first, last].map(([x, y]) => (
            <circle
              key={x}
              cx={toSvgX(x)}
              cy={toSvgY(y)}
              r={4}
              fill="var(--color-bg-surface)"
              stroke={LINE}
              strokeWidth={1.5}
            />
          ))}
          <text
            x={toSvgX(1.75)}
            y={toSvgY(3) + 5}
            fontSize={14}
            fontStyle="italic"
            fill={LINE}
            stroke="var(--color-bg-surface)"
            strokeWidth={4}
            paintOrder="stroke"
          >
            y = f′(x)
          </text>
        </>
      )}
    </CoordinatePlaneBase>
  );
}

/** В2 №12 (скан стр. 7): f(x)=k·logₐx through (1;0), (3;2), (9;4) ⇒ f(x)=2·log₃x. */
export const ege2027V2T12 = (x: number) => (x > 0 ? (2 * Math.log(x)) / Math.log(3) : Number.NaN);

export function Ege2027V2Task12() {
  return (
    <FunctionGraphSVG
      fn={ege2027V2T12}
      xMin={-1}
      xMax={9}
      yMin={-3}
      yMax={5}
      tickLabels={{ x: [3], y: [1] }}
      squareCells
      maxWidth={380}
      points={[
        { x: 1, y: 0 },
        { x: 3, y: 2 },
        { x: 9, y: 4 },
      ]}
      ariaLabel="График функции f(x) = k·logₐx с отмеченными точками (вариант 2, задание 12)"
    />
  );
}
