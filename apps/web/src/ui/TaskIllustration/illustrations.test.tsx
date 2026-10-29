import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import {
  getCustomIllustration,
  getIllustrationKind,
  illustrationReconstructsOriginal,
  listIllustratedTasks,
} from './illustrations.js';
import {
  EGE_2026_V7_T8_WAYPOINTS,
  EGE_2026_VECTORS,
  ege2026V10T11,
  ege2026V7T11,
  ege2026V9T11,
} from './Ege2026Figures.js';
import {
  EGE_2027_V2_T9_WAYPOINTS,
  EGE_2027_VECTORS,
  ege2027V2T12,
  ege2027V3T12,
  ege2027V4T12,
  EGE_2027_V5_T9_WAYPOINTS,
  ege2027V5T12,
  EGE_2027_V6_T9_WAYPOINTS,
  ege2027V6T12,
  EGE_2027_V7_T9_TANGENT,
  EGE_2027_V7_T9_WAYPOINTS,
  ege2027V7T12,
} from './Ege2027Figures.js';
import { curveY } from './TracedGraphSVG.js';

const V1 = ['ege-2026-variant-1'];
const tag = (v: number) => [`ege-2026-variant-${v}`];

describe('illustration registry', () => {
  it('lists exactly the tasks that have a custom illustration — keyed by import tag and number', () => {
    expect([...listIllustratedTasks()].sort()).toEqual(
      [
        ...[1, 2, 3, 8, 11, 14, 17].map((n) => `ege-2026-variant-1:${n}`),
        'ege-2026-variant-3:2',
        'ege-2026-variant-4:2',
        'ege-2026-variant-6:2',
        'ege-2026-variant-9:2',
        'ege-2026-variant-10:2',
        'ege-2026-variant-7:8',
        'ege-2026-variant-7:11',
        'ege-2026-variant-9:11',
        'ege-2026-variant-10:11',
        'ege-2027-variant-2:9',
        'ege-2027-variant-2:12',
        'ege-2027-variant-3:2',
        'ege-2027-variant-3:12',
        'ege-2027-variant-4:2',
        'ege-2027-variant-4:12',
        'ege-2027-variant-5:9',
        'ege-2027-variant-5:12',
        'ege-2027-variant-6:9',
        'ege-2027-variant-6:12',
        'ege-2027-variant-7:2',
        'ege-2027-variant-7:9',
        'ege-2027-variant-7:12',
      ].sort(),
    );
  });

  it('returns null for a task with no custom illustration, or for the same number in another source', () => {
    expect(getCustomIllustration(V1, 6)).toBeNull();
    expect(getIllustrationKind(V1, 6)).toBeNull();
    expect(illustrationReconstructsOriginal(V1, 6)).toBe(false);
    expect(getCustomIllustration(undefined, 8)).toBeNull();
    expect(getCustomIllustration(['ege-2027-variant-1'], 1)).toBeNull();
    // В8 №8/№11: held back until the recorded answers are reviewed.
    expect(getCustomIllustration(tag(8), 8)).toBeNull();
    expect(getCustomIllustration(tag(8), 11)).toBeNull();
    // Вариант 1's figures never land on another variant's task.
    for (const v of [2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      for (const n of [1, 3, 14, 17]) expect(getCustomIllustration(tag(v), n)).toBeNull();
    }
    expect(getCustomIllustration(tag(5), 2)).toBeNull();
    expect(getCustomIllustration(tag(2), 11)).toBeNull();
  });

  it.each([
    [1, 'geometry_2d', true],
    [2, 'coordinate_plane', false],
    [3, 'geometry_3d', true],
    [8, 'function_graph', true],
    [11, 'function_graph', true],
    [14, 'geometry_3d', false],
    [17, 'geometry_2d', false],
  ] as const)('В1 №%i has kind %s (reconstructsOriginal=%s)', (n, kind, reconstructsOriginal) => {
    expect(getIllustrationKind(V1, n)).toBe(kind);
    expect(getCustomIllustration(V1, n)).not.toBeNull();
    expect(illustrationReconstructsOriginal(V1, n)).toBe(reconstructsOriginal);
  });

  it.each([
    [1, 1],
    [1, 2],
    [1, 3],
    [1, 8],
    [1, 11],
    [1, 14],
    [1, 17],
    [3, 2],
    [4, 2],
    [6, 2],
    [9, 2],
    [10, 2],
    [7, 8],
    [7, 11],
    [9, 11],
    [10, 11],
  ] as const)('В%i №%i renders a labelled <svg role="img">', (v, n) => {
    const { container } = render(<>{getCustomIllustration(tag(v), n)}</>);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute('role', 'img');
    expect(svg?.getAttribute('aria-label')?.length ?? 0).toBeGreaterThan(0);
    expect(svg).toHaveAttribute('viewBox');
    expect(container.querySelector('img')).toBeNull();
  });
});

describe('ЕГЭ 2026 figures drawn from the original — the geometry gives the recorded answers', () => {
  const vec = (v: keyof typeof EGE_2026_VECTORS, i: 0 | 1) => {
    const p = EGE_2026_VECTORS[v][i];
    return [p.x - p.fromX, p.y - p.fromY] as const;
  };
  const len = ([x, y]: readonly [number, number]) => Math.hypot(x, y);

  it('vector figures: a and b read off the grid give each task its answer', () => {
    const [a3, b3] = [vec(3, 0), vec(3, 1)];
    expect([a3, b3]).toEqual([
      [4, -6],
      [5, 6],
    ]);
    expect(a3[0] * 2 * b3[0] + a3[1] * 2 * b3[1]).toBe(-32); // a·2b
    const [a4, b4] = [vec(4, 0), vec(4, 1)];
    expect(0.5 * a4[0] * b4[0] + 0.5 * a4[1] * b4[1]).toBe(4); // 0,5a·b
    const [a6, b6] = [vec(6, 0), vec(6, 1)];
    expect((a6[0] * b6[0] + a6[1] * b6[1]) / (len(a6) * len(b6))).toBeCloseTo(0.28, 12);
    const [a9, b9] = [vec(9, 0), vec(9, 1)];
    expect(len([1.5 * b9[0] - a9[0], 1.5 * b9[1] - a9[1]])).toBe(13);
    const [a10, b10] = [vec(10, 0), vec(10, 1)];
    expect(len([b10[0] - 3 * a10[0], b10[1] - 3 * a10[1]])).toBe(41);
  });

  it('every vector lies on grid nodes inside the printed −6…6 grid', () => {
    for (const vectors of Object.values(EGE_2026_VECTORS)) {
      for (const v of vectors) {
        for (const c of [v.x, v.y, v.fromX, v.fromY]) {
          expect(Number.isInteger(c)).toBe(true);
          expect(Math.abs(c)).toBeLessThanOrEqual(6);
        }
      }
    }
  });

  it('vector names sit clear of both vectors and of the axes, as in the original', () => {
    // Distance from a point to a segment, in grid cells.
    const toSegment = (
      [px, py]: readonly [number, number],
      v: { fromX: number; fromY: number; x: number; y: number },
    ) => {
      const [dx, dy] = [v.x - v.fromX, v.y - v.fromY];
      const t = Math.max(
        0,
        Math.min(1, ((px - v.fromX) * dx + (py - v.fromY) * dy) / (dx * dx + dy * dy)),
      );
      return Math.hypot(px - v.fromX - t * dx, py - v.fromY - t * dy);
    };
    for (const vectors of Object.values(EGE_2026_VECTORS)) {
      for (const { labelAt } of vectors) {
        const p = [labelAt.x, labelAt.y] as const;
        // The letter is ~0.5 cell tall with its arrow drawn above it.
        for (const v of vectors) expect(toSegment(p, v)).toBeGreaterThanOrEqual(0.35);
        expect(Math.abs(labelAt.x)).toBeGreaterThanOrEqual(0.45);
        expect(Math.abs(labelAt.y)).toBeGreaterThanOrEqual(0.45);
      }
    }
  });

  it('В7 №11: parabola through (−4;0), (−2;4), (0;0), line through (2;5); they meet again at −6,5', () => {
    const { f, g } = ege2026V7T11;
    for (const [x, y] of [
      [-4, 0],
      [-2, 4],
      [0, 0],
    ] as const)
      expect(g(x)).toBeCloseTo(y, 12);
    expect(f(0)).toBeCloseTo(0, 12);
    expect(f(2)).toBeCloseTo(5, 12);
    expect(f(-6.5)).toBeCloseTo(g(-6.5), 12);
  });

  it('В9 №11: through (0;4) and (2;1), f(−3) = 32', () => {
    expect([ege2026V9T11(0), ege2026V9T11(2), ege2026V9T11(-3)]).toEqual([4, 1, 32]);
  });

  it('В10 №11: through (−2;0) and (1;4), f(29) = 10', () => {
    expect([ege2026V10T11(-2), ege2026V10T11(1), ege2026V10T11(29)]).toEqual([0, 4, 10]);
    expect(Number.isNaN(ege2026V10T11(-3))).toBe(true);
  });

  it('В7 №8: the traced curve has its least slope at the marked point 1 (the recorded answer)', () => {
    const slope = (x: number) =>
      (curveY(EGE_2026_V7_T8_WAYPOINTS, x + 0.1) - curveY(EGE_2026_V7_T8_WAYPOINTS, x - 0.1)) / 0.2;
    const s = Object.fromEntries([-1, 1, 3, 4].map((x) => [x, slope(x)]));
    expect(Math.abs(s[-1]!)).toBeLessThan(0.5); // peak
    expect(Math.abs(s[3]!)).toBeLessThan(0.5); // peak
    expect(s[4]!).toBeGreaterThan(1); // rising
    expect(s[1]!).toBeLessThan(-1.5); // steep fall
    expect(Math.min(...Object.values(s))).toBe(s[1]);
  });
});

describe('ЕГЭ 2027 Ященко, Вариант 2 — figures drawn from the scan', () => {
  const V2 = ['ege-2027-variant-2'];

  it('only В2 №9 and №12 get an SVG; В1, other numbers and 2026 never get it', () => {
    for (const n of [9, 12]) {
      const { container } = render(<>{getCustomIllustration(V2, n)}</>);
      const svg = container.querySelector('svg');
      expect(svg).toHaveAttribute('role', 'img');
      expect(svg?.getAttribute('aria-label')).toContain(`вариант 2, задание ${n})`);
      expect(container.querySelector('img')).toBeNull();
      expect(illustrationReconstructsOriginal(V2, n)).toBe(true);
      expect(getCustomIllustration(['ege-2027-variant-1'], n)).toBeNull();
    }
    for (const n of [1, 3]) expect(getCustomIllustration(V2, n)).toBeNull();
    expect(getCustomIllustration(['ege-2026-variant-2'], 9)).toBeNull();
  });

  it('№9: f′ changes sign − → + on [−5; 3] only at −2 (the recorded answer), + → − at 2', () => {
    const w = EGE_2027_V2_T9_WAYPOINTS;
    expect(w[0]![0]).toBe(-7);
    expect(w[w.length - 1]![0]).toBe(7);
    const zeros: { x: number; rising: boolean }[] = [];
    for (let i = 0; i < w.length - 1; i += 1) {
      const [x0, y0] = w[i]!;
      const [x1, y1] = w[i + 1]!;
      if (y0 * y1 < 0) zeros.push({ x: x0 - (y0 * (x1 - x0)) / (y1 - y0), rising: y1 > y0 });
    }
    expect(zeros.map((z) => Math.round(z.x))).toEqual([-6, -2, 2]);
    for (const z of zeros) expect(Math.abs(z.x - Math.round(z.x))).toBeLessThan(0.1);
    const minima = zeros.filter((z) => z.rising && z.x >= -5 && z.x <= 3);
    expect(minima.map((z) => Math.round(z.x))).toEqual([-2]);
    expect(curveY(w, -1)).toBeCloseTo(3, 1); // the printed peak sits on the grid node
  });

  it('№12: through (1;0), (3;2), (9;4), and f(x) = 6 at x = 27', () => {
    expect(ege2027V2T12(1)).toBeCloseTo(0, 12);
    expect(ege2027V2T12(3)).toBeCloseTo(2, 12);
    expect(ege2027V2T12(9)).toBeCloseTo(4, 12);
    expect(ege2027V2T12(27)).toBeCloseTo(6, 12);
    expect(Number.isNaN(ege2027V2T12(0))).toBe(true);
  });
});

describe('ЕГЭ 2027 Ященко, Варианты 3–10 — figures drawn from the scan', () => {
  const tag = (v: number) => [`ege-2027-variant-${v}`];
  const vec = (v: keyof typeof EGE_2027_VECTORS, i: 0 | 1) => {
    const p = EGE_2027_VECTORS[v][i];
    return [p.x - p.fromX, p.y - p.fromY] as const;
  };

  it.each([
    [3, 2],
    [3, 12],
    [4, 2],
    [4, 12],
    [5, 9],
    [5, 12],
    [6, 9],
    [6, 12],
    [7, 2],
    [7, 9],
    [7, 12],
  ] as const)('В%i №%i renders its own labelled SVG', (v, n) => {
    const { container } = render(<>{getCustomIllustration(tag(v), n)}</>);
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('role', 'img');
    expect(svg?.getAttribute('aria-label')).toContain(`вариант ${v}, задание ${n})`);
    expect(container.querySelector('img')).toBeNull();
    expect(illustrationReconstructsOriginal(tag(v), n)).toBe(true);
    // The 2026 task with the same variant and number is a different figure.
    const other = render(<>{getCustomIllustration([`ege-2026-variant-${v}`], n)}</>);
    expect(other.container.innerHTML).not.toBe(container.innerHTML);
    // Another 2027 variant with the same number never shows this figure.
    for (const w of [3, 4, 5, 6, 7, 8, 9, 10].filter((w) => w !== v)) {
      const r = render(<>{getCustomIllustration(tag(w), n)}</>);
      expect(r.container.innerHTML).not.toBe(container.innerHTML);
      r.unmount();
    }
  });

  it('every vector lies on grid nodes', () => {
    for (const vectors of Object.values(EGE_2027_VECTORS))
      for (const v of vectors)
        for (const c of [v.x, v.y, v.fromX, v.fromY]) expect(Number.isInteger(c)).toBe(true);
  });

  it('В3 №2: a = (7; −4), b = (−1; −4), |a + 2b| = 13', () => {
    const [a, b] = [vec(3, 0), vec(3, 1)];
    expect([a, b]).toEqual([
      [7, -4],
      [-1, -4],
    ]);
    expect(Math.hypot(a[0] + 2 * b[0], a[1] + 2 * b[1])).toBe(13);
  });

  it('В3 №12: both graphs pass the marked points and meet again at x = −10', () => {
    const { f, g } = ege2027V3T12;
    expect(f(-2)).toBe(2);
    expect(f(1)).toBe(-4);
    expect(g(-4)).toBeCloseTo(-2, 12);
    expect(g(1)).toBeCloseTo(-4, 12);
    expect(f(-10)).toBeCloseTo(g(-10), 12);
  });

  it('В4 №2: a = (−11; −7), b = (4; −10), |a + 0,5b| = 15', () => {
    const [a, b] = [vec(4, 0), vec(4, 1)];
    expect([a, b]).toEqual([
      [-11, -7],
      [4, -10],
    ]);
    expect(Math.hypot(a[0] + 0.5 * b[0], a[1] + 0.5 * b[1])).toBe(15);
  });

  it('В4 №12: both graphs pass the marked points and meet again at x = 10', () => {
    const { f, g } = ege2027V4T12;
    expect(f(1)).toBe(2);
    expect(f(-2)).toBe(-1);
    expect(g(-4)).toBeCloseTo(3, 12);
    expect(g(1)).toBeCloseTo(2, 12);
    expect(f(10)).toBeCloseTo(g(10), 12);
  });

  it('В5 №9: f′ changes sign + → − at −14, −6, 1, 6 — two maxima on [−9; 3]', () => {
    const w = EGE_2027_V5_T9_WAYPOINTS;
    expect([w[0], w[w.length - 1]]).toEqual([
      [-17, 1],
      [7, -2],
    ]);
    const falls: number[] = [];
    for (let i = 0; i < w.length - 1; i += 1) {
      const [x0, y0] = w[i]!;
      const [x1, y1] = w[i + 1]!;
      if (y0 > 0 && y1 < 0) falls.push(x0 - (y0 * (x1 - x0)) / (y1 - y0));
    }
    expect(falls.map(Math.round)).toEqual([-14, -6, 1, 6]);
    for (const x of falls) expect(Math.abs(x - Math.round(x))).toBeLessThan(0.1);
    expect(falls.filter((x) => x >= -9 && x <= 3)).toHaveLength(2);
  });

  it('В5 №12: √(4x/3) and √(x+5) pass the marked points and meet at x = 15', () => {
    const { f, g } = ege2027V5T12;
    expect(f(0)).toBe(0);
    expect(f(3)).toBeCloseTo(2, 12);
    expect([g(-5), g(-4), g(-1)]).toEqual([0, 1, 2]);
    expect(f(15)).toBeCloseTo(g(15), 12);
  });

  it('В6 №9: f′ crosses the axis 5 times, 4 of them on [−7; 7], none near the ends', () => {
    const w = EGE_2027_V6_T9_WAYPOINTS;
    const zeros: number[] = [];
    for (let i = 0; i < w.length - 1; i += 1) {
      const [x0, y0] = w[i]!;
      const [x1, y1] = w[i + 1]!;
      if (y0 * y1 < 0) zeros.push(x0 - (y0 * (x1 - x0)) / (y1 - y0));
    }
    expect(zeros).toHaveLength(5);
    const inside = zeros.filter((x) => x >= -7 && x <= 7);
    expect(inside).toHaveLength(4);
    for (const x of zeros) expect(Math.min(Math.abs(x + 7), Math.abs(x - 7))).toBeGreaterThan(0.5);
  });

  it('В6 №12: √(9x/7) and √(x+3) pass the marked points and meet at x = 10,5', () => {
    const { f, g } = ege2027V6T12;
    expect(f(0)).toBe(0);
    expect(f(7)).toBeCloseTo(3, 12);
    expect([g(-3), g(-2), g(1), g(6)]).toEqual([0, 1, 2, 3]);
    expect(f(10.5)).toBeCloseTo(g(10.5), 12);
  });

  it('В7 №2: a = (−6; −3), b = (5; 8), 2a·b = −108', () => {
    const [a, b] = [vec(7, 0), vec(7, 1)];
    expect([a, b]).toEqual([
      [-6, -3],
      [5, 8],
    ]);
    expect(2 * a[0] * b[0] + 2 * a[1] * b[1]).toBe(-108);
  });

  it('В7 №9: the tangent through (−6; −1) and (−1; −3) has slope −0,4 and touches the curve at x₀', () => {
    const { x0, through } = EGE_2027_V7_T9_TANGENT;
    const [[x1, y1], [x2, y2]] = through;
    const k = (y2 - y1) / (x2 - x1);
    expect(k).toBeCloseTo(-0.4, 12);
    const line = (x: number) => y1 + k * (x - x1);
    const w = EGE_2027_V7_T9_WAYPOINTS;
    expect(curveY(w, x0)).toBeCloseTo(line(x0), 2);
    // The curve stays on one side of its tangent around x₀.
    for (const [x, y] of w)
      if (Math.abs(x - x0) <= 1.5 && x !== x0) expect(y).toBeGreaterThan(line(x));
  });

  it('В7 №12: through (0; −2) and (2; −2), f(−5) = 12', () => {
    expect(ege2027V7T12(0)).toBeCloseTo(-2, 12);
    expect(ege2027V7T12(2)).toBeCloseTo(-2, 12);
    expect(ege2027V7T12(-3)).toBeCloseTo(4, 12);
    expect(ege2027V7T12(-5)).toBeCloseTo(12, 12);
  });
});
