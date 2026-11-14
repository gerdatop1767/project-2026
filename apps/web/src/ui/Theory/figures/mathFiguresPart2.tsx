import type { ReactElement } from 'react';
import { CoordinatePlaneBase } from '../../TaskIllustration/CoordinatePlaneBase.js';
import { FunctionGraphSVG } from '../../TaskIllustration/FunctionGraphSVG.js';
import styles from './TheoryFigure.module.css';

/**
 * Exact drawings for the profile-math theory, part 2 (№13–19). As in
 * part 1, every coordinate comes from the numbers of the worked example
 * next to the drawing, so a picture cannot disagree with its solution.
 * Solids use one oblique projection: depth goes up and to the right.
 */

const deg = (d: number) => (d * Math.PI) / 180;

type P3 = readonly [number, number, number];

/**
 * Oblique (cabinet) projection: x to the right, z up, depth y drawn at
 * about half scale up and to the right (`side` = 1) or to the left (−1).
 */
function projector(scale: number, ox: number, oy: number, side: 1 | -1 = 1) {
  return ([x, y, z]: P3) => ({
    x: ox + scale * (x + side * 0.42 * y),
    y: oy - scale * (z + 0.32 * y),
  });
}

const pts = (list: readonly { x: number; y: number }[]) =>
  list.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

function Label({
  at,
  text,
  dx = 0,
  dy = 0,
  className = styles.pointLabel,
}: {
  at: { x: number; y: number };
  text: string;
  dx?: number;
  dy?: number;
  className?: string | undefined;
}) {
  return (
    <text x={at.x + dx} y={at.y + dy} className={className}>
      {text}
    </text>
  );
}

/**
 * №13 б: roots of sin x = 1/2 and sin x = 1 on [2π; 7π/2] — the arc from
 * angle 0 to 270° counter-clockwise, three marked roots.
 */
function TrigSelection() {
  const cx = 150;
  const cy = 118;
  const r = 84;
  const at = (a: number, rr = r) => ({
    x: cx + rr * Math.cos(deg(a)),
    y: cy - rr * Math.sin(deg(a)),
  });
  const arcStart = at(0);
  const arcEnd = at(270);
  const roots = [
    { a: 30, t: '13π/6', dx: 8, dy: -4 },
    { a: 90, t: '5π/2', dx: 8, dy: -8 },
    { a: 150, t: '17π/6', dx: -46, dy: -4 },
  ];
  return (
    <svg
      viewBox="0 0 300 236"
      className={styles.svg}
      role="img"
      aria-label="Единичная окружность: дуга от 2π до 7π/2 и корни 13π/6, 5π/2, 17π/6 на ней"
    >
      <line x1={cx - r - 22} y1={cy} x2={cx + r + 22} y2={cy} className={styles.thin} />
      <line x1={cx} y1={cy + r + 18} x2={cx} y2={cy - r - 18} className={styles.thin} />
      <circle cx={cx} cy={cy} r={r} className={styles.shape} />
      {/* the interval [2π; 7π/2]: 3/4 of a turn counter-clockwise from 0 */}
      <path
        d={`M${arcStart.x},${arcStart.y} A${r},${r} 0 1 0 ${arcEnd.x},${arcEnd.y}`}
        className={styles.arcHot}
      />
      {/* sin x = 1/2 */}
      <line
        x1={cx - r - 14}
        y1={cy - r / 2}
        x2={cx + r + 14}
        y2={cy - r / 2}
        className={styles.dashedBlue}
      />
      <text x={cx + r + 4} y={cy - r / 2 + 18} className={styles.legendBlue}>
        y = 1/2
      </text>
      <circle cx={arcStart.x} cy={arcStart.y} r={4} className={styles.dotB} />
      <Label at={arcStart} text="2π" dx={6} dy={16} className={styles.legendBlue} />
      <circle cx={arcEnd.x} cy={arcEnd.y} r={4} className={styles.dotB} />
      <Label at={arcEnd} text="7π/2" dx={10} dy={22} className={styles.legendBlue} />
      {roots.map(({ a, t, dx, dy }) => {
        const p = at(a);
        return (
          <g key={t}>
            <circle cx={p.x} cy={p.y} r={4.5} className={styles.dotA} />
            <Label at={p} text={t} dx={dx} dy={dy} />
          </g>
        );
      })}
    </svg>
  );
}

/** №15: (x − 1)²(x + 2)/(x − 3) ≥ 0 on the number line — signs + − − +. */
function IntervalsChart() {
  const W = 320;
  const axisY = 70;
  const xs = { a: 70, b: 165, c: 255 };
  const sign = (x: number, s: string, plus: boolean) => (
    <text x={x} y={axisY - 22} className={plus ? styles.signPlus : styles.signMinus}>
      {s}
    </text>
  );
  return (
    <svg
      viewBox={`0 0 ${W} 120`}
      className={styles.svg}
      role="img"
      aria-label="Метод интервалов: точки −2 и 1 закрашены, 3 выколота; знаки +, −, −, +; ответ (−∞; −2], {1}, (3; +∞)"
    >
      {/* solution: (−∞; −2], {1}, (3; +∞) */}
      <line x1={12} y1={axisY + 14} x2={xs.a} y2={axisY + 14} className={styles.solution} />
      <line x1={xs.c} y1={axisY + 14} x2={W - 16} y2={axisY + 14} className={styles.solution} />
      <circle cx={xs.b} cy={axisY + 14} r={4} className={styles.dotGreen} />
      <line x1={8} y1={axisY} x2={W - 8} y2={axisY} className={styles.thin} />
      <path d={`M${W - 8},${axisY} l-8,-4 v8 z`} className={styles.arrowFill} />
      {/* sign arcs over the intervals */}
      {(
        [
          [12, xs.a],
          [xs.a, xs.b],
          [xs.b, xs.c],
          [xs.c, W - 16],
        ] as const
      ).map(([l, rr]) => (
        <path
          key={l}
          d={`M${l},${axisY} Q${(l + rr) / 2},${axisY - 26} ${rr},${axisY}`}
          className={styles.dashed}
        />
      ))}
      {sign((12 + xs.a) / 2, '+', true)}
      {sign((xs.a + xs.b) / 2, '−', false)}
      {sign((xs.b + xs.c) / 2, '−', false)}
      {sign((xs.c + W - 16) / 2, '+', true)}
      <circle cx={xs.a} cy={axisY} r={5} className={styles.dotA} />
      <circle cx={xs.b} cy={axisY} r={5} className={styles.dotA} />
      <circle cx={xs.c} cy={axisY} r={5} className={styles.dotHollow} />
      <text x={xs.a} y={axisY + 36} className={styles.tickCenter}>
        −2
      </text>
      <text x={xs.b} y={axisY + 36} className={styles.tickCenter}>
        1 (кратность 2)
      </text>
      <text x={xs.c} y={axisY + 36} className={styles.tickCenter}>
        3
      </text>
      <text x={W - 10} y={axisY + 20} className={styles.tickCenter}>
        x
      </text>
    </svg>
  );
}

/**
 * №14: regular pyramid SABCD, AB = 6, height SO = 4. H is the midpoint of
 * AB, OH = 3, SH = 5; ∠SHO is the angle between the face SAB and the base.
 */
function PyramidAngle() {
  const P = projector(28, 30, 204);
  const A = P([0, 0, 0]);
  const B = P([6, 0, 0]);
  const C = P([6, 6, 0]);
  const D = P([0, 6, 0]);
  const O = P([3, 3, 0]);
  const S = P([3, 3, 4]);
  const H = P([3, 0, 0]);
  return (
    <svg
      viewBox="0 0 300 226"
      className={styles.svg}
      role="img"
      aria-label="Правильная четырёхугольная пирамида SABCD: высота SO = 4, OH = 3, апофема SH = 5, угол SHO между боковой гранью и основанием"
    >
      <polygon points={pts([S, A, B])} className={styles.plane} />
      {/* hidden: everything at D */}
      <polyline points={pts([A, D, C])} className={styles.dashed} />
      <line x1={S.x} y1={S.y} x2={D.x} y2={D.y} className={styles.dashed} />
      <polyline points={pts([A, B, C])} className={styles.shape} />
      <polyline points={pts([A, S, B])} className={styles.shape} />
      <line x1={S.x} y1={S.y} x2={C.x} y2={C.y} className={styles.shape} />
      <line x1={S.x} y1={S.y} x2={O.x} y2={O.y} className={styles.dashedBlue} />
      <line x1={O.x} y1={O.y} x2={H.x} y2={H.y} className={styles.dashedBlue} />
      <line x1={S.x} y1={S.y} x2={H.x} y2={H.y} className={styles.lineA} />
      {[
        { p: A, t: 'A', dx: -14, dy: 6 },
        { p: B, t: 'B', dx: 6, dy: 8 },
        { p: C, t: 'C', dx: 6, dy: 4 },
        { p: D, t: 'D', dx: -16, dy: -2 },
        { p: S, t: 'S', dx: -4, dy: -8 },
        { p: O, t: 'O', dx: 6, dy: -4 },
        { p: H, t: 'H', dx: -4, dy: 18 },
      ].map(({ p, t, dx, dy }) => (
        <g key={t}>
          <circle cx={p.x} cy={p.y} r={3} className={styles.dotA} />
          <Label at={p} text={t} dx={dx} dy={dy} />
        </g>
      ))}
      <text x={(S.x + O.x) / 2 + 6} y={(S.y + O.y) / 2} className={styles.legendBlue}>
        4
      </text>
      <text x={(O.x + H.x) / 2 + 8} y={(O.y + H.y) / 2 + 4} className={styles.legendBlue}>
        3
      </text>
      <text x={(S.x + H.x) / 2 + 6} y={(S.y + H.y) / 2 + 16} className={styles.legendViolet}>
        5
      </text>
    </svg>
  );
}

/**
 * №14: unit cube, plane A₁BD and the diagonal AC₁ ⟂ to it. The foot H is
 * the centre of the triangle A₁BD: AH = AC₁/3 = √3/3. Depth goes up and
 * to the left here, so the triangle A₁BD opens up instead of collapsing
 * into a sliver; the hidden vertex is C.
 */
function CubePlane() {
  const P = projector(120, 82, 222, -1);
  const v = {
    A: P([0, 0, 0]),
    B: P([1, 0, 0]),
    C: P([1, 1, 0]),
    D: P([0, 1, 0]),
    A1: P([0, 0, 1]),
    B1: P([1, 0, 1]),
    C1: P([1, 1, 1]),
    D1: P([0, 1, 1]),
  };
  const H = P([1 / 3, 1 / 3, 1 / 3]);
  return (
    <svg
      viewBox="0 0 250 240"
      className={styles.svg}
      role="img"
      aria-label="Единичный куб, плоскость A₁BD и диагональ AC₁, перпендикулярная этой плоскости; H — центр треугольника A₁BD"
    >
      <polygon points={pts([v.A1, v.B, v.D])} className={styles.plane} />
      {/* hidden edges at C */}
      <polyline points={pts([v.B, v.C, v.D])} className={styles.dashed} />
      <line x1={v.C.x} y1={v.C.y} x2={v.C1.x} y2={v.C1.y} className={styles.dashed} />
      <polygon points={pts([v.A, v.B, v.B1, v.A1])} className={styles.shape} />
      <polyline points={pts([v.A, v.D, v.D1, v.A1])} className={styles.shape} />
      <polyline points={pts([v.B1, v.C1, v.D1])} className={styles.shape} />
      <polyline points={pts([v.A1, v.B, v.D, v.A1])} className={styles.lineA} />
      <line x1={v.A.x} y1={v.A.y} x2={v.C1.x} y2={v.C1.y} className={styles.dashedBlue} />
      {(
        [
          ['A', v.A, -6, 20],
          ['B', v.B, 6, 16],
          ['C', v.C, 6, -6],
          ['D', v.D, -18, 4],
          ['A₁', v.A1, -26, 16],
          ['B₁', v.B1, 6, 4],
          ['C₁', v.C1, 6, -6],
          ['D₁', v.D1, -10, -8],
        ] as const
      ).map(([t, p, dx, dy]) => (
        <g key={t}>
          <circle cx={p.x} cy={p.y} r={3} className={styles.dotA} />
          <Label at={p} text={t} dx={dx} dy={dy} />
        </g>
      ))}
      <circle cx={H.x} cy={H.y} r={4} className={styles.dotB} />
      <Label at={H} text="H" dx={8} dy={4} className={styles.legendBlue} />
    </svg>
  );
}

/**
 * №17: acute triangle ABC with altitudes AA₁ and BB₁. A, B, A₁, B₁ lie on
 * the circle with diameter AB, so ∠CA₁B₁ = ∠CAB and A₁B₁ = AB·cos C.
 */
function AltitudesCyclic() {
  const s = 24;
  const ox = 34;
  const oy = 196;
  const T = (x: number, y: number) => ({ x: ox + s * x, y: oy - s * y });
  // A(0; 0), B(10; 0), C(6; 7) in triangle units.
  const a = { x: 0, y: 0 };
  const b = { x: 10, y: 0 };
  const c = { x: 6, y: 7 };
  const foot = (p: typeof a, u: typeof a, w: typeof a) => {
    const dx = w.x - u.x;
    const dy = w.y - u.y;
    const t = ((p.x - u.x) * dx + (p.y - u.y) * dy) / (dx * dx + dy * dy);
    return { x: u.x + t * dx, y: u.y + t * dy };
  };
  const a1 = foot(a, b, c);
  const b1 = foot(b, a, c);
  const [A, B, C, A1, B1] = [a, b, c, a1, b1].map((p) => T(p.x, p.y)) as [
    { x: number; y: number },
    { x: number; y: number },
    { x: number; y: number },
    { x: number; y: number },
    { x: number; y: number },
  ];
  return (
    <svg
      viewBox="0 0 300 236"
      className={styles.svg}
      role="img"
      aria-label="Остроугольный треугольник ABC с высотами AA₁ и BB₁; точки A, B, A₁, B₁ лежат на окружности с диаметром AB"
    >
      {/* the upper half of the circle on the diameter AB: A₁ and B₁ lie on it */}
      <path
        d={`M${A.x},${A.y} A${5 * s},${5 * s} 0 0 1 ${B.x},${B.y}`}
        className={styles.dashedBlue}
      />
      <polygon points={pts([A, B, C])} className={styles.shape} />
      <line x1={A.x} y1={A.y} x2={A1.x} y2={A1.y} className={styles.thin} />
      <line x1={B.x} y1={B.y} x2={B1.x} y2={B1.y} className={styles.thin} />
      <line x1={A1.x} y1={A1.y} x2={B1.x} y2={B1.y} className={styles.lineA} />
      {(
        [
          ['A', A, -14, 6],
          ['B', B, 6, 6],
          ['C', C, -4, -8],
          ['A₁', A1, 6, 0],
          ['B₁', B1, -24, 0],
        ] as const
      ).map(([t, p, dx, dy]) => (
        <g key={t}>
          <circle cx={p.x} cy={p.y} r={3} className={styles.dotA} />
          <Label at={p} text={t} dx={dx} dy={dy} />
        </g>
      ))}
    </svg>
  );
}

/**
 * №17: circles R = 9 and r = 4 touching externally; the common tangent
 * T₁T₂ = 2√(Rr) = 12 from the right triangle O₁KO₂ with legs 12 and 5.
 */
function TouchingCircles() {
  const s = 8;
  const base = 186;
  const x1 = 92;
  const O1 = { x: x1, y: base - 9 * s };
  const O2 = { x: x1 + 12 * s, y: base - 4 * s };
  const T1 = { x: x1, y: base };
  const T2 = { x: x1 + 12 * s, y: base };
  const K = { x: x1, y: base - 4 * s };
  return (
    <svg
      viewBox="0 0 300 206"
      className={styles.svg}
      role="img"
      aria-label="Две окружности радиусов 9 и 4 касаются внешним образом; общая касательная T₁T₂ = 12; O₁O₂ = 13, O₁K = 5"
    >
      <circle cx={O1.x} cy={O1.y} r={9 * s} className={styles.shape} />
      <circle cx={O2.x} cy={O2.y} r={4 * s} className={styles.shape} />
      <line x1={8} y1={base} x2={292} y2={base} className={styles.thin} />
      <line x1={O1.x} y1={O1.y} x2={T1.x} y2={T1.y} className={styles.lineB} />
      <line x1={O2.x} y1={O2.y} x2={T2.x} y2={T2.y} className={styles.lineB} />
      <line x1={O1.x} y1={O1.y} x2={O2.x} y2={O2.y} className={styles.lineA} />
      <line x1={K.x} y1={K.y} x2={O2.x} y2={O2.y} className={styles.dashed} />
      <line x1={T1.x} y1={T1.y} x2={T2.x} y2={T2.y} className={styles.solution} />
      {(
        [
          ['O₁', O1, -22, 0],
          ['O₂', O2, 6, -6],
          ['T₁', T1, -8, 16],
          ['T₂', T2, -6, 16],
          ['K', K, -16, 4],
        ] as const
      ).map(([t, p, dx, dy]) => (
        <g key={t}>
          <circle cx={p.x} cy={p.y} r={3} className={styles.dotA} />
          <Label at={p} text={t} dx={dx} dy={dy} />
        </g>
      ))}
      <text x={(O1.x + O2.x) / 2 - 4} y={(O1.y + O2.y) / 2 - 12} className={styles.legendViolet}>
        13
      </text>
      <text x={O1.x + 6} y={(O1.y + K.y) / 2 + 4} className={styles.legendBlue}>
        5
      </text>
      <text x={(T1.x + T2.x) / 2} y={base + 16} className={styles.legendGreen}>
        12
      </text>
    </svg>
  );
}

/** №18: y = |x² − 4x| and the lines y = a — the number of roots by levels. */
function AbsParabola() {
  return (
    <FunctionGraphSVG
      fn={(x) => Math.abs(x * x - 4 * x)}
      xMin={-1}
      xMax={5}
      yMin={-1}
      yMax={6}
      squareCells
      maxWidth={320}
      dashedHorizontals={[2, 4]}
      points={[
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { x: 2, y: 4, label: '(2; 4)', labelOffset: { dx: -20, dy: -10 } },
      ]}
      ariaLabel="График y = |x² − 4x| с вершиной (2; 4); прямая y = 2 пересекает его в четырёх точках, прямая y = 4 — в трёх"
    />
  );
}

/** №18: a = x² − 2x on [0; 3] and the levels a = −1, 0, 3. */
function SegmentLevels() {
  const f = (x: number) => x * x - 2 * x;
  return (
    <CoordinatePlaneBase
      xMin={-1}
      xMax={4}
      yMin={-2}
      yMax={4}
      squareCells
      maxWidth={300}
      ariaLabel="График a = x² − 2x на отрезке [0; 3]: от точки (0; 0) вниз до вершины (1; −1) и вверх до (3; 3)"
    >
      {({ toSvgX, toSvgY }) => {
        const path = Array.from({ length: 61 }, (_, i) => {
          const x = (3 * i) / 60;
          return `${i === 0 ? 'M' : 'L'}${toSvgX(x).toFixed(1)},${toSvgY(f(x)).toFixed(1)}`;
        }).join(' ');
        const level = (a: number) => (
          <line
            key={a}
            x1={toSvgX(-1)}
            x2={toSvgX(4)}
            y1={toSvgY(a)}
            y2={toSvgY(a)}
            className={styles.dashedBlue}
          />
        );
        return (
          <g>
            {[-1, 0, 3].map(level)}
            <path d={path} className={styles.lineA} />
            {(
              [
                [0, 0],
                [1, -1],
                [2, 0],
                [3, 3],
              ] as const
            ).map(([x, y]) => (
              <circle key={x} cx={toSvgX(x)} cy={toSvgY(y)} r={4} className={styles.dotA} />
            ))}
            <text x={toSvgX(3) + 8} y={toSvgY(3) + 4} className={styles.pointLabel}>
              (3; 3)
            </text>
            <text x={toSvgX(1) + 6} y={toSvgY(-1) + 16} className={styles.pointLabel}>
              (1; −1)
            </text>
          </g>
        );
      }}
    </CoordinatePlaneBase>
  );
}

/** №18: the circle x² + y² = 4 and the lines y = x + a; tangency at |a| = 2√2. */
function CircleLines() {
  const t = 2 * Math.SQRT2;
  return (
    <CoordinatePlaneBase
      xMin={-4}
      xMax={4}
      yMin={-4}
      yMax={4}
      squareCells
      maxWidth={320}
      ariaLabel="Окружность x² + y² = 4 и прямые y = x + a: при a = ±2√2 прямая касается окружности, при a = 1 пересекает её в двух точках"
    >
      {({ toSvgX, toSvgY, clipPathUrl }) => {
        const unit = toSvgX(1) - toSvgX(0);
        const line = (a: number, cls: string | undefined) => (
          <line
            x1={toSvgX(-5)}
            y1={toSvgY(-5 + a)}
            x2={toSvgX(5)}
            y2={toSvgY(5 + a)}
            className={cls}
            clipPath={clipPathUrl}
          />
        );
        return (
          <g>
            <circle cx={toSvgX(0)} cy={toSvgY(0)} r={2 * unit} className={styles.lineA} />
            {line(t, styles.lineB)}
            {line(-t, styles.lineB)}
            {line(1, styles.dashed)}
            <circle
              cx={toSvgX(-Math.SQRT2)}
              cy={toSvgY(Math.SQRT2)}
              r={4}
              className={styles.dotB}
            />
            <circle
              cx={toSvgX(Math.SQRT2)}
              cy={toSvgY(-Math.SQRT2)}
              r={4}
              className={styles.dotB}
            />
            <text x={toSvgX(-3.9)} y={toSvgY(0.4)} className={styles.legendBlue}>
              a = 2√2
            </text>
            <text x={toSvgX(1.2)} y={toSvgY(-3.4)} className={styles.legendBlue}>
              a = −2√2
            </text>
            <text x={toSvgX(2.75)} y={toSvgY(3.1)} className={styles.pointLabel}>
              a = 1
            </text>
          </g>
        );
      }}
    </CoordinatePlaneBase>
  );
}

export const mathFiguresPart2: Record<string, () => ReactElement> = {
  'trig-selection': () => <TrigSelection />,
  'ineq-intervals': () => <IntervalsChart />,
  'stereo-pyramid-angle': () => <PyramidAngle />,
  'stereo-cube-plane': () => <CubePlane />,
  'plan-altitudes-cyclic': () => <AltitudesCyclic />,
  'plan-touching-circles': () => <TouchingCircles />,
  'param-abs-parabola': () => <AbsParabola />,
  'param-segment-levels': () => <SegmentLevels />,
  'param-circle-lines': () => <CircleLines />,
};
