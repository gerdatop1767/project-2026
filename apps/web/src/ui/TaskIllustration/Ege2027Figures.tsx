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
  /** В7 №2 (скан 2–15, стр. 21): grid x −6…6, y −5…6. */
  7: [
    { fromX: 5, fromY: 5, x: -1, y: 2, label: 'a', labelAt: { x: 2.55, y: 4.5 }, color: A },
    { fromX: -6, fromY: -4, x: -1, y: 4, label: 'b', labelAt: { x: -3.75, y: 1.5 }, color: B },
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

/**
 * В6 №9 (скан 2–15, стр. 18): y = f′(x) on (−9; 10), open ends at about
 * (−9; −2,25) and (10; 2,1); traced every 0.25 (31 px per cell). The
 * printed curve crosses the axis off the grid nodes: ≈−5,7; −1,2; 2,7;
 * 3,4; 8,2.
 */
export const EGE_2027_V6_T9_WAYPOINTS: readonly (readonly [number, number])[] = [
  [-9, -2.25],
  [-8.8, -2.64],
  [-8.55, -3.08],
  [-8.3, -3.44],
  [-8.05, -3.64],
  [-7.8, -3.63],
  [-7.55, -3.53],
  [-7.3, -3.39],
  [-7.05, -3.19],
  [-6.8, -2.94],
  [-6.55, -2.59],
  [-6.3, -2.13],
  [-6.05, -1.46],
  [-5.8, -0.5],
  [-5.55, 0.56],
  [-5.3, 1.54],
  [-5.05, 2.13],
  [-4.8, 2.09],
  [-4.55, 1.81],
  [-4.3, 1.47],
  [-4.05, 1.24],
  [-3.8, 1.27],
  [-3.55, 1.52],
  [-3.3, 1.86],
  [-3.05, 2.18],
  [-2.8, 2.52],
  [-2.55, 2.76],
  [-2.3, 2.93],
  [-2.05, 2.95],
  [-1.8, 2.71],
  [-1.55, 2],
  [-1.3, 0.77],
  [-1.05, -0.68],
  [-0.8, -2],
  [-0.55, -2.9],
  [-0.3, -3.42],
  [-0.05, -3.62],
  [0.2, -3.54],
  [0.45, -3.09],
  [0.7, -2.54],
  [0.95, -2.32],
  [1.2, -2.39],
  [1.45, -2.78],
  [1.7, -3.33],
  [1.95, -3.62],
  [2.2, -3.22],
  [2.45, -1.77],
  [2.7, 0.01],
  [2.95, 0.96],
  [3.2, 0.72],
  [3.45, -0.35],
  [3.7, -1.92],
  [3.95, -3.18],
  [4.2, -3.63],
  [4.45, -3.85],
  [4.7, -3.96],
  [4.95, -3.99],
  [5.2, -3.94],
  [5.45, -3.77],
  [5.7, -3.55],
  [5.95, -3.3],
  [6.2, -3.04],
  [6.45, -2.83],
  [6.7, -2.64],
  [6.95, -2.49],
  [7.2, -2.42],
  [7.45, -2.33],
  [7.7, -2.01],
  [7.95, -1.28],
  [8.2, -0.1],
  [8.45, 1.22],
  [8.7, 2.27],
  [8.95, 2.79],
  [9.2, 2.78],
  [9.45, 2.62],
  [9.7, 2.39],
  [10, 2.1],
];

export function Ege2027V6Task9() {
  return (
    <OpenEndedCurve
      waypoints={EGE_2027_V6_T9_WAYPOINTS}
      xMin={-10}
      xMax={11}
      yMin={-5}
      yMax={4}
      tickLabels={{ x: [1], y: [1] }}
      caption={{ x: -6.7, y: 3 }}
      maxWidth={600}
      ariaLabel="График производной y = f′(x) на интервале (−9; 10), концы выколоты (вариант 6, задание 9)"
    />
  );
}

/** В6 №12 (скан 2–15, стр. 19): f(x)=√(ax) through (0;0), (7;3) ⇒ a=9/7; g(x)=√(x−b) through (−3;0), (−2;1), (1;2), (6;3) ⇒ b=−3. */
export const ege2027V6T12 = {
  f: (x: number) => (x >= 0 ? Math.sqrt((9 * x) / 7) : Number.NaN),
  g: (x: number) => (x >= -3 ? Math.sqrt(x + 3) : Number.NaN),
};

export function Ege2027V6Task12() {
  return (
    <FunctionGraphSVG
      fn={ege2027V6T12.f}
      extraCurves={[ege2027V6T12.g]}
      xMin={-3}
      xMax={7}
      yMin={-2}
      yMax={5}
      tickLabels="unitOnly"
      squareCells
      maxWidth={380}
      points={[
        { x: -3, y: 0 },
        { x: -2, y: 1 },
        { x: 1, y: 2 },
        { x: 6, y: 3 },
        { x: 0, y: 0 },
        { x: 7, y: 3 },
      ]}
      ariaLabel="Графики функций f(x) = √(ax) и g(x) = √(x − b), пересекающиеся в точке A (вариант 6, задание 12)"
    />
  );
}

export function Ege2027V7Task2() {
  return (
    <CoordinatePlaneSVG
      xMin={-6}
      xMax={6}
      yMin={-5}
      yMax={6}
      tickLabels="unitOnly"
      squareCells
      maxWidth={360}
      vectors={EGE_2027_VECTORS[7]}
      ariaLabel="Векторы a и b на клетчатой координатной плоскости (вариант 7, задание 2); координаты концов — целые числа, их нужно считать по клеткам"
    />
  );
}

/**
 * В7 №9 (скан 2–15, стр. 22): the printed curve y = f(x), traced every
 * 0.2 (30.6 px per cell), and its tangent at x₀ ≈ −3.2 through the
 * marked nodes (−6; −1) and (−1; −3), slope −0.4. Near x₀ the trace is
 * replaced by line + c·(x − x₀)² so the curve touches the line there.
 */
export const EGE_2027_V7_T9_WAYPOINTS: readonly (readonly [number, number])[] = [
  [-4.9, 2.18],
  [-4.7, 1.45],
  [-4.5, 0.68],
  [-4.3, -0.04],
  [-4.1, -0.62],
  [-3.9, -1.1],
  [-3.7, -1.5],
  [-3.5, -1.93],
  [-3.3, -2.07],
  [-3.2, -2.12],
  [-3.1, -2.15],
  [-2.9, -2.17],
  [-2.7, -2.17],
  [-2.5, -2.19],
  [-2.3, -2.17],
  [-2.1, -2.13],
  [-1.9, -2.08],
  [-1.7, -1.98],
  [-1.5, -1.86],
  [-1.3, -1.75],
  [-1.1, -1.61],
  [-0.9, -1.46],
  [-0.7, -1.29],
  [-0.5, -1.09],
  [-0.3, -0.83],
  [-0.1, -0.62],
  [0.1, -0.47],
  [0.3, -0.29],
  [0.5, -0.08],
  [0.7, 0.12],
  [0.9, 0.32],
  [1.1, 0.49],
  [1.3, 0.63],
  [1.5, 0.72],
  [1.7, 0.76],
  [1.9, 0.74],
  [2.1, 0.68],
  [2.3, 0.59],
  [2.5, 0.47],
  [2.7, 0.32],
  [2.9, 0.15],
  [3.1, -0.05],
  [3.3, -0.28],
  [3.5, -0.5],
];
export const EGE_2027_V7_T9_TANGENT = {
  x0: -3.2,
  through: [
    [-6, -1],
    [-1, -3],
  ],
} as const;

export function Ege2027V7Task9() {
  const [[x1, y1], [x2, y2]] = EGE_2027_V7_T9_TANGENT.through;
  const k = (y2 - y1) / (x2 - x1);
  const line = (x: number) => y1 + k * (x - x1);
  const { x0 } = EGE_2027_V7_T9_TANGENT;
  return (
    <CoordinatePlaneBase
      xMin={-7}
      xMax={4}
      yMin={-4}
      yMax={3}
      tickLabels={{ x: [1], y: [1] }}
      squareCells
      maxWidth={420}
      ariaLabel="График функции y = f(x) и касательная к нему в точке с абсциссой x₀ (вариант 7, задание 9)"
    >
      {({ toSvgX, toSvgY, clipPathUrl }) => (
        <>
          <line
            x1={toSvgX(x0)}
            y1={toSvgY(0)}
            x2={toSvgX(x0)}
            y2={toSvgY(line(x0))}
            stroke={MUTED}
            strokeWidth={1.2}
            strokeDasharray="4 3"
          />
          <text
            x={toSvgX(x0)}
            y={toSvgY(0) - 7}
            fontSize={14}
            fontStyle="italic"
            textAnchor="middle"
            fill={MUTED}
          >
            x₀
          </text>
          <line
            x1={toSvgX(-7)}
            y1={toSvgY(line(-7))}
            x2={toSvgX(2)}
            y2={toSvgY(line(2))}
            stroke={LINE}
            strokeWidth={2}
            clipPath={clipPathUrl}
          />
          <path
            d={splinePath(
              EGE_2027_V7_T9_WAYPOINTS.map(([x, y]) => [toSvgX(x), toSvgY(y)] as const),
            )}
            fill="none"
            stroke={LINE}
            strokeWidth={2.25}
            clipPath={clipPathUrl}
          />
          {[...EGE_2027_V7_T9_TANGENT.through, [x0, line(x0)] as const].map(([x, y]) => (
            <circle
              key={x}
              cx={toSvgX(x)}
              cy={toSvgY(y)}
              r={4}
              fill="var(--color-accent-secondary)"
            />
          ))}
          <text
            x={toSvgX(-2.4)}
            y={toSvgY(2.2) + 5}
            fontSize={14}
            fontStyle="italic"
            fill={LINE}
            stroke="var(--color-bg-surface)"
            strokeWidth={4}
            paintOrder="stroke"
          >
            y = f(x)
          </text>
        </>
      )}
    </CoordinatePlaneBase>
  );
}

/** В7 №12 (скан 2–15, стр. 23): f(x)=ax²−0,8x+c through (0;−2), (2;−2) ⇒ a=0,4, c=−2. */
export const ege2027V7T12 = (x: number) => 0.4 * x * x - 0.8 * x - 2;

export function Ege2027V7Task12() {
  return (
    <FunctionGraphSVG
      fn={ege2027V7T12}
      xMin={-3}
      xMax={6}
      yMin={-4}
      yMax={6}
      tickLabels="unitOnly"
      squareCells
      maxWidth={340}
      points={[
        { x: 0, y: -2 },
        { x: 2, y: -2 },
      ]}
      ariaLabel="График функции f(x) = ax² − 0,8x + c с отмеченными точками (вариант 7, задание 12)"
    />
  );
}
