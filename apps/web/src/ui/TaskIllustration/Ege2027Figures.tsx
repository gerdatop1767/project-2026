import { CoordinatePlaneBase } from './CoordinatePlaneBase.js';
import { CoordinatePlaneSVG, type PlaneVector } from './CoordinatePlaneSVG.js';
import { FunctionGraphSVG } from './FunctionGraphSVG.js';
import { splinePath } from './TracedGraphSVG.js';

/**
 * Figures of ЕГЭ 2027 Ященко, drawn from the book's own scans (Вариант 2:
 * docs/imports/ege-2027-yashchenko-v1-v2-report.md; Варианты 3–10:
 * docs/imports/ege-2027-yashchenko-v3-v10-report.md). Grids were found
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

/**
 * A printed curve on a grid with both ends open (a derivative graph
 * «на интервале (a; b)»): spline through the traced waypoints, open
 * circles at the ends joined to the axis by dashes, each end's abscissa
 * written on the far side of the axis, and the «y = f′(x)» caption where
 * the book prints it.
 */
function OpenEndedCurve({
  waypoints,
  xMin,
  xMax,
  yMin,
  yMax,
  tickLabels,
  caption,
  maxWidth,
  ariaLabel,
}: {
  waypoints: readonly (readonly [number, number])[];
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  tickLabels: { x: readonly number[]; y: readonly number[] };
  /** Left end of the caption text, in plane units. */
  caption: { x: number; y: number };
  maxWidth: number;
  ariaLabel: string;
}) {
  const ends = [waypoints[0]!, waypoints[waypoints.length - 1]!];
  return (
    <CoordinatePlaneBase
      xMin={xMin}
      xMax={xMax}
      yMin={yMin}
      yMax={yMax}
      tickLabels={tickLabels}
      squareCells
      maxWidth={maxWidth}
      ariaLabel={ariaLabel}
    >
      {({ toSvgX, toSvgY }) => (
        <>
          {ends.map(([x, y]) => (
            <g key={x}>
              <line
                x1={toSvgX(x)}
                y1={toSvgY(0)}
                x2={toSvgX(x)}
                y2={toSvgY(y)}
                stroke={MUTED}
                strokeWidth={1}
                strokeDasharray="4 3"
              />
              <text
                x={toSvgX(x)}
                y={y > 0 ? toSvgY(0) + 15 : toSvgY(0) - 7}
                fontSize={14}
                textAnchor="middle"
                fill={MUTED}
              >
                {x < 0 ? `−${-x}` : x}
              </text>
            </g>
          ))}
          <path
            d={splinePath(waypoints.map(([x, y]) => [toSvgX(x), toSvgY(y)] as const))}
            fill="none"
            stroke={LINE}
            strokeWidth={2.25}
          />
          {ends.map(([x, y]) => (
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
            x={toSvgX(caption.x)}
            y={toSvgY(caption.y) + 5}
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

export function Ege2027V2Task9() {
  return (
    <OpenEndedCurve
      waypoints={EGE_2027_V2_T9_WAYPOINTS}
      xMin={-8}
      xMax={8}
      yMin={-4}
      yMax={4}
      tickLabels={{ x: [1], y: [1] }}
      caption={{ x: 1.75, y: 3 }}
      maxWidth={520}
      ariaLabel="График производной y = f′(x) на интервале (−7; 7), концы выколоты (вариант 2, задание 9)"
    />
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

const A = 'var(--color-accent-secondary)';
const B = 'var(--color-gold)';

/** Vector data of the 2027 №2 figures — exported for the tests. */
export const EGE_2027_VECTORS = {
  /** В3 №2 (скан 2–15, стр. 5): grid x −6…6, y −5…6. */
  3: [
    { fromX: -6, fromY: 5, x: 1, y: 1, label: 'a', labelAt: { x: -2.45, y: 3.75 }, color: A },
    { fromX: 5, fromY: -1, x: 4, y: -5, label: 'b', labelAt: { x: 3.55, y: -3.6 }, color: B },
  ],
  /** В4 №2 (скан 2–15, стр. 9): grid x −6…6, y −5…6. */
  4: [
    { fromX: 5, fromY: 6, x: -6, y: -1, label: 'a', labelAt: { x: -1.5, y: 2.8 }, color: A },
    { fromX: 1, fromY: 5, x: 5, y: -5, label: 'b', labelAt: { x: 3.6, y: -3.65 }, color: B },
  ],
} as const satisfies Record<number, readonly PlaneVector[]>;

export function Ege2027V3Task2() {
  return (
    <CoordinatePlaneSVG
      xMin={-6}
      xMax={6}
      yMin={-5}
      yMax={6}
      tickLabels="unitOnly"
      squareCells
      maxWidth={360}
      vectors={EGE_2027_VECTORS[3]}
      ariaLabel="Векторы a и b на клетчатой координатной плоскости (вариант 3, задание 2); координаты концов — целые числа, их нужно считать по клеткам"
    />
  );
}

/** В3 №12 (скан 2–15, стр. 7): f(x)=k/x through (−2;2) and A(1;−4) ⇒ k=−4; g through (−4;−2) and A. */
export const ege2027V3T12 = {
  f: (x: number) => (x === 0 ? Number.NaN : -4 / x),
  g: (x: number) => -0.4 * x - 3.6,
};

export function Ege2027V3Task12() {
  return (
    <FunctionGraphSVG
      fn={ege2027V3T12.f}
      extraCurves={[ege2027V3T12.g]}
      xMin={-5}
      xMax={5}
      yMin={-5}
      yMax={5}
      tickLabels="unitOnly"
      squareCells
      maxWidth={360}
      points={[
        { x: -2, y: 2 },
        { x: -4, y: -2 },
        { x: 1, y: -4, label: 'A', labelOffset: { dx: 7, dy: -7 } },
      ]}
      ariaLabel="Графики функций f(x) = k/x и g(x) = ax + b, пересекающиеся в точке A(1; −4) и в точке B (вариант 3, задание 12)"
    />
  );
}

export function Ege2027V4Task2() {
  return (
    <CoordinatePlaneSVG
      xMin={-6}
      xMax={6}
      yMin={-5}
      yMax={6}
      tickLabels="unitOnly"
      squareCells
      maxWidth={360}
      vectors={EGE_2027_VECTORS[4]}
      ariaLabel="Векторы a и b на клетчатой координатной плоскости (вариант 4, задание 2); координаты концов — целые числа, их нужно считать по клеткам"
    />
  );
}

/** В4 №12 (скан 2–15, стр. 11): f(x)=k/x through A(1;2) and (−2;−1) ⇒ k=2; g through (−4;3) and A. */
export const ege2027V4T12 = {
  f: (x: number) => (x === 0 ? Number.NaN : 2 / x),
  g: (x: number) => -0.2 * x + 2.2,
};

export function Ege2027V4Task12() {
  return (
    <FunctionGraphSVG
      fn={ege2027V4T12.f}
      extraCurves={[ege2027V4T12.g]}
      xMin={-5}
      xMax={5}
      yMin={-5}
      yMax={5}
      tickLabels="unitOnly"
      squareCells
      maxWidth={360}
      points={[
        { x: -4, y: 3 },
        { x: 1, y: 2, label: 'A', labelOffset: { dx: 7, dy: -9 } },
        { x: -2, y: -1 },
      ]}
      ariaLabel="Графики функций f(x) = k/x и g(x) = ax + b, пересекающиеся в точке A(1; 2) и в точке B (вариант 4, задание 12)"
    />
  );
}

/**
 * В5 №9 (скан 2–15, стр. 14): y = f′(x) on (−17; 7), open ends at (−17; 1)
 * and (7; −2); traced every 0.25 at the scan's scale (31.3 px per cell).
 * Zeros −14, −12, −6, −2, 1, 4, 6.
 */
export const EGE_2027_V5_T9_WAYPOINTS: readonly (readonly [number, number])[] = [
  [-17, 1],
  [-16.8, 1.02],
  [-16.55, 1.06],
  [-16.3, 1.21],
  [-16.05, 1.44],
  [-15.8, 1.81],
  [-15.55, 2.23],
  [-15.3, 2.67],
  [-15.05, 2.97],
  [-14.8, 2.96],
  [-14.55, 2.45],
  [-14.3, 1.42],
  [-14.05, 0.24],
  [-13.8, -0.67],
  [-13.55, -1.39],
  [-13.3, -1.98],
  [-13.05, -2.39],
  [-12.8, -2.3],
  [-12.55, -1.79],
  [-12.3, -1.01],
  [-12.05, -0.18],
  [-11.8, 0.33],
  [-11.55, 0.59],
  [-11.3, 0.81],
  [-11.05, 1.03],
  [-10.8, 1.38],
  [-10.55, 1.94],
  [-10.3, 2.56],
  [-10.05, 2.94],
  [-9.8, 2.93],
  [-9.55, 2.7],
  [-9.3, 2.3],
  [-9.05, 1.86],
  [-8.8, 1.49],
  [-8.55, 1.22],
  [-8.3, 1.05],
  [-8.05, 1.01],
  [-7.8, 1.11],
  [-7.55, 1.73],
  [-7.3, 2.53],
  [-7.05, 2.94],
  [-6.8, 2.91],
  [-6.55, 2.35],
  [-6.3, 1.44],
  [-6.05, 0.4],
  [-5.8, -0.65],
  [-5.55, -1.58],
  [-5.3, -2.33],
  [-5.05, -2.79],
  [-4.8, -2.65],
  [-4.55, -2.15],
  [-4.3, -1.56],
  [-4.05, -1.2],
  [-3.8, -1.25],
  [-3.55, -1.45],
  [-3.3, -1.65],
  [-3.05, -1.77],
  [-2.8, -1.71],
  [-2.55, -1.39],
  [-2.3, -0.86],
  [-2.05, -0.09],
  [-1.8, 0.77],
  [-1.55, 1.65],
  [-1.3, 2.43],
  [-1.05, 2.92],
  [-0.8, 2.95],
  [-0.55, 2.62],
  [-0.3, 2.2],
  [-0.05, 1.82],
  [0.2, 1.44],
  [0.45, 1.11],
  [0.7, 0.74],
  [0.95, 0.05],
  [1.2, -0.94],
  [1.45, -1.87],
  [1.7, -2.59],
  [1.95, -2.98],
  [2.2, -2.87],
  [2.45, -2.57],
  [2.7, -2.21],
  [2.95, -1.83],
  [3.2, -1.41],
  [3.45, -0.98],
  [3.7, -0.53],
  [3.95, -0.06],
  [4.2, 0.47],
  [4.45, 1.14],
  [4.7, 1.78],
  [4.95, 2.08],
  [5.2, 1.95],
  [5.45, 1.45],
  [5.7, 0.79],
  [5.95, 0.11],
  [6.2, -0.48],
  [6.45, -0.98],
  [6.7, -1.44],
  [7, -2],
];

export function Ege2027V5Task9() {
  return (
    <OpenEndedCurve
      waypoints={EGE_2027_V5_T9_WAYPOINTS}
      xMin={-18}
      xMax={8}
      yMin={-4}
      yMax={4}
      tickLabels={{ x: [2], y: [1] }}
      caption={{ x: 1.6, y: 3 }}
      maxWidth={640}
      ariaLabel="График производной y = f′(x) на интервале (−17; 7), концы выколоты (вариант 5, задание 9)"
    />
  );
}

/** В5 №12 (скан 2–15, стр. 15): f(x)=√(ax) through (0;0), (3;2) ⇒ a=4/3; g(x)=√(x−b) through (−5;0), (−4;1), (−1;2) ⇒ b=−5. */
export const ege2027V5T12 = {
  f: (x: number) => (x >= 0 ? Math.sqrt((4 * x) / 3) : Number.NaN),
  g: (x: number) => (x >= -5 ? Math.sqrt(x + 5) : Number.NaN),
};

export function Ege2027V5Task12() {
  return (
    <FunctionGraphSVG
      fn={ege2027V5T12.f}
      extraCurves={[ege2027V5T12.g]}
      xMin={-5}
      xMax={5}
      yMin={-1}
      yMax={4}
      tickLabels="unitOnly"
      squareCells
      maxWidth={380}
      points={[
        { x: -5, y: 0 },
        { x: -4, y: 1 },
        { x: -1, y: 2 },
        { x: 0, y: 0 },
        { x: 3, y: 2 },
      ]}
      ariaLabel="Графики функций f(x) = √(ax) и g(x) = √(x − b), пересекающиеся в точке A (вариант 5, задание 12)"
    />
  );
}
