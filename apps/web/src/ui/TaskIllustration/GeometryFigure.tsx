/**
 * A geometry drawing (planimetry, stereometry, a river crossing …)
 * described as data, in the pixel coordinates of the original book's
 * page fragment it was measured on (see geometryFigures.ts). The renderer
 * only scales it: every vertex, dashed edge, ellipse arc and label sits
 * where the book prints it, so proportions are the original's.
 *
 * Lines use the page colours, so the drawing follows the light and dark
 * themes; labels are italic like the book's.
 */

type Pt = readonly [number, number];

/** One element of a drawing. Coordinates are in the source fragment's pixels. */
export type GeoItem =
  /** Solid segment. */
  | readonly ['l', number, number, number, number]
  /** Dashed segment (hidden edge, construction line). */
  | readonly ['d', number, number, number, number]
  /** Segment ending in an arrowhead at the second point. */
  | readonly ['arrow', number, number, number, number]
  /** Solid closed polygon. */
  | readonly ['poly', readonly number[]]
  /** Shaded polygon (no outline) — e.g. liquid in a vessel. */
  | readonly ['fill', readonly number[]]
  /** Filled dark polygon — a solid object such as a boat. */
  | readonly ['solid', readonly number[]]
  /**
   * Elliptic arc: centre, radii, from/to angle in degrees (0 = right,
   * 90 = down, clockwise), dashed or not. A full ellipse is 0 → 360.
   */
  | readonly ['arc', number, number, number, number, number, number, boolean]
  /**
   * Ellipse by conjugate half-diameters — centre c, vectors a and b, the
   * point c + a·cos t + b·sin t for t from/to (degrees): the projection of
   * a circle inscribed in a parallelogram face (a and b reach the midpoints
   * of its sides), as a cylinder base inside a prism is drawn.
   */
  | readonly ['ell', number, number, number, number, number, number, number, number, boolean]
  /** Point drawn as a small dot. */
  | readonly ['dot', number, number]
  /** `n` equal-segment ticks across the middle of a segment. */
  | readonly ['tick', number, number, number, number, number]
  /** Right-angle mark at a vertex towards two other points. */
  | readonly ['right', number, number, number, number, number, number]
  /** `n` arcs of an angle at a vertex between two rays (towards two points). */
  | readonly ['angle', number, number, number, number, number, number, number]
  /** Label centred at a point (italic Latin/Cyrillic letters, digits, Greek). */
  | readonly ['t', number, number, string];

export interface GeoFigure {
  /** Size of the source fragment the coordinates were taken on. */
  w: number;
  h: number;
  items: readonly GeoItem[];
  /** Largest width the drawing is shown at, px (it always fits the screen). */
  maxWidth?: number;
  ariaLabel: string;
}

const LINE = 'var(--color-text-primary)';
const VIEW = 320;

function pts(list: readonly number[], s: number): string {
  const out: string[] = [];
  for (let i = 0; i + 1 < list.length; i += 2) out.push(`${list[i]! * s},${list[i + 1]! * s}`);
  return out.join(' ');
}

function arcPath(cx: number, cy: number, rx: number, ry: number, a0: number, a1: number) {
  const step = (a1 - a0) / Math.max(8, Math.ceil(Math.abs(a1 - a0) / 6));
  const p: string[] = [];
  for (let a = a0, i = 0; i === 0 || (step > 0 ? a <= a1 + 1e-9 : a >= a1 - 1e-9); a += step, i++) {
    const r = (a * Math.PI) / 180;
    p.push(
      `${i === 0 ? 'M' : 'L'} ${(cx + rx * Math.cos(r)).toFixed(2)} ${(cy + ry * Math.sin(r)).toFixed(2)}`,
    );
  }
  return p.join(' ');
}

function ellPath(
  cx: number,
  cy: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  t0: number,
  t1: number,
) {
  const n = Math.max(8, Math.ceil(Math.abs(t1 - t0) / 5));
  const p: string[] = [];
  for (let i = 0; i <= n; i++) {
    const t = ((t0 + ((t1 - t0) * i) / n) * Math.PI) / 180;
    const x = cx + ax * Math.cos(t) + bx * Math.sin(t);
    const y = cy + ay * Math.cos(t) + by * Math.sin(t);
    p.push(`${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`);
  }
  return p.join(' ');
}

function unit(ax: number, ay: number, bx: number, by: number): Pt {
  const len = Math.hypot(bx - ax, by - ay) || 1;
  return [(bx - ax) / len, (by - ay) / len];
}

export function GeometryFigure({ figure }: { figure: GeoFigure }) {
  const s = VIEW / Math.max(figure.w, figure.h);
  const W = figure.w * s;
  const H = figure.h * s;
  const pad = 14;
  const maxWidth = figure.maxWidth ?? Math.round(Math.min(340, 300 * (figure.w / figure.h)) + 40);
  // Line weights and label size in screen pixels at the shown width, so a
  // narrow drawing keeps the same 14 px labels as a wide one.
  const u = (W + 2 * pad) / maxWidth;
  const sw = 1.8 * u;
  const thin = 1.25 * u;
  const font = 14 * u;
  return (
    <svg
      viewBox={`${-pad} ${-pad} ${W + 2 * pad} ${H + 2 * pad}`}
      role="img"
      aria-label={figure.ariaLabel}
      style={{
        width: '100%',
        height: 'auto',
        display: 'block',
        maxWidth,
        marginInline: 'auto',
      }}
    >
      {figure.items.map((it, i) => {
        switch (it[0]) {
          case 'l':
          case 'd':
            return (
              <line
                key={i}
                x1={it[1] * s}
                y1={it[2] * s}
                x2={it[3] * s}
                y2={it[4] * s}
                stroke={LINE}
                strokeWidth={it[0] === 'd' ? thin : sw}
                strokeDasharray={it[0] === 'd' ? `${5 * u} ${4 * u}` : undefined}
                strokeLinecap="round"
              />
            );
          case 'arrow': {
            const [ux, uy] = unit(it[1], it[2], it[3], it[4]);
            const x2 = it[3] * s;
            const y2 = it[4] * s;
            const L = 9 * u;
            const Wd = 4 * u;
            const bx = x2 - ux * L;
            const by = y2 - uy * L;
            return (
              <g key={i}>
                <line
                  x1={it[1] * s}
                  y1={it[2] * s}
                  x2={bx}
                  y2={by}
                  stroke={LINE}
                  strokeWidth={sw}
                />
                <path
                  d={`M ${x2} ${y2} L ${bx - uy * Wd} ${by + ux * Wd} L ${bx + uy * Wd} ${by - ux * Wd} Z`}
                  fill={LINE}
                />
              </g>
            );
          }
          case 'poly':
            return (
              <polygon
                key={i}
                points={pts(it[1], s)}
                fill="none"
                stroke={LINE}
                strokeWidth={sw}
                strokeLinejoin="round"
              />
            );
          case 'fill':
            return (
              <polygon
                key={i}
                points={pts(it[1], s)}
                fill="color-mix(in srgb, var(--color-text-secondary) 45%, transparent)"
              />
            );
          case 'solid':
            return <polygon key={i} points={pts(it[1], s)} fill={LINE} />;
          case 'arc':
            return (
              <path
                key={i}
                d={arcPath(it[1] * s, it[2] * s, it[3] * s, it[4] * s, it[5], it[6])}
                fill="none"
                stroke={LINE}
                strokeWidth={it[7] ? thin : sw}
                strokeDasharray={it[7] ? `${5 * u} ${4 * u}` : undefined}
              />
            );
          case 'ell':
            return (
              <path
                key={i}
                d={ellPath(
                  it[1] * s,
                  it[2] * s,
                  it[3] * s,
                  it[4] * s,
                  it[5] * s,
                  it[6] * s,
                  it[7],
                  it[8],
                )}
                fill="none"
                stroke={LINE}
                strokeWidth={it[9] ? thin : sw}
                strokeDasharray={it[9] ? `${5 * u} ${4 * u}` : undefined}
              />
            );
          case 'dot':
            return <circle key={i} cx={it[1] * s} cy={it[2] * s} r={2.6 * u} fill={LINE} />;
          case 'tick': {
            const [ux, uy] = unit(it[1], it[2], it[3], it[4]);
            const mx = ((it[1] + it[3]) / 2) * s;
            const my = ((it[2] + it[4]) / 2) * s;
            const n = it[5];
            return (
              <g key={i}>
                {Array.from({ length: n }, (_, k) => {
                  const off = (k - (n - 1) / 2) * 4 * u;
                  const cx = mx + ux * off;
                  const cy = my + uy * off;
                  return (
                    <line
                      key={k}
                      x1={cx - uy * 6 * u}
                      y1={cy + ux * 6 * u}
                      x2={cx + uy * 6 * u}
                      y2={cy - ux * 6 * u}
                      stroke={LINE}
                      strokeWidth={1.5 * u}
                    />
                  );
                })}
              </g>
            );
          }
          case 'right': {
            const [ux, uy] = unit(it[1], it[2], it[3], it[4]);
            const [vx, vy] = unit(it[1], it[2], it[5], it[6]);
            const x = it[1] * s;
            const y = it[2] * s;
            const k = 8 * u;
            return (
              <path
                key={i}
                d={`M ${x + ux * k} ${y + uy * k} L ${x + (ux + vx) * k} ${y + (uy + vy) * k} L ${x + vx * k} ${y + vy * k}`}
                fill="none"
                stroke={LINE}
                strokeWidth={thin}
              />
            );
          }
          case 'angle': {
            const x = it[1] * s;
            const y = it[2] * s;
            const a0 = (Math.atan2(it[4] - it[2], it[3] - it[1]) * 180) / Math.PI;
            let a1 = (Math.atan2(it[6] - it[2], it[5] - it[1]) * 180) / Math.PI;
            if (a1 - a0 > 180) a1 -= 360;
            if (a0 - a1 > 180) a1 += 360;
            return (
              <g key={i}>
                {Array.from({ length: it[7] }, (_, k) => {
                  const r = (15 + k * 4) * u;
                  return (
                    <path
                      key={k}
                      d={arcPath(x, y, r, r, a0, a1)}
                      fill="none"
                      stroke={LINE}
                      strokeWidth={thin}
                    />
                  );
                })}
              </g>
            );
          }
          case 't':
            return (
              <text
                key={i}
                x={it[1] * s}
                y={it[2] * s}
                fontSize={font}
                fontStyle={/^[0-9]/.test(it[3]) ? 'normal' : 'italic'}
                fontFamily="'Times New Roman', Georgia, serif"
                textAnchor="middle"
                dominantBaseline="central"
                fill={LINE}
              >
                {it[3]}
              </text>
            );
          default:
            return null;
        }
      })}
    </svg>
  );
}
