import type { ReactNode } from 'react';
import { Task1TriangleSVG } from './Task1TriangleSVG.js';
import { Task2VectorsSVG } from './Task2VectorsSVG.js';
import { Task3CylindersSVG } from './Task3CylindersSVG.js';
import { Task8DerivativeGraphSVG } from './Task8DerivativeGraphSVG.js';
import { Task11ParabolaSVG } from './Task11ParabolaSVG.js';
import { Task14PyramidSVG } from './Task14PyramidSVG.js';
import { Task17TrapezoidSVG } from './Task17TrapezoidSVG.js';
import {
  Ege2026V10Task11,
  Ege2026V10Task2,
  Ege2026V3Task2,
  Ege2026V4Task2,
  Ege2026V6Task2,
  Ege2026V7Task11,
  Ege2026V7Task8,
  Ege2026V9Task11,
  Ege2026V9Task2,
} from './Ege2026Figures.js';
import {
  Ege2027V2Task12,
  Ege2027V2Task9,
  Ege2027V3Task12,
  Ege2027V3Task2,
  Ege2027V4Task12,
  Ege2027V4Task2,
  Ege2027V5Task12,
  Ege2027V5Task9,
  Ege2027V6Task12,
  Ege2027V6Task9,
  Ege2027V7Task12,
  Ege2027V7Task2,
  Ege2027V7Task9,
  Ege2027V8Task12,
  Ege2027V8Task2,
  Ege2027V8Task9,
  Ege2027V9Task12,
  Ege2027V10Task12,
} from './Ege2027Figures.js';

/** Matches the renderer families a new illustration can be built from — see CoordinatePlaneBase/FunctionGraphSVG/CoordinatePlaneSVG and the *SVG task components for the actual drawing code. Kept mainly for tests/documentation, not for any runtime branching. */
export type IllustrationKind =
  'geometry_2d' | 'geometry_3d' | 'function_graph' | 'coordinate_plane';

interface IllustrationEntry {
  kind: IllustrationKind;
  /** True when the source ЕГЭ material actually prints a diagram here
   * (verified against the PDF — EGE Fidelity audit Block 4/6) and this
   * SVG is a faithful vector reconstruction of THAT diagram, element by
   * element — so it belongs inside "Условие", replacing the raw scan
   * image entirely (never shown as a raster picture — audit Block 4).
   * False means the original prints no diagram at all for this task
   * (a Part 2 proof left for the student to sketch); the SVG then is
   * our own solving aid, built only from facts the problem states or
   * the solution derives, and renders outside "Условие" labelled
   * "Иллюстрация к решению" so it's never mistaken for the original. */
  reconstructsOriginal: boolean;
  render: () => ReactNode;
}

/**
 * Custom SVG illustrations, keyed by the task's import tag and number
 * (`ege-2026-variant-3:2`) — never by the number alone: the same number
 * in another variant or book is a different figure. To add one: draw it
 * from the original (CoordinatePlaneSVG / FunctionGraphSVG /
 * TracedGraphSVG, house style: #111827-like primary lines, accent
 * colours for vectors, 12–14px labels), then add one line here.
 *
 * ЕГЭ 2026 Ященко Вариант 1 (pages 1-4): the source prints a real diagram
 * for tasks 1, 3, 8 and 11 — 2, 14 and 17 are text-only, their SVG is a
 * solving aid. Варианты 3–10: drawn from «ЕГЭ 2026 Ященко, первые 20
 * вариантов» (docs/imports/ege-2026-v2-v10-figures-audit.md). ЕГЭ 2027
 * Ященко Вариант 2 №9 and №12: drawn from the book's scan
 * (docs/imports/ege-2027-yashchenko-v1-v2-report.md).
 */
const CUSTOM_ILLUSTRATIONS: Record<string, IllustrationEntry> = {
  'ege-2026-variant-1:1': {
    kind: 'geometry_2d',
    reconstructsOriginal: true,
    render: () => <Task1TriangleSVG />,
  },
  'ege-2026-variant-1:2': {
    kind: 'coordinate_plane',
    reconstructsOriginal: false,
    render: () => <Task2VectorsSVG />,
  },
  'ege-2026-variant-1:3': {
    kind: 'geometry_3d',
    reconstructsOriginal: true,
    render: () => <Task3CylindersSVG />,
  },
  'ege-2026-variant-1:8': {
    kind: 'function_graph',
    reconstructsOriginal: true,
    render: () => <Task8DerivativeGraphSVG />,
  },
  'ege-2026-variant-1:11': {
    kind: 'function_graph',
    reconstructsOriginal: true,
    render: () => <Task11ParabolaSVG />,
  },
  'ege-2026-variant-1:14': {
    kind: 'geometry_3d',
    reconstructsOriginal: false,
    render: () => <Task14PyramidSVG />,
  },
  'ege-2026-variant-1:17': {
    kind: 'geometry_2d',
    reconstructsOriginal: false,
    render: () => <Task17TrapezoidSVG />,
  },
  'ege-2026-variant-3:2': {
    kind: 'coordinate_plane',
    reconstructsOriginal: true,
    render: () => <Ege2026V3Task2 />,
  },
  'ege-2026-variant-4:2': {
    kind: 'coordinate_plane',
    reconstructsOriginal: true,
    render: () => <Ege2026V4Task2 />,
  },
  'ege-2026-variant-6:2': {
    kind: 'coordinate_plane',
    reconstructsOriginal: true,
    render: () => <Ege2026V6Task2 />,
  },
  'ege-2026-variant-9:2': {
    kind: 'coordinate_plane',
    reconstructsOriginal: true,
    render: () => <Ege2026V9Task2 />,
  },
  'ege-2026-variant-10:2': {
    kind: 'coordinate_plane',
    reconstructsOriginal: true,
    render: () => <Ege2026V10Task2 />,
  },
  'ege-2026-variant-7:8': {
    kind: 'function_graph',
    reconstructsOriginal: true,
    render: () => <Ege2026V7Task8 />,
  },
  'ege-2026-variant-7:11': {
    kind: 'function_graph',
    reconstructsOriginal: true,
    render: () => <Ege2026V7Task11 />,
  },
  'ege-2026-variant-9:11': {
    kind: 'function_graph',
    reconstructsOriginal: true,
    render: () => <Ege2026V9Task11 />,
  },
  'ege-2026-variant-10:11': {
    kind: 'function_graph',
    reconstructsOriginal: true,
    render: () => <Ege2026V10Task11 />,
  },
  'ege-2027-variant-2:9': {
    kind: 'function_graph',
    reconstructsOriginal: true,
    render: () => <Ege2027V2Task9 />,
  },
  'ege-2027-variant-2:12': {
    kind: 'function_graph',
    reconstructsOriginal: true,
    render: () => <Ege2027V2Task12 />,
  },
  'ege-2027-variant-3:2': {
    kind: 'coordinate_plane',
    reconstructsOriginal: true,
    render: () => <Ege2027V3Task2 />,
  },
  'ege-2027-variant-3:12': {
    kind: 'function_graph',
    reconstructsOriginal: true,
    render: () => <Ege2027V3Task12 />,
  },
  'ege-2027-variant-4:2': {
    kind: 'coordinate_plane',
    reconstructsOriginal: true,
    render: () => <Ege2027V4Task2 />,
  },
  'ege-2027-variant-4:12': {
    kind: 'function_graph',
    reconstructsOriginal: true,
    render: () => <Ege2027V4Task12 />,
  },
  'ege-2027-variant-5:9': {
    kind: 'function_graph',
    reconstructsOriginal: true,
    render: () => <Ege2027V5Task9 />,
  },
  'ege-2027-variant-5:12': {
    kind: 'function_graph',
    reconstructsOriginal: true,
    render: () => <Ege2027V5Task12 />,
  },
  'ege-2027-variant-6:9': {
    kind: 'function_graph',
    reconstructsOriginal: true,
    render: () => <Ege2027V6Task9 />,
  },
  'ege-2027-variant-6:12': {
    kind: 'function_graph',
    reconstructsOriginal: true,
    render: () => <Ege2027V6Task12 />,
  },
  'ege-2027-variant-7:2': {
    kind: 'coordinate_plane',
    reconstructsOriginal: true,
    render: () => <Ege2027V7Task2 />,
  },
  'ege-2027-variant-7:9': {
    kind: 'function_graph',
    reconstructsOriginal: true,
    render: () => <Ege2027V7Task9 />,
  },
  'ege-2027-variant-7:12': {
    kind: 'function_graph',
    reconstructsOriginal: true,
    render: () => <Ege2027V7Task12 />,
  },
  'ege-2027-variant-8:2': {
    kind: 'coordinate_plane',
    reconstructsOriginal: true,
    render: () => <Ege2027V8Task2 />,
  },
  'ege-2027-variant-8:9': {
    kind: 'function_graph',
    reconstructsOriginal: true,
    render: () => <Ege2027V8Task9 />,
  },
  'ege-2027-variant-8:12': {
    kind: 'function_graph',
    reconstructsOriginal: true,
    render: () => <Ege2027V8Task12 />,
  },
  'ege-2027-variant-9:12': {
    kind: 'function_graph',
    reconstructsOriginal: true,
    render: () => <Ege2027V9Task12 />,
  },
  'ege-2027-variant-10:12': {
    kind: 'function_graph',
    reconstructsOriginal: true,
    render: () => <Ege2027V10Task12 />,
  },
};

/** The illustration drawn for this very task (one of its tags + its number), or null. */
function findEntry(tags: readonly string[] | undefined, taskNumber: number) {
  for (const tag of tags ?? []) {
    const entry = CUSTOM_ILLUSTRATIONS[`${tag}:${taskNumber}`];
    if (entry) return entry;
  }
  return null;
}

export function getCustomIllustration(
  tags: readonly string[] | undefined,
  taskNumber: number,
): ReactNode | null {
  return findEntry(tags, taskNumber)?.render() ?? null;
}

export function getIllustrationKind(
  tags: readonly string[] | undefined,
  taskNumber: number,
): IllustrationKind | null {
  return findEntry(tags, taskNumber)?.kind ?? null;
}

/** True when this task's SVG reconstructs a diagram the source
 * material really prints (see `IllustrationEntry.reconstructsOriginal`
 * above) — false both when there's no custom illustration at all and
 * when it's a solving aid for a no-diagram problem. */
export function illustrationReconstructsOriginal(
  tags: readonly string[] | undefined,
  taskNumber: number,
): boolean {
  return findEntry(tags, taskNumber)?.reconstructsOriginal ?? false;
}

/** For tests/reports — every `tag:taskNumber` with a custom illustration. */
export function listIllustratedTasks(): readonly string[] {
  return Object.keys(CUSTOM_ILLUSTRATIONS);
}
