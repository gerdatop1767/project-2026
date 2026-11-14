import type { ReactElement } from 'react';
import { CoordinatePlaneBase } from '../../TaskIllustration/CoordinatePlaneBase.js';
import { FunctionGraphSVG } from '../../TaskIllustration/FunctionGraphSVG.js';
import styles from './TheoryFigure.module.css';

/**
 * Exact drawings for the profile-math theory, part 1. Every coordinate is
 * the one the text uses (the numbers were recomputed separately), so a
 * drawing never disagrees with its explanation. Graphs reuse the task
 * illustrations' coordinate plane, so theory and tasks look alike.
 */

const deg = (d: number) => (d * Math.PI) / 180;

/** Direction of the ray P→Q in degrees, counted the mathematical way (y up). */
function rayAngle(p: { x: number; y: number }, q: { x: number; y: number }) {
  const a = (Math.atan2(-(q.y - p.y), q.x - p.x) * 180) / Math.PI;
  return a < 0 ? a + 360 : a;
}

/** An arc of radius r around (x, y) from angle a1 to a2 (counter-clockwise, y up). */
function arcPath(x: number, y: number, r: number, a1: number, a2: number) {
  const [from, to] = a1 <= a2 ? [a1, a2] : [a2, a1];
  const p = (a: number) => `${x + r * Math.cos(deg(a))},${y - r * Math.sin(deg(a))}`;
  return `M${p(from)} A${r},${r} 0 ${to - from > 180 ? 1 : 0} 0 ${p(to)}`;
}

/** Inscribed angle α and central angle 2α on the same arc AB. */
function InscribedAngle() {
  const cx = 160;
  const cy = 112;
  const r = 86;
  const at = (a: number) => ({ x: cx + r * Math.cos(deg(a)), y: cy - r * Math.sin(deg(a)) });
  const A = at(210);
  const B = at(330);
  const C = at(100);
  return (
    <svg
      viewBox="0 0 320 224"
      className={styles.svg}
      role="img"
      aria-label="Вписанный угол ACB опирается на дугу AB и равен половине центрального угла AOB"
    >
      <circle cx={cx} cy={cy} r={r} className={styles.shape} />
      <path
        d={`M${C.x},${C.y} L${A.x},${A.y} M${C.x},${C.y} L${B.x},${B.y}`}
        className={styles.lineA}
      />
      <path
        d={`M${cx},${cy} L${A.x},${A.y} M${cx},${cy} L${B.x},${B.y}`}
        className={styles.lineB}
      />
      {/* α at C between the rays CA and CB; 2α at O between OA and OB */}
      <path d={arcPath(C.x, C.y, 22, rayAngle(C, A), rayAngle(C, B))} className={styles.lineA} />
      <path d={arcPath(cx, cy, 20, 210, 330)} className={styles.lineB} />
      {[
        { p: A, t: 'A', dx: -16, dy: 14 },
        { p: B, t: 'B', dx: 8, dy: 14 },
        { p: C, t: 'C', dx: -4, dy: -10 },
        { p: { x: cx, y: cy }, t: 'O', dx: 8, dy: -6 },
      ].map(({ p, t, dx, dy }) => (
        <g key={t}>
          <circle cx={p.x} cy={p.y} r={3} className={styles.dotA} />
          <text x={p.x + dx} y={p.y + dy} className={styles.pointLabel}>
            {t}
          </text>
        </g>
      ))}
      <text x={C.x + 12} y={C.y + 34} className={styles.meanLabel}>
        α
      </text>
      <text x={cx - 12} y={cy + 34} className={styles.legendBlue}>
        2α
      </text>
    </svg>
  );
}

/** a + b by the parallelogram rule: a = (3; 1), b = (1; 2), a + b = (4; 3). */
function VectorParallelogram() {
  return (
    <CoordinatePlaneBase
      xMin={-1}
      xMax={5}
      yMin={-1}
      yMax={4}
      squareCells
      maxWidth={340}
      ariaLabel="Сложение векторов по правилу параллелограмма: a(3; 1), b(1; 2), a + b = (4; 3)"
    >
      {({ toSvgX, toSvgY }) => {
        const arrow = (
          x: number,
          y: number,
          cls: string | undefined,
          marker: string,
          x0 = 0,
          y0 = 0,
        ) => (
          <line
            x1={toSvgX(x0)}
            y1={toSvgY(y0)}
            x2={toSvgX(x)}
            y2={toSvgY(y)}
            className={cls}
            markerEnd={`url(#${marker})`}
          />
        );
        return (
          <g>
            <defs>
              {(
                [
                  ['vecA', styles.arrowHeadA],
                  ['vecB', styles.arrowHeadB],
                  ['vecS', styles.arrowHeadS],
                ] as const
              ).map(([id, cls]) => (
                <marker
                  key={id}
                  id={id}
                  viewBox="0 0 10 10"
                  refX="9"
                  refY="5"
                  markerWidth="7"
                  markerHeight="7"
                  orient="auto-start-reverse"
                >
                  <path d="M0,0 L10,5 L0,10 z" className={cls} />
                </marker>
              ))}
            </defs>
            <line
              x1={toSvgX(3)}
              y1={toSvgY(1)}
              x2={toSvgX(4)}
              y2={toSvgY(3)}
              className={styles.dashed}
            />
            <line
              x1={toSvgX(1)}
              y1={toSvgY(2)}
              x2={toSvgX(4)}
              y2={toSvgY(3)}
              className={styles.dashed}
            />
            {arrow(3, 1, styles.vecA, 'vecA')}
            {arrow(1, 2, styles.vecB, 'vecB')}
            {arrow(4, 3, styles.vecS, 'vecS')}
            <text x={toSvgX(2.2)} y={toSvgY(0.4)} className={styles.legendViolet}>
              a
            </text>
            <text x={toSvgX(0.15)} y={toSvgY(1.35)} className={styles.legendBlue}>
              b
            </text>
            <text x={toSvgX(2.2)} y={toSvgY(2.15)} className={styles.legendGreen}>
              a + b
            </text>
          </g>
        );
      }}
    </CoordinatePlaneBase>
  );
}

/** A cone with r = 3, h = 4, generator l = 5 (drawn to scale). */
function Cone() {
  const s = 26; // px per unit
  const cx = 160;
  const baseY = 170;
  const apexY = baseY - 4 * s;
  const rx = 3 * s;
  const ry = 18;
  return (
    <svg
      viewBox="0 0 320 220"
      className={styles.svg}
      role="img"
      aria-label="Конус: радиус основания 3, высота 4, образующая 5"
    >
      <path
        d={`M${cx - rx},${baseY} A${rx},${ry} 0 0 0 ${cx + rx},${baseY}`}
        className={styles.shape}
      />
      <path
        d={`M${cx - rx},${baseY} A${rx},${ry} 0 0 1 ${cx + rx},${baseY}`}
        className={styles.dashed}
      />
      <path
        d={`M${cx - rx},${baseY} L${cx},${apexY} L${cx + rx},${baseY}`}
        className={styles.shape}
      />
      <line x1={cx} y1={apexY} x2={cx} y2={baseY} className={styles.dashedBlue} />
      <line x1={cx} y1={baseY} x2={cx + rx} y2={baseY} className={styles.lineA} />
      <path
        d={`M${cx},${baseY - 10} L${cx + 10},${baseY - 10} L${cx + 10},${baseY}`}
        className={styles.thin}
      />
      <text x={cx + rx / 2} y={baseY + 34} className={styles.meanLabel}>
        r = 3
      </text>
      <text x={cx + 6} y={baseY - 28} className={styles.legendBlue}>
        h = 4
      </text>
      <text x={cx + rx / 2 + 14} y={(apexY + baseY) / 2 - 6} className={styles.pointLabel}>
        l = 5
      </text>
    </svg>
  );
}

/** Total probability: two factories, then defective / good. */
function FactoryTree() {
  const node = (x: number, y: number, label: string, cls = styles.nodeBox) => (
    <g>
      <rect x={x - 38} y={y - 14} width={76} height={28} rx={8} className={cls} />
      <text x={x} y={y + 4} className={styles.nodeText}>
        {label}
      </text>
    </g>
  );
  const edge = (x1: number, y1: number, x2: number, y2: number, p: string, dx: number) => (
    <g>
      <line x1={x1} y1={y1} x2={x2} y2={y2} className={styles.thin} />
      <text x={(x1 + x2) / 2 + dx} y={(y1 + y2) / 2 - 2} className={styles.edgeLabel}>
        {p}
      </text>
    </g>
  );
  return (
    <svg
      viewBox="0 0 340 220"
      className={styles.svg}
      role="img"
      aria-label="Дерево вероятностей: завод 1 с вероятностью 0,6, брак 0,02; завод 2 с вероятностью 0,4, брак 0,03"
    >
      {edge(170, 34, 90, 96, '0,6', -18)}
      {edge(170, 34, 250, 96, '0,4', 18)}
      {edge(90, 110, 40, 176, '0,02', -20)}
      {edge(90, 110, 130, 176, '0,98', 20)}
      {edge(250, 110, 210, 176, '0,03', -20)}
      {edge(250, 110, 300, 176, '0,97', 20)}
      {node(170, 22, 'изделие')}
      {node(90, 110, 'завод 1')}
      {node(250, 110, 'завод 2')}
      {node(40, 190, 'брак', styles.nodeBad)}
      {node(130, 190, 'годное')}
      {node(210, 190, 'брак', styles.nodeBad)}
      {node(300, 190, 'годное')}
    </svg>
  );
}

/** f(x) = x²/4 and its tangent at x₀ = 2: y = x − 1, slope f′(2) = 1. */
function Tangent() {
  return (
    <FunctionGraphSVG
      fn={(x) => (x * x) / 4}
      extraCurves={[(x) => x - 1]}
      xMin={-2}
      xMax={5}
      yMin={-2}
      yMax={5}
      squareCells
      maxWidth={340}
      points={[{ x: 2, y: 1, label: 'x₀ = 2', labelOffset: { dx: 8, dy: 14 } }]}
      ariaLabel="График y = x²/4 и касательная y = x − 1 в точке x₀ = 2: угловой коэффициент равен f′(2) = 1"
    />
  );
}

/** The graph of f′(x) = (x + 2)(x − 1)(x − 3)/4: its zeros and signs. */
function DerivativeSigns() {
  return (
    <>
      <FunctionGraphSVG
        fn={(x) => ((x + 2) * (x - 1) * (x - 3)) / 4}
        xMin={-3}
        xMax={4}
        yMin={-6}
        yMax={5}
        maxWidth={360}
        points={[
          { x: -2, y: 0 },
          { x: 1, y: 0 },
          { x: 3, y: 0 },
        ]}
        ariaLabel="График производной f′(x) = (x + 2)(x − 1)(x − 3)/4 с нулями −2, 1 и 3"
      />
      <div className={styles.signRow} aria-hidden="true">
        <span className={styles.minus}>f′ − ↘</span>
        <span className={styles.point}>−2 min</span>
        <span className={styles.plus}>f′ + ↗</span>
        <span className={styles.point}>1 max</span>
        <span className={styles.minus}>f′ − ↘</span>
        <span className={styles.point}>3 min</span>
        <span className={styles.plus}>f′ + ↗</span>
      </div>
    </>
  );
}

/** y = (x − 1)² − 4: vertex (1; −4), roots −1 and 3. */
function ParabolaVertex() {
  return (
    <FunctionGraphSVG
      fn={(x) => (x - 1) ** 2 - 4}
      xMin={-3}
      xMax={5}
      yMin={-5}
      yMax={6}
      squareCells
      maxWidth={320}
      points={[
        { x: 1, y: -4, label: '(1; −4)', labelOffset: { dx: 8, dy: 4 } },
        { x: 3, y: 0, label: '(3; 0)', labelOffset: { dx: 8, dy: -6 } },
        { x: -1, y: 0 },
      ]}
      ariaLabel="Парабола y = (x − 1)² − 4 с вершиной (1; −4), проходящая через точки (−1; 0) и (3; 0)"
    />
  );
}

/** f(x) = x³ − 3x² + 2: maximum at x = 0, minimum at x = 2. */
function CubicExtrema() {
  return (
    <FunctionGraphSVG
      fn={(x) => x ** 3 - 3 * x ** 2 + 2}
      xMin={-1}
      xMax={3.2}
      yMin={-3}
      yMax={5}
      maxWidth={340}
      dashedVerticals={[0, 2]}
      points={[
        { x: 0, y: 2, label: 'max (0; 2)', labelOffset: { dx: 8, dy: -8 } },
        { x: 2, y: -2, label: 'min (2; −2)', labelOffset: { dx: 8, dy: 14 } },
      ]}
      ariaLabel="График f(x) = x³ − 3x² + 2: максимум в точке 0, минимум в точке 2"
    />
  );
}

export const mathFigures: Record<string, () => ReactElement> = {
  'plan-inscribed-angle': () => <InscribedAngle />,
  'vec-parallelogram': () => <VectorParallelogram />,
  'stereo-cone': () => <Cone />,
  'prob-factory-tree': () => <FactoryTree />,
  'deriv-tangent': () => <Tangent />,
  'deriv-signs': () => <DerivativeSigns />,
  'graph-parabola-vertex': () => <ParabolaVertex />,
  'extremum-cubic': () => <CubicExtrema />,
};
