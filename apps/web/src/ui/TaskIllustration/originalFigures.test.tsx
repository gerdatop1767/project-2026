import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { TaskExamIllustration } from './TaskIllustration.js';
import { GEO_FIGURES } from './geometryFigures.js';
import { getCustomIllustration, illustrationReconstructsOriginal } from './illustrations.js';

/**
 * Every task whose original page prints a figure (graph, vectors,
 * drawing, river), found by scanning all 140 pages of the two books
 * (docs/imports/math-visuals-complete-audit-2026-2027.md). If a task here
 * loses its drawing — or a new import tags tasks differently — this fails.
 */
const ORIGINAL_FIGURES: Record<2026 | 2027, Record<number, readonly number[]>> = {
  2026: {
    1: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    2: [3, 4, 6, 9, 10],
    3: [1, 2, 3, 4, 6, 7, 8, 9, 10],
    8: [1, 2, 3, 4, 7, 8],
    11: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  },
  2027: {
    1: Array.from({ length: 25 }, (_, i) => i + 1),
    2: [3, 4, 7, 8, 13, 14, 16, 19, 20, 23, 24],
    3: Array.from({ length: 25 }, (_, i) => i + 1).filter((v) => v !== 15),
    9: [1, 2, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 17, 18, 21, 22, 25],
    12: Array.from({ length: 25 }, (_, i) => i + 1),
    17: [9, 10, 21, 22],
  },
};

/**
 * Hidden (needs_review) since the 2027 audit: the mark x₉/x₁₂ sits almost
 * on the curve's peak, so the answer depends on how the print is read.
 * Their scan fragment stays the reference; students never see them.
 */
const MANUAL_REVIEW = new Set(['2027:9:9', '2027:10:9']);

const all = Object.entries(ORIGINAL_FIGURES).flatMap(([year, byNumber]) =>
  Object.entries(byNumber).flatMap(([n, variants]) =>
    variants.map((v) => ({ year: Number(year), v, n: Number(n) })),
  ),
);

describe('every figure printed in the books is a digital drawing of ours', () => {
  it('the register counts 146 printed figures in the 35 variants', () => {
    expect(all).toHaveLength(146);
  });

  it.each(all.filter((t) => !MANUAL_REVIEW.has(`${t.year}:${t.v}:${t.n}`)))(
    '$year В$v №$n: own SVG inside «Условие», never the scan crop',
    ({ year, v, n }) => {
      const tags = [`ege-${year}-variant-${v}`];
      expect(illustrationReconstructsOriginal(tags, n)).toBe(true);
      const { container } = render(
        <TaskExamIllustration
          subjectId="math"
          tags={tags}
          taskNumber={n}
          imageUrl={`/tasks/imports/ege-${year}-variant-${v}/task-scan.png`}
          conditionMd="На рисунке изображён"
        />,
      );
      expect(container.querySelector('svg[role="img"]')).not.toBeNull();
      expect(container.querySelector('img')).toBeNull();
      expect(container.querySelector('[role="note"]')).toBeNull();
    },
  );

  it('no drawing is registered for a task whose original prints none (e.g. 2026 В5 №3, 2027 В15 №3)', () => {
    expect(getCustomIllustration(['ege-2026-variant-5'], 3)).toBeNull();
    expect(getCustomIllustration(['ege-2027-variant-15'], 3)).toBeNull();
  });
});

describe('geometry drawings are well-formed', () => {
  it.each(Object.entries(GEO_FIGURES))(
    '%s: every coordinate is inside its source fragment',
    (_, f) => {
      const coords: number[] = [];
      for (const it of f.items) {
        if (it[0] === 'poly' || it[0] === 'fill' || it[0] === 'solid') coords.push(...it[1]);
        else if (it[0] === 'l' || it[0] === 'd' || it[0] === 'arrow')
          coords.push(it[1], it[2], it[3], it[4]);
        else if (it[0] === 't' || it[0] === 'dot') coords.push(it[1], it[2]);
      }
      for (let i = 0; i + 1 < coords.length; i += 2) {
        expect(coords[i]).toBeGreaterThanOrEqual(-1);
        expect(coords[i]).toBeLessThanOrEqual(f.w + 1);
        expect(coords[i + 1]).toBeGreaterThanOrEqual(-1);
        expect(coords[i + 1]).toBeLessThanOrEqual(f.h + 1);
      }
      expect(f.ariaLabel.length).toBeGreaterThan(10);
    },
  );
});
