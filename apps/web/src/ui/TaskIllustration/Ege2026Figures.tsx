import { CoordinatePlaneBase } from './CoordinatePlaneBase.js';
import { CoordinatePlaneSVG, type PlaneVector } from './CoordinatePlaneSVG.js';
import { FunctionGraphSVG } from './FunctionGraphSVG.js';
import { splinePath, TracedGraphSVG } from './TracedGraphSVG.js';

/**
 * Figures of ЕГЭ 2026 Ященко, варианты 3–10, drawn from the original
 * book («ЕГЭ 2026 Ященко, первые 20 вариантов», pages listed in
 * docs/imports/ege-2026-v2-v10-figures-audit.md). Every coordinate was
 * read off the printed grid — pixel-measured — and checked against the
 * task's recorded answer; the label positions follow the original.
 */

const A = 'var(--color-accent-secondary)';
const B = 'var(--color-gold)';

/** The printed vector grids: 12×12 squares, x and y from −6 to 6, «0» and «1» marked. */
function VectorGrid({
  vectors,
  ariaLabel,
}: {
  vectors: readonly PlaneVector[];
  ariaLabel: string;
}) {
  return (
    <CoordinatePlaneSVG
      xMin={-6}
      xMax={6}
      yMin={-6}
      yMax={6}
      tickLabels="unitOnly"
      squareCells
      maxWidth={360}
      vectors={vectors}
      ariaLabel={ariaLabel}
    />
  );
}

/** Data of each vector figure — exported for the tests. */
export const EGE_2026_VECTORS = {
  3: [
    { fromX: -6, fromY: 4, x: -2, y: -2, label: 'a', labelAt: { x: -3.3, y: 2.4 }, color: A },
    { fromX: 1, fromY: -3, x: 6, y: 3, label: 'b', labelAt: { x: 3.4, y: 1.4 }, color: B },
  ],
  4: [
    { fromX: -4, fromY: 1, x: 2, y: 5, label: 'a', labelAt: { x: -2.6, y: 2.45 }, color: A },
    { fromX: -1, fromY: 4, x: 5, y: -3, label: 'b', labelAt: { x: 2.45, y: 1.45 }, color: B },
  ],
  6: [
    { fromX: -5, fromY: -4, x: -2, y: 2, label: 'a', labelAt: { x: -4.6, y: -1.3 }, color: A },
    { fromX: -6, fromY: 4, x: 5, y: 2, label: 'b', labelAt: { x: 1.55, y: 3.4 }, color: B },
  ],
  9: [
    { fromX: 3, fromY: 1, x: 2, y: -2, label: 'a', labelAt: { x: 3.35, y: -0.6 }, color: A },
    { fromX: -1, fromY: -1, x: -5, y: 5, label: 'b', labelAt: { x: -2.45, y: 2.4 }, color: B },
  ],
  10: [
    { fromX: -1, fromY: 6, x: 3, y: -5, label: 'a', labelAt: { x: 2.5, y: -2.45 }, color: A },
    { fromX: 1, fromY: -2, x: 4, y: 5, label: 'b', labelAt: { x: 3.5, y: 2.45 }, color: B },
  ],
} as const satisfies Record<number, readonly PlaneVector[]>;

const vectorsLabel = (v: keyof typeof EGE_2026_VECTORS) =>
  `Векторы a и b на клетчатой координатной плоскости (вариант ${v}, задание 2); координаты концов — целые числа, их нужно считать по клеткам`;

export function Ege2026V3Task2() {
  return <VectorGrid vectors={EGE_2026_VECTORS[3]} ariaLabel={vectorsLabel(3)} />;
}
export function Ege2026V4Task2() {
  return <VectorGrid vectors={EGE_2026_VECTORS[4]} ariaLabel={vectorsLabel(4)} />;
}
export function Ege2026V6Task2() {
  return <VectorGrid vectors={EGE_2026_VECTORS[6]} ariaLabel={vectorsLabel(6)} />;
}
export function Ege2026V9Task2() {
  return <VectorGrid vectors={EGE_2026_VECTORS[9]} ariaLabel={vectorsLabel(9)} />;
}
export function Ege2026V10Task2() {
  return <VectorGrid vectors={EGE_2026_VECTORS[10]} ariaLabel={vectorsLabel(10)} />;
}

/**
 * В7 №8 (стр. 27): the printed curve, digitised every 0.1 on x at the
 * original's own scale (186.5 px per unit on both axes; no grid in the
 * original). The four marked points sit where the original puts them:
 * −1 and 3 on peaks, 1 on the steep fall, 4 on a rise.
 */
export const EGE_2026_V7_T8_WAYPOINTS: readonly (readonly [number, number])[] = [
  [-3.0, 1.41],
  [-2.9, 1.23],
  [-2.8, 1.03],
  [-2.7, 0.79],
  [-2.6, 0.54],
  [-2.5, 0.34],
  [-2.4, 0.26],
  [-2.3, 0.32],
  [-2.2, 0.43],
  [-2.1, 0.56],
  [-2.0, 0.73],
  [-1.9, 0.9],
  [-1.8, 1.1],
  [-1.7, 1.29],
  [-1.6, 1.53],
  [-1.5, 1.77],
  [-1.4, 1.98],
  [-1.3, 2.17],
  [-1.2, 2.32],
  [-1.1, 2.42],
  [-1.0, 2.48],
  [-0.9, 2.5],
  [-0.8, 2.44],
  [-0.7, 2.23],
  [-0.6, 1.86],
  [-0.5, 1.31],
  [-0.4, 0.52],
  [-0.3, -0.18],
  [-0.2, -0.41],
  [-0.1, -0.56],
  [0.1, -0.72],
  [0.2, -0.77],
  [0.3, -0.83],
  [0.4, -0.91],
  [0.5, -1.06],
  [0.6, -1.24],
  [0.7, -1.47],
  [0.8, -1.71],
  [0.9, -1.94],
  [1.0, -2.15],
  [1.1, -2.35],
  [1.2, -2.45],
  [1.3, -2.42],
  [1.4, -2.23],
  [1.5, -1.92],
  [1.6, -1.61],
  [1.7, -1.5],
  [1.8, -1.56],
  [1.9, -1.71],
  [2.0, -1.92],
  [2.1, -2.12],
  [2.2, -2.2],
  [2.3, -2.06],
  [2.4, -1.64],
  [2.5, -0.74],
  [2.6, 0.21],
  [2.7, 0.86],
  [2.8, 1.25],
  [2.9, 1.41],
  [3.0, 1.42],
  [3.1, 1.38],
  [3.2, 1.22],
  [3.3, 0.89],
  [3.4, 0.2],
  [3.5, -0.68],
  [3.6, -1.35],
  [3.7, -1.66],
  [3.8, -1.72],
  [3.9, -1.59],
  [4.0, -1.4],
  [4.1, -1.18],
  [4.2, -0.96],
  [4.3, -0.76],
  [4.4, -0.59],
  [4.5, -0.53],
  [4.6, -0.64],
  [4.7, -0.82],
  [4.8, -1.04],
  [4.9, -1.21],
  [5.0, -1.35],
];

export function Ege2026V7Task8() {
  return (
    <TracedGraphSVG
      waypoints={EGE_2026_V7_T8_WAYPOINTS}
      marks={[
        { x: -1, label: '−1' },
        { x: 1, label: '1' },
        { x: 3, label: '3' },
        { x: 4, label: '4' },
      ]}
      xMin={-3.3}
      xMax={5.6}
      yMin={-3.2}
      yMax={3.2}
      ariaLabel="График функции y = f(x) с отмеченными на оси абсцисс точками −1, 1, 3, 4"
    />
  );
}

/** В7 №11 (стр. 27): g(x)=−x²−4x through (−4;0), (−2;4), (0;0); f(x)=2,5x through (2;5). */
export const ege2026V7T11 = {
  g: (x: number) => -x * x - 4 * x,
  f: (x: number) => 2.5 * x,
};

export function Ege2026V7Task11() {
  return (
    <FunctionGraphSVG
      fn={ege2026V7T11.g}
      extraCurves={[ege2026V7T11.f]}
      xMin={-5}
      xMax={3}
      yMin={-4}
      yMax={5}
      tickLabels={{ x: [1], y: [3] }}
      squareCells
      maxWidth={340}
      points={[
        { x: -4, y: 0 },
        { x: -2, y: 4 },
        { x: 0, y: 0 },
        { x: 2, y: 5 },
      ]}
      ariaLabel="Графики функций f(x) = kx + b и g(x) = ax² + bx + c, пересекающиеся в начале координат и в точке A (вариант 7, задание 11)"
    />
  );
}

/** В9 №11 (стр. 36): f(x)=a^(x+b) through (0;4) and (2;1) ⇒ f(x)=2^(2−x). */
export const ege2026V9T11 = (x: number) => 2 ** (2 - x);

export function Ege2026V9Task11() {
  return (
    <FunctionGraphSVG
      fn={ege2026V9T11}
      xMin={-2}
      xMax={5}
      yMin={-2}
      yMax={5}
      tickLabels="unitOnly"
      squareCells
      maxWidth={320}
      points={[
        { x: 0, y: 4 },
        { x: 2, y: 1 },
      ]}
      ariaLabel="График функции f(x) = a^(x+b) с двумя отмеченными точками (вариант 9, задание 11)"
    />
  );
}

/** В10 №11 (стр. 40): f(x)=log_a(x+b) through (−2;0) and (1;4) ⇒ f(x)=2·log₂(x+3). */
export const ege2026V10T11 = (x: number) => (x > -3 ? 2 * Math.log2(x + 3) : Number.NaN);

export function Ege2026V10Task11() {
  return (
    <FunctionGraphSVG
      fn={ege2026V10T11}
      xMin={-3}
      xMax={4}
      yMin={-3}
      yMax={5}
      tickLabels="unitOnly"
      squareCells
      maxWidth={320}
      points={[
        { x: -2, y: 0 },
        { x: 1, y: 4 },
      ]}
      ariaLabel="График функции f(x) = logₐ(x + b) с двумя отмеченными точками (вариант 10, задание 11)"
    />
  );
}

// ── Варианты 3, 4 и 8 №8 (2026). The same figures print in ЕГЭ 2027 as
// В13, В14 and В18 №9, word for word, so both tasks share one SVG
// (docs/imports/math-graphs-audit-2026-2027.md). Traced on the 2026 pages,
// whose scan resolution is about five times the 2027 one.

/** 2026 В3 №8 = 2027 В13 №9: traced on the 2026 page at 133 px per cell. */
export const EGE_2026_V3_T8_WAYPOINTS: readonly (readonly [number, number])[] = [
  [-2.2, 6.16],
  [-2, 5.67],
  [-1.8, 5.11],
  [-1.6, 4.56],
  [-1.4, 4.02],
  [-1.2, 3.53],
  [-1, 3.04],
  [-0.8, 2.57],
  [-0.6, 2.12],
  [-0.4, 1.73],
  [-0.2, 1.4],
  [0, 1.02],
  [0.2, 0.7],
  [0.4, 0.42],
  [0.6, 0.11],
  [0.8, -0.07],
  [1, -0.3],
  [1.2, -0.46],
  [1.4, -0.57],
  [1.6, -0.59],
  [1.8, -0.53],
  [2, -0.41],
  [2.2, -0.23],
  [2.4, -0.01],
  [2.6, 0.26],
  [2.8, 0.64],
  [3, 1.1],
  [3.2, 1.8],
  [3.4, 2.77],
  [3.6, 3.91],
  [3.8, 4.67],
  [4, 4.98],
  [4.2, 5.1],
  [4.4, 5.18],
  [4.6, 5.21],
  [4.8, 5.22],
  [5, 5.21],
  [5.2, 5.19],
  [5.4, 5.16],
  [5.6, 5.12],
  [5.8, 5.04],
  [6, 5.01],
  [6.1, 4.99],
];
/** 2026 В4 №8 = 2027 В14 №9: traced on the 2026 page at 124×128 px per cell. */
export const EGE_2026_V4_T8_WAYPOINTS: readonly (readonly [number, number])[] = [
  [-1.9, -0.63],
  [-1.8, -0.44],
  [-1.6, -0.03],
  [-1.4, 0.34],
  [-1.2, 0.69],
  [-1, 1.02],
  [-0.8, 1.32],
  [-0.6, 1.58],
  [-0.4, 1.82],
  [-0.2, 2.04],
  [0, 2.23],
  [0.2, 2.4],
  [0.4, 2.52],
  [0.6, 2.62],
  [0.8, 2.68],
  [1, 2.7],
  [1.2, 2.69],
  [1.4, 2.64],
  [1.6, 2.56],
  [1.8, 2.45],
  [2, 2.31],
  [2.2, 2.12],
  [2.4, 1.94],
  [2.6, 1.71],
  [2.8, 1.45],
  [3, 1.17],
  [3.2, 0.87],
  [3.4, 0.55],
  [3.6, 0.19],
  [3.8, -0.12],
  [4, -0.48],
  [4.2, -0.87],
  [4.4, -1.21],
  [4.6, -1.54],
  [4.8, -1.81],
  [5, -2],
  [5.2, -1.98],
  [5.4, -1.97],
  [5.6, -1.94],
  [5.8, -1.89],
  [6, -1.83],
  [6.2, -1.75],
  [6.4, -1.68],
  [6.6, -1.58],
  [6.8, -1.48],
  [7, -1.36],
  [7.2, -1.17],
];
/** 2026 В8 №8 = 2027 В18 №9 (2026 стр. 31): no grid; x read through the printed marks. */
export const EGE_2026_V8_T8_WAYPOINTS: readonly (readonly [number, number])[] = [
  [-3, 0.88],
  [-2.9, 1.03],
  [-2.8, 1.07],
  [-2.7, 0.85],
  [-2.6, 0.32],
  [-2.5, -0.54],
  [-2.4, -1.15],
  [-2.3, -1.45],
  [-2.2, -1.51],
  [-2.1, -1.43],
  [-2, -1.27],
  [-1.9, -1.02],
  [-1.8, -0.66],
  [-1.7, -0.13],
  [-1.6, 0.69],
  [-1.5, 1.47],
  [-1.4, 2.04],
  [-1.3, 2.34],
  [-1.2, 2.41],
  [-1.1, 2.33],
  [-1, 2.15],
  [-0.9, 1.91],
  [-0.8, 1.6],
  [-0.7, 1.27],
  [-0.6, 0.93],
  [-0.5, 0.62],
  [-0.4, 0.42],
  [-0.3, 0.38],
  [-0.2, 0.46],
  [-0.1, 0.59],
  [0, 0.75],
  [0.1, 0.94],
  [0.2, 1.18],
  [0.3, 1.44],
  [0.4, 1.76],
  [0.5, 2.13],
  [0.6, 2.45],
  [0.7, 2.65],
  [0.8, 2.76],
  [0.9, 2.78],
  [1, 2.76],
  [1.1, 2.67],
  [1.2, 2.44],
  [1.3, 1.85],
  [1.4, 0.95],
  [1.5, -0.51],
  [1.6, -1.73],
  [1.7, -2.36],
  [1.8, -2.64],
  [1.9, -2.66],
  [2, -2.57],
  [2.1, -2.35],
  [2.2, -2.01],
  [2.3, -1.56],
  [2.4, -0.99],
  [2.5, -0.37],
  [2.6, 0.23],
  [2.7, 0.67],
  [2.8, 0.94],
  [2.9, 1.12],
  [3, 1.23],
  [3.1, 1.29],
  [3.2, 1.31],
  [3.3, 1.28],
  [3.4, 1.18],
  [3.5, 0.86],
  [3.6, 0.45],
  [3.7, 0.05],
  [3.8, -0.3],
  [3.9, -0.59],
  [4, -0.81],
  [4.1, -0.93],
  [4.2, -0.9],
  [4.3, -0.69],
  [4.4, -0.16],
  [4.5, 0.72],
  [4.6, 1.31],
  [4.7, 1.66],
  [4.8, 1.82],
  [4.9, 1.85],
];

const LINE = 'var(--color-text-primary)';
const MUTED = 'var(--color-text-secondary)';

/**
 * A printed curve y = f(x) on a square grid with one marked point and
 * dashed lines from it to both axes — «касательная проходит через начало
 * координат»: the tangent itself is not drawn, the student reads the point
 * off the grid. Labels: «0» and «1» on both axes, the caption where the
 * book prints it.
 */
function PointOnCurve({
  waypoints,
  point,
  xMin,
  xMax,
  yMin,
  yMax,
  caption,
  maxWidth,
  ariaLabel,
}: {
  waypoints: readonly (readonly [number, number])[];
  point: readonly [number, number];
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  caption: { x: number; y: number };
  maxWidth: number;
  ariaLabel: string;
}) {
  const [px, py] = point;
  return (
    <CoordinatePlaneBase
      xMin={xMin}
      xMax={xMax}
      yMin={yMin}
      yMax={yMax}
      tickLabels={{ x: [1], y: [1] }}
      squareCells
      maxWidth={maxWidth}
      originLabel="left"
      ariaLabel={ariaLabel}
    >
      {({ toSvgX, toSvgY, clipPathUrl }) => (
        <>
          <line
            x1={toSvgX(px)}
            y1={toSvgY(0)}
            x2={toSvgX(px)}
            y2={toSvgY(py)}
            stroke={MUTED}
            strokeWidth={1.5}
            strokeDasharray="6 4"
          />
          <line
            x1={toSvgX(0)}
            y1={toSvgY(py)}
            x2={toSvgX(px)}
            y2={toSvgY(py)}
            stroke={MUTED}
            strokeWidth={1.5}
            strokeDasharray="6 4"
          />
          <path
            d={splinePath(waypoints.map(([x, y]) => [toSvgX(x), toSvgY(y)] as const))}
            fill="none"
            stroke={LINE}
            strokeWidth={2.25}
            clipPath={clipPathUrl}
          />
          <circle cx={toSvgX(px)} cy={toSvgY(py)} r={4.5} fill={LINE} />
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
            y = f(x)
          </text>
        </>
      )}
    </CoordinatePlaneBase>
  );
}

/** 2026 В3 №8 = 2027 В13 №9: the point (4; 5) — f′(4) = 5/4 = 1,25. */
export const EGE_2026_V3_T8_POINT = [4, 5] as const;
/** 2026 В4 №8 = 2027 В14 №9: the point (5; −2) — f′(5) = −2/5 = −0,4. */
export const EGE_2026_V4_T8_POINT = [5, -2] as const;

export function Ege2026V3Task8() {
  return (
    <PointOnCurve
      waypoints={EGE_2026_V3_T8_WAYPOINTS}
      point={EGE_2026_V3_T8_POINT}
      xMin={-2.5}
      xMax={6.8}
      yMin={-1}
      yMax={6.5}
      caption={{ x: 4.65, y: 4.35 }}
      maxWidth={400}
      ariaLabel="График функции y = f(x) с отмеченной точкой графика, абсцисса точки 4"
    />
  );
}

export function Ege2026V4Task8() {
  return (
    <PointOnCurve
      waypoints={EGE_2026_V4_T8_WAYPOINTS}
      point={EGE_2026_V4_T8_POINT}
      xMin={-2.3}
      xMax={7.5}
      yMin={-2.6}
      yMax={3.6}
      caption={{ x: 2.65, y: 2.55 }}
      maxWidth={420}
      ariaLabel="График функции y = f(x) с отмеченной точкой графика, абсцисса точки 5"
    />
  );
}

export function Ege2026V8Task8() {
  return (
    <TracedGraphSVG
      waypoints={EGE_2026_V8_T8_WAYPOINTS}
      marks={[
        { x: -1, label: '−1' },
        { x: 1, label: '1' },
        { x: 2, label: '2' },
        { x: 3, label: '3' },
      ]}
      xMin={-3.3}
      xMax={5.4}
      yMin={-3.3}
      yMax={3.4}
      ariaLabel="График функции y = f(x) с отмеченными на оси абсцисс точками −1, 1, 2, 3"
    />
  );
}
