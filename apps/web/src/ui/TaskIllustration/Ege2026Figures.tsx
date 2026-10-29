import { CoordinatePlaneSVG, type PlaneVector } from './CoordinatePlaneSVG.js';
import { FunctionGraphSVG } from './FunctionGraphSVG.js';
import { TracedGraphSVG } from './TracedGraphSVG.js';

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
      ariaLabel="График функции y = f(x) с отмеченными на оси абсцисс точками −1, 1, 3, 4 (вариант 7, задание 8)"
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
