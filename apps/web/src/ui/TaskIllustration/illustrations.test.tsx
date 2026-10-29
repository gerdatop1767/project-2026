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
