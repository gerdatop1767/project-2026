import type { GeoFigure, GeoItem } from './GeometryFigure.js';

/**
 * Geometry drawings of ЕГЭ 2026 и 2027 Ященко (задания №1, №3, №17),
 * measured on the book's own pages: every coordinate is in the pixels of
 * the page fragment named in the comment (a 2027 scan fragment in
 * apps/web/public/tasks/imports/…, kept there as the reference). Points the
 * construction defines — midpoints, an inscribed circle, an ellipse
 * inscribed in a prism face — are computed from the measured vertices, so
 * the drawing is exact where the book's is exact.
 *
 * 2026 В(k) and 2027 В(k+10) print the same figures (word-for-word tasks);
 * figures that are identical across variants are one entry, registered
 * under every task that prints it (illustrations.tsx).
 * Audit: docs/imports/math-visuals-complete-audit-2026-2027.md.
 */

const mid = (a: readonly [number, number], b: readonly [number, number]) =>
  [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] as const;

function poly(...p: (readonly [number, number])[]): GeoItem {
  return ['poly', p.flat()];
}
function seg(a: readonly [number, number], b: readonly [number, number], dashed = false): GeoItem {
  return [dashed ? 'd' : 'l', a[0], a[1], b[0], b[1]];
}
function ticks(a: readonly [number, number], b: readonly [number, number], n = 1): GeoItem {
  return ['tick', a[0], a[1], b[0], b[1], n];
}
/** Intersection of lines p1p2 and p3p4. */
function cross(
  p1: readonly [number, number],
  p2: readonly [number, number],
  p3: readonly [number, number],
  p4: readonly [number, number],
): readonly [number, number] {
  const d = (p1[0] - p2[0]) * (p3[1] - p4[1]) - (p1[1] - p2[1]) * (p3[0] - p4[0]);
  const a = p1[0] * p2[1] - p1[1] * p2[0];
  const b = p3[0] * p4[1] - p3[1] * p4[0];
  return [
    (a * (p3[0] - p4[0]) - (p1[0] - p2[0]) * b) / d,
    (a * (p3[1] - p4[1]) - (p1[1] - p2[1]) * b) / d,
  ];
}

// ── №1 ────────────────────────────────────────────────────────────────

/** 2027 В1 №1 (task-01-triangle.png, 99×166): isosceles, apex angle 30°. */
const V1_1 = (() => {
  const T = [50, 12] as const;
  const L = [14, 156] as const;
  const R = [90, 156] as const;
  return {
    w: 99,
    h: 166,
    maxWidth: 170,
    ariaLabel: 'Равнобедренный треугольник с отмеченными равными боковыми сторонами',
    items: [poly(T, L, R), ticks(T, L), ticks(T, R)],
  } satisfies GeoFigure;
})();

/** 2027 В2 №1 (task-01-triangle.png, 215×70): isosceles, apex angle 150°. */
const V2_1 = (() => {
  const T = [107, 8] as const;
  const L = [9, 56] as const;
  const R = [199, 56] as const;
  return {
    w: 215,
    h: 70,
    ariaLabel: 'Тупоугольный равнобедренный треугольник с отмеченными равными боковыми сторонами',
    items: [poly(T, L, R), ticks(T, L), ticks(T, R)],
  } satisfies GeoFigure;
})();

/** 2027 В3 №1 (task-01-trapezoid.png, 184×100): midline cut by a diagonal. */
const V3_1 = (() => {
  const TL = [79, 8] as const;
  const TR = [160, 8] as const;
  const BR = [177, 90] as const;
  const BL = [7, 91] as const;
  return {
    w: 184,
    h: 100,
    ariaLabel: 'Трапеция, её средняя линия и диагональ, пересекающая среднюю линию',
    items: [poly(TL, TR, BR, BL), seg(TL, BR), seg(mid(TL, BL), mid(TR, BR))],
  } satisfies GeoFigure;
})();

/** 2027 В4 №1 (task-01-trapezoid.png, 283×129): segment joining the diagonals' midpoints. */
const V4_1 = (() => {
  const TL = [87, 9.4] as const;
  const TR = [220.6, 7.6] as const;
  const BR = [276, 119] as const;
  const BL = [7.6, 120] as const;
  return {
    w: 283,
    h: 129,
    ariaLabel: 'Трапеция с диагоналями и отрезком, соединяющим середины диагоналей',
    items: [poly(TL, TR, BR, BL), seg(TL, BR), seg(TR, BL), seg(mid(TR, BL), mid(TL, BR))],
  } satisfies GeoFigure;
})();

/** 2027 В5 = В6 №1 (task-01-triangle.png, 181×149): exterior angles at A and C. */
const V5_1 = (() => {
  const A = [31.8, 122.5] as const;
  const B = [153, 22] as const;
  const C = [98.5, 122.2] as const;
  return {
    w: 181,
    h: 149,
    ariaLabel: 'Треугольник ABC, стороны AB и AC продолжены за вершины A и C',
    items: [
      seg([9.5, 141], B),
      seg(A, [163.6, 122]),
      seg(B, C),
      ['t', 16, 117.5, 'A'],
      ['t', 167, 15, 'B'],
      ['t', 100, 137, 'C'],
    ],
  } satisfies GeoFigure;
})();

/** 2027 В7 = В8 №1 (task-01-trapezoid.png, 141×105): right trapezoid around a circle. */
const V7_1 = {
  w: 141,
  h: 105,
  maxWidth: 230,
  ariaLabel: 'Прямоугольная трапеция, описанная около окружности',
  items: [
    poly([8.2, 7.9], [75.3, 7.9], [133, 96.5], [8.2, 96.5]),
    ['arc', 52.5, 52.2, 44.3, 44.3, 0, 360, false],
  ],
} satisfies GeoFigure;

/** 2027 В9 = В10 №1 (task-01-triangle.png, 231×101): AC = BC. */
const V9_1 = (() => {
  const A = [15.4, 73] as const;
  const B = [207.7, 70.2] as const;
  const C = [112.5, 26.4] as const;
  return {
    w: 231,
    h: 101,
    ariaLabel: 'Равнобедренный треугольник ABC с равными сторонами AC и BC',
    items: [
      poly(A, B, C),
      ticks(A, C),
      ticks(C, B),
      ['t', 112.5, 12, 'C'],
      ['t', 6, 88, 'A'],
      ['t', 217, 84, 'B'],
    ],
  } satisfies GeoFigure;
})();

/**
 * 2027 В11 = В12 №1 = 2026 В2 №1 (task-01-triangle.png, 196×159): AB = BC,
 * bisector AF. (2026 В1 №1 keeps its earlier drawing, Task1TriangleSVG.)
 */
const V11_1 = (() => {
  const A = [16.3, 131.4] as const;
  const B = [99.3, 21.2] as const;
  const C = [181, 128.6] as const;
  const end = [164.7, 56.3] as const;
  const F = cross(A, end, B, C);
  return {
    w: 196,
    h: 159,
    ariaLabel: 'Равнобедренный треугольник ABC с основанием AC и биссектрисой AF',
    items: [
      poly(A, B, C),
      seg(A, end),
      ticks(A, B),
      ticks(B, C),
      ['angle', A[0], A[1], B[0], B[1], F[0], F[1], 1],
      ['angle', A[0], A[1], F[0], F[1], C[0], C[1], 1],
      ['t', 86, 14, 'B'],
      ['t', 143, 49, 'F'],
      ['t', 15, 147, 'A'],
      ['t', 182, 143, 'C'],
    ],
  } satisfies GeoFigure;
})();

/** 2027 В13 №1 = 2026 В3 №1 (task-01-parallelogram.png, 223×93): bisector of the obtuse angle. */
const V13_1 = (() => {
  const TL = [34.4, 10.2] as const;
  const TR = [215.8, 7] as const;
  const BR = [189.3, 81.9] as const;
  const BL = [6.5, 84.7] as const;
  return {
    w: 223,
    h: 93,
    ariaLabel: 'Параллелограмм и биссектриса его тупого угла',
    items: [
      poly(TL, TR, BR, BL),
      seg(TL, [84.7, 82.8]),
      ['angle', TL[0], TL[1], TR[0], TR[1], BL[0], BL[1], 1],
    ],
  } satisfies GeoFigure;
})();

/** 2027 В14 №1 = 2026 В4 №1 (task-01-parallelogram.png, 263×116): two bisectors meet on a side. */
const V14_1 = (() => {
  const TL = [42.8, 7.3] as const;
  const TR = [256.8, 7.3] as const;
  const BR = [221.3, 107.9] as const;
  const BL = [7.3, 107.9] as const;
  const P = [114.3, 107.9] as const;
  return {
    w: 263,
    h: 116,
    ariaLabel:
      'Параллелограмм, биссектрисы двух углов при одной стороне пересекаются на противоположной стороне',
    items: [
      poly(TL, TR, BR, BL),
      seg(TL, P),
      seg(TR, P),
      ['angle', TL[0], TL[1], TR[0], TR[1], BL[0], BL[1], 1],
      ['angle', TR[0], TR[1], BR[0], BR[1], TL[0], TL[1], 2],
    ],
  } satisfies GeoFigure;
})();

/** 2027 В15 = В16 №1 = 2026 В5, В6 №1 (task-01-triangle.png, 195×136): AB = BC, altitude AH. */
const V15_1 = (() => {
  const A = [16.1, 107.5] as const;
  const C = [178, 107.5] as const;
  const H = [76, 27.5] as const;
  const B = [96.3, 43.3] as const;
  return {
    w: 195,
    h: 136,
    ariaLabel: 'Равнобедренный треугольник ABC и высота AH, опущенная на продолжение стороны BC',
    items: [
      seg(A, C),
      seg(A, B),
      seg(H, C),
      seg(A, H),
      ['right', H[0], H[1], A[0], A[1], C[0], C[1]],
      ticks(A, B),
      ticks(B, C),
      ['t', 77, 13, 'H'],
      ['t', 113, 37, 'B'],
      ['t', 14.5, 121, 'A'],
      ['t', 181, 121, 'C'],
    ],
  } satisfies GeoFigure;
})();

/** 2027 В17 №1 = 2026 В7 №1 (task-01-circle.png, 160×164): quadrilateral inscribed in a circle. */
const V17_1 = {
  w: 160,
  h: 164,
  maxWidth: 240,
  ariaLabel: 'Четырёхугольник, вписанный в окружность',
  items: [
    ['arc', 80.3, 80.5, 71.7, 71.7, 0, 360, false],
    poly([33.5, 26.9], [152, 80.1], [44.9, 143.7], [13.8, 106.4]),
  ],
} satisfies GeoFigure;

/** 2027 В18 №1 = 2026 В8 №1 (task-01-circle.png, 164×159). */
const V18_1 = {
  w: 164,
  h: 159,
  maxWidth: 240,
  ariaLabel: 'Четырёхугольник, вписанный в окружность',
  items: [
    ['arc', 81.4, 80.7, 73, 73, 0, 360, false],
    poly([8.7, 82.3], [118, 18], [149.3, 53.8], [129.5, 136.5]),
  ],
} satisfies GeoFigure;

/** 2027 В19 = В20 №1 = 2026 В9, В10 №1 (task-01-triangle.png, 201×157): bisectors meet at O. */
const V19_1 = (() => {
  const A = [15.5, 129.1] as const;
  const B = [147.7, 18.9] as const;
  const C = [185, 127.9] as const;
  const onBC = [167.4, 74.6] as const;
  const onAB = [94.1, 65] as const;
  return {
    w: 201,
    h: 157,
    ariaLabel: 'Треугольник ABC, биссектрисы углов A и C пересекаются в точке O',
    items: [
      poly(A, B, C),
      seg(A, onBC),
      seg(C, onAB),
      ['t', 133, 13, 'B'],
      ['t', 124, 103, 'O'],
      ['t', 15.5, 143, 'A'],
      ['t', 186, 142.5, 'C'],
    ],
  } satisfies GeoFigure;
})();

/** 2027 В21 = В22 №1 (task-01-trapezoid.png, 213×115): midline cut by a diagonal. */
const V21_1 = (() => {
  const TL = [86.8, 7.6] as const;
  const TR = [184.2, 7.6] as const;
  const BR = [205.6, 107.1] as const;
  const BL = [6.2, 107.1] as const;
  return {
    w: 213,
    h: 115,
    ariaLabel: 'Трапеция, её средняя линия и диагональ, делящая среднюю линию',
    items: [poly(TL, TR, BR, BL), seg(TL, BR), seg(mid(TL, BL), mid(TR, BR))],
  } satisfies GeoFigure;
})();

/** 2027 В23 №1 (task-01-triangle.png, 250×155): right angle C, altitude CH, bisector CD. */
const V23_1 = (() => {
  const A = [14.8, 125.5] as const;
  const B = [238, 126] as const;
  const C = [182.5, 29.7] as const;
  const D = [159.8, 125.6] as const;
  const H = [182.5, 125.8] as const;
  return {
    w: 250,
    h: 155,
    ariaLabel: 'Прямоугольный треугольник ABC с прямым углом C, высотой CH и биссектрисой CD',
    items: [
      poly(A, B, C),
      seg(C, D),
      seg(C, H),
      ['right', H[0], H[1], C[0], C[1], B[0], B[1]],
      ['right', C[0], C[1], A[0], A[1], B[0], B[1]],
      ['t', 185, 15.5, 'C'],
      ['t', 13, 143, 'A'],
      ['t', 155.5, 143, 'D'],
      ['t', 186, 143, 'H'],
      ['t', 238, 143, 'B'],
    ],
  } satisfies GeoFigure;
})();

/** 2027 В24 №1 (task-01-triangle.png, 251×156): right angle C, bisector CD, median CM. */
const V24_1 = (() => {
  const A = [18.3, 126] as const;
  const B = [238.8, 127] as const;
  const C = [71.6, 29.8] as const;
  const D = [95.6, 126.1] as const;
  const M = mid(A, B);
  return {
    w: 251,
    h: 156,
    ariaLabel: 'Прямоугольный треугольник ABC с прямым углом C, биссектрисой CD и медианой CM',
    items: [
      poly(A, B, C),
      seg(C, D),
      seg(C, M),
      ['right', C[0], C[1], A[0], A[1], B[0], B[1]],
      ['t', 74, 15.5, 'C'],
      ['t', 16.5, 144, 'A'],
      ['t', 97.5, 144, 'D'],
      ['t', 130.5, 144, 'M'],
      ['t', 237.5, 144, 'B'],
    ],
  } satisfies GeoFigure;
})();

/** 2027 В25 №1 (task-01-quadrilateral.png, 197×257): circle inscribed in ABCD. */
const V25_1 = {
  w: 197,
  h: 257,
  maxWidth: 220,
  ariaLabel: 'Четырёхугольник ABCD, в который вписана окружность',
  items: [
    poly([21.3, 227.5], [127.7, 227.5], [170.2, 180.1], [91.5, 27.7]),
    ['arc', 101, 170.5, 56.5, 56.5, 0, 360, false],
    ['t', 90.5, 15, 'D'],
    ['t', 187, 181, 'C'],
    ['t', 137, 241, 'B'],
    ['t', 14.5, 242, 'A'],
  ],
} satisfies GeoFigure;

// ── №3 ────────────────────────────────────────────────────────────────

/** 2027 В1 = В2 №3 (task-03-cylinder-sphere.png, 178×190): a ball inscribed in a cylinder. */
const V1_3 = {
  w: 178,
  h: 190,
  maxWidth: 220,
  ariaLabel: 'Шар, вписанный в цилиндр',
  items: [
    seg([12.7, 27.3], [12.7, 163.6]),
    seg([166.7, 27.3], [166.7, 163.6]),
    ['arc', 89.7, 27.3, 77, 15.4, 0, 360, false],
    ['arc', 89.7, 163.6, 77, 15.4, 0, 180, false],
    ['arc', 89.7, 163.6, 77, 15.4, 180, 360, true],
    ['arc', 89.7, 95.3, 77, 15.4, 0, 180, false],
    ['arc', 89.7, 95.3, 77, 15.4, 180, 360, true],
    ['arc', 89.7, 94.5, 77.5, 77.5, 0, 360, true],
    ['dot', 89.4, 94.3],
  ],
} satisfies GeoFigure;

/**
 * A cylinder inscribed in a regular quadrilateral prism, as the book draws
 * it: the top face a1b1c1d1 (front-left, front-right, back-right,
 * back-left), lateral edges of length `dy`; the bases' ellipses touch the
 * midpoints of the face sides; the generators where the cylinder touches
 * the front and right faces are solid, the back and left ones and the
 * cylinder's two outline generators dashed, as is everything behind.
 */
function prismWithCylinder(
  a1: readonly [number, number],
  b1: readonly [number, number],
  c1: readonly [number, number],
  d1: readonly [number, number],
  dy: number,
): GeoItem[] {
  const down = (p: readonly [number, number]) => [p[0], p[1] + dy] as const;
  const c = [(a1[0] + b1[0] + c1[0] + d1[0]) / 4, (a1[1] + b1[1] + c1[1] + d1[1]) / 4] as const;
  const right = mid(b1, c1);
  const back = mid(c1, d1);
  const ax = right[0] - c[0];
  const ay = right[1] - c[1];
  const bx = back[0] - c[0];
  const by = back[1] - c[1];
  const front = [c[0] - bx, c[1] - by] as const;
  const left = [c[0] - ax, c[1] - ay] as const;
  // outline generators: where the base ellipse reaches its leftmost/rightmost x
  const t = Math.atan2(bx, ax);
  const ext = (k: number) =>
    [
      c[0] + k * (ax * Math.cos(t) + bx * Math.sin(t)),
      c[1] + k * (ay * Math.cos(t) + by * Math.sin(t)),
    ] as const;
  const r = ext(1);
  const l = ext(-1);
  return [
    poly(a1, b1, c1, d1),
    seg(a1, down(a1)),
    seg(b1, down(b1)),
    seg(c1, down(c1)),
    seg(d1, down(d1), true),
    seg(down(a1), down(b1)),
    seg(down(b1), down(c1)),
    seg(down(c1), down(d1), true),
    seg(down(d1), down(a1), true),
    ['ell', c[0], c[1], ax, ay, bx, by, 0, 360, false],
    ['ell', c[0], c[1] + dy, ax, ay, bx, by, 0, 360, true],
    seg(front, down(front)),
    seg(right, down(right)),
    seg(back, down(back), true),
    seg(left, down(left), true),
    seg(l, down(l), true),
    seg(r, down(r), true),
  ];
}

/** 2027 В4 №3 (task-03-prism-cylinder.png, 272×151): cylinder inscribed in a regular prism. */
const V4_3 = {
  w: 272,
  h: 151,
  ariaLabel: 'Цилиндр, вписанный в правильную четырёхугольную призму',
  items: prismWithCylinder([7, 39], [178, 49], [263, 18], [89, 7.5], 89),
} satisfies GeoFigure;

/**
 * Points where the lines from `apex` touch the axis-aligned ellipse
 * (cx, cy, rx, ry), with their angles — a cone's slant edges and the split
 * between the visible and the hidden part of its base.
 */
function tangents(apex: readonly [number, number], cx: number, cy: number, rx: number, ry: number) {
  const u = (apex[0] - cx) / rx;
  const v = (apex[1] - cy) / ry;
  const phi = Math.atan2(v, u);
  const d = Math.acos(1 / Math.hypot(u, v));
  return [phi - d, phi + d].map((t) => ({
    t: (t * 180) / Math.PI,
    p: [cx + rx * Math.cos(t), cy + ry * Math.sin(t)] as const,
  }));
}

/** A cone standing on an elliptic base: visible front arc solid, back dashed. */
function cone(
  apex: readonly [number, number],
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  hidden: boolean,
): GeoItem[] {
  const [t1, t2] = tangents(apex, cx, cy, rx, ry) as [
    { t: number; p: readonly [number, number] },
    { t: number; p: readonly [number, number] },
  ];
  // the arc below the tangent points (further from the apex) faces the viewer
  const a0 = t2.t;
  let a1 = t1.t + 360;
  if (a1 - a0 > 360) a1 -= 360;
  return [
    seg(apex, t1.p, hidden),
    seg(apex, t2.p, hidden),
    ['arc', cx, cy, rx, ry, a0, a1, hidden],
    ['arc', cx, cy, rx, ry, a1, a0 + 360, true],
  ];
}

/** 2027 В3 №3 (task-03-prism-cylinder.png, 216×127). */
const V3_3 = {
  w: 216,
  h: 127,
  ariaLabel: 'Цилиндр, вписанный в правильную четырёхугольную призму',
  items: prismWithCylinder([7.7, 29.3], [143.2, 39.6], [208.6, 17.1], [71.2, 6.8], 76.5),
} satisfies GeoFigure;

/** 2027 В5 = В6 №3 (task-03-sphere-cone.png, 174×173): a cone whose base is a great circle. */
const V5_3 = (() => {
  const cx = 87.5;
  const cy = 87.7;
  const r = 80;
  const ry = 16.7;
  const apex = [87.5, 7.5] as const;
  const [t1, t2] = tangents(apex, cx, cy, r, ry);
  return {
    w: 174,
    h: 173,
    maxWidth: 230,
    ariaLabel: 'Шар, описанный около конуса; основание конуса — большой круг шара',
    items: [
      ['arc', cx, 87, r, r, 0, 360, false],
      ['arc', cx, cy, r, ry, 0, 180, false],
      ['arc', cx, cy, r, ry, 180, 360, true],
      seg(apex, t1!.p, true),
      seg(apex, t2!.p, true),
      ['d', cx, cy, cx + r, cy],
      ['dot', cx, cy],
    ],
  } satisfies GeoFigure;
})();

/** 2027 В7 = В8 №3 (page 1 of the variant, 128×162): right triangular prism, right angle in the base. */
const V7_3 = (() => {
  const back = [10.2, 11.1] as const;
  const front = [31.6, 47.3] as const;
  const right = [118, 27.7] as const;
  const dy = 104.7;
  const down = (p: readonly [number, number]) => [p[0], p[1] + dy] as const;
  return {
    w: 128,
    h: 162,
    maxWidth: 200,
    ariaLabel: 'Прямая треугольная призма, в основании — прямоугольный треугольник',
    items: [
      poly(back, front, right),
      seg(back, down(back)),
      seg(front, down(front)),
      seg(right, down(right)),
      seg(down(back), down(front)),
      seg(down(front), down(right)),
      seg(down(back), down(right), true),
      ['right', front[0], front[1], back[0], back[1], right[0], right[1]],
      ['right', front[0], front[1] + dy, back[0], back[1] + dy, right[0], right[1] + dy],
    ],
  } satisfies GeoFigure;
})();

/** 2027 В9 №3 (task-03-prism.png, 162×169): a pyramid cut off a triangular prism. */
const V9_3 = (() => {
  const TB = [116.5, 7.7] as const;
  const TL = [31.2, 52.6] as const;
  const TR = [154, 51.9] as const;
  const BL = [6.7, 159.6] as const;
  const BR = [129.5, 158.6] as const;
  const BB = [TB[0] + BL[0] - TL[0], TB[1] + BL[1] - TL[1]] as const;
  return {
    w: 162,
    h: 169,
    maxWidth: 220,
    ariaLabel:
      'Треугольная призма; плоскость через сторону верхнего основания и противоположную вершину нижнего отсекает пирамиду',
    items: [
      poly(TB, TL, TR),
      seg(TL, BL),
      seg(TR, BR),
      seg(BL, BR),
      seg(TB, BB, true),
      seg(BB, BL, true),
      seg(BB, BR, true),
      seg(BL, TR),
      seg(BL, TB, true),
    ],
  } satisfies GeoFigure;
})();

/** 2027 В10 №3 (task-03-pyramid.png, 148×196): a plane through a base side and a point of the opposite edge. */
const V10_3 = (() => {
  const S = [58.4, 9] as const;
  const L = [8.6, 121.6] as const;
  const F = [14.3, 187.8] as const;
  const R = [140.8, 142.9] as const;
  const K = [84.9, 55.1] as const;
  return {
    w: 148,
    h: 196,
    maxWidth: 200,
    ariaLabel:
      'Треугольная пирамида; плоскость проходит через сторону основания и точку на противоположном боковом ребре',
    items: [
      seg(S, L),
      seg(S, F),
      seg(S, R),
      seg(L, F),
      seg(F, R),
      seg(L, R, true),
      seg(K, F),
      seg(K, L, true),
    ],
  } satisfies GeoFigure;
})();

/** Two mugs: a cylinder with its base's back half dashed. */
function cylinder(cx: number, rx: number, top: number, bottom: number, ry: number): GeoItem[] {
  return [
    seg([cx - rx, top], [cx - rx, bottom]),
    seg([cx + rx, top], [cx + rx, bottom]),
    ['arc', cx, top, rx, ry, 0, 360, false],
    ['arc', cx, bottom, rx, ry, 0, 180, false],
    ['arc', cx, bottom, rx, ry, 180, 360, true],
  ];
}

/** 2027 В11 №3 (task-03-cylinders.png, 264×152): two cylinders, the wide one first. */
const V11_3 = {
  w: 264,
  h: 152,
  ariaLabel: 'Два цилиндра: широкий низкий и узкий высокий',
  items: [...cylinder(76.9, 69.8, 86.5, 132.7, 11.5), ...cylinder(210.2, 47, 19.5, 132.4, 11.4)],
} satisfies GeoFigure;

/** 2027 В12 №3 = 2026 В2 №3 (task-03-cylinders.png, 271×152): two mugs, the tall one first. */
const V12_3 = {
  w: 271,
  h: 152,
  ariaLabel: 'Две цилиндрические кружки: узкая высокая и широкая низкая',
  items: [...cylinder(54.8, 47.5, 19.1, 131.7, 12.3), ...cylinder(189.9, 71.3, 84.3, 130.6, 12.5)],
} satisfies GeoFigure;

/** 2027 В13 = В14 №3 = 2026 В3, В4 №3 (task-03-cone.png, 207×238): a cone, its radius dashed. */
const V13_3 = {
  w: 207,
  h: 238,
  maxWidth: 220,
  ariaLabel: 'Конус с проведённым радиусом основания',
  items: [...cone([99, 8.9], 101.2, 202.2, 94.3, 23, false), ['d', 101.2, 202.2, 195.5, 202.2]],
} satisfies GeoFigure;

/** 2027 В16 №3 = 2026 В6 №3 (task-03-box.png, 179×176): box circumscribed about a sphere. */
const V16_3 = (() => {
  const a1 = [7.6, 33.8] as const;
  const b1 = [119.5, 50.8] as const;
  const c1 = [169, 24.2] as const;
  const d1 = [58.4, 7.7] as const;
  const dy = 115.4;
  const down = (p: readonly [number, number]) => [p[0], p[1] + dy] as const;
  return {
    w: 179,
    h: 176,
    maxWidth: 220,
    ariaLabel: 'Прямоугольный параллелепипед, описанный около сферы',
    items: [
      poly(a1, b1, c1, d1),
      seg(a1, down(a1)),
      seg(b1, down(b1)),
      seg(c1, down(c1)),
      seg(d1, down(d1), true),
      seg(down(a1), down(b1), true),
      seg(down(b1), down(c1), true),
      seg(down(c1), down(d1), true),
      seg(down(d1), down(a1), true),
      ['arc', 90.7, 86.5, 69.5, 69.5, 0, 360, true],
      ['arc', 90.7, 87.5, 69.5, 12.5, 0, 360, true],
    ],
  } satisfies GeoFigure;
})();

/** 2027 В17 = В18 №3 = 2026 В7, В8 №3 (task-03-box.png, 239×199): ABCDA₁B₁C₁D₁. */
const V17_3 = (() => {
  const A1 = [28.4, 67.7] as const;
  const B1 = [144.7, 83.1] as const;
  const C1 = [212.7, 47.7] as const;
  const D1 = [96.4, 32.3] as const;
  const dy = 87.5;
  const down = (p: readonly [number, number]) => [p[0], p[1] + dy] as const;
  const [A, B, C, D] = [down(A1), down(B1), down(C1), down(D1)];
  return {
    w: 239,
    h: 199,
    ariaLabel: 'Прямоугольный параллелепипед ABCDA₁B₁C₁D₁',
    items: [
      poly(A1, B1, C1, D1),
      seg(A1, A),
      seg(B1, B),
      seg(C1, C),
      seg(A, B),
      seg(B, C),
      seg(D1, D, true),
      seg(A, D, true),
      seg(D, C, true),
      ['t', 15.5, 45, 'A₁'],
      ['t', 97.5, 14.5, 'D₁'],
      ['t', 219, 33, 'C₁'],
      ['t', 161.5, 91, 'B₁'],
      ['t', 80, 114, 'D'],
      ['t', 214, 152.5, 'C'],
      ['t', 21, 173, 'A'],
      ['t', 148, 183.5, 'B'],
    ],
  } satisfies GeoFigure;
})();

/** A regular quadrilateral pyramid: base FL, FR, BR, BL (BL hidden), apex S. */
function pyramid(
  S: readonly [number, number],
  FL: readonly [number, number],
  FR: readonly [number, number],
  BR: readonly [number, number],
  BL: readonly [number, number],
  height: boolean,
): GeoItem[] {
  const items: GeoItem[] = [
    seg(S, FL),
    seg(S, FR),
    seg(S, BR),
    seg(S, BL, true),
    seg(FL, FR),
    seg(FR, BR),
    seg(BR, BL, true),
    seg(BL, FL, true),
  ];
  if (height) items.push(seg(S, cross(FL, BR, FR, BL), true));
  return items;
}

/** 2027 В19 №3 = 2026 В9 №3 (task-03-pyramid.png, 226×197). */
const V19_3 = {
  w: 226,
  h: 197,
  ariaLabel: 'Правильная четырёхугольная пирамида',
  items: pyramid([111.1, 8.3], [8.7, 165], [138.5, 183.5], [213, 146.6], [81.7, 126.2], false),
} satisfies GeoFigure;

/** 2027 В20 №3 = 2026 В10 №3 (task-03-pyramid.png, 237×202): with its height. */
const V20_3 = {
  w: 237,
  h: 202,
  ariaLabel: 'Правильная четырёхугольная пирамида с проведённой высотой',
  items: pyramid([112.1, 7.7], [9, 164.8], [138.2, 182.1], [211.1, 144.4], [82.9, 126.5], true),
} satisfies GeoFigure;

/** 2027 В21 = В22 №3 (task-03-cylinder-cone.png, 149×191): a cone inside a cylinder, common base and height. */
const V21_3 = (() => {
  const cx = 73.7;
  const rx = 66.6;
  const top = 23.2;
  const bottom = 167.1;
  const ry = 16.4;
  const apex = [cx, top] as const;
  const [t1, t2] = tangents(apex, cx, bottom, rx, ry);
  return {
    w: 149,
    h: 191,
    maxWidth: 200,
    ariaLabel: 'Цилиндр и конус с общим основанием и общей высотой',
    items: [
      ...cylinder(cx, rx, top, bottom, ry),
      seg(apex, t1!.p, true),
      seg(apex, t2!.p, true),
      seg(apex, [cx, bottom], true),
      ['d', cx, bottom, cx + rx, bottom],
    ],
  } satisfies GeoFigure;
})();

/** A ball with its equator: front half solid, back half dashed. */
function ball(cx: number, cy: number, r: number, ry: number): GeoItem[] {
  return [
    ['arc', cx, cy, r, r, 0, 360, false],
    ['arc', cx, cy, r, ry, 0, 180, false],
    ['arc', cx, cy, r, ry, 180, 360, true],
  ];
}

/** 2027 В23 №3 (task-03-sphere.png, 153×155): a ball and its great circle. */
const V23_3 = {
  w: 153,
  h: 155,
  maxWidth: 210,
  ariaLabel: 'Шар и его большой круг',
  items: ball(76.5, 77.5, 70, 17),
} satisfies GeoFigure;

/** 2027 В24 №3 (task-03-spheres.png, 242×150): two balls with their radii. */
const V24_3 = {
  w: 242,
  h: 150,
  ariaLabel: 'Два шара разного радиуса с проведёнными радиусами',
  items: [
    ...ball(75.1, 74.2, 67, 15.7),
    ['d', 75.1, 74.2, 8.1, 74.2],
    ['dot', 75.1, 74.2],
    ...ball(199.3, 74.5, 33, 8),
    ['d', 199.3, 74.5, 166.3, 74.5],
    ['dot', 199.3, 74.5],
  ],
} satisfies GeoFigure;

/** 2027 В25 №3 (task-03-prism.png, 147×187): a regular triangular prism with liquid in it. */
const V25_3 = (() => {
  const back = [8.2, 7.8] as const;
  const front = [33, 49.8] as const;
  const right = [139.3, 30] as const;
  const dy = 129.5;
  const lvl = 65.4;
  const at = (p: readonly [number, number], d: number) => [p[0], p[1] + d] as const;
  return {
    w: 147,
    h: 187,
    maxWidth: 200,
    ariaLabel: 'Сосуд в форме правильной треугольной призмы, частично заполненный жидкостью',
    items: [
      [
        'fill',
        [
          ...at(back, lvl),
          ...at(front, lvl),
          ...at(right, lvl),
          ...at(right, dy),
          ...at(front, dy),
          ...at(back, dy),
        ],
      ],
      poly(back, front, right),
      seg(back, at(back, dy)),
      seg(front, at(front, dy)),
      seg(right, at(right, dy)),
      seg(at(back, dy), at(front, dy)),
      seg(at(front, dy), at(right, dy)),
      seg(at(back, dy), at(right, dy), true),
      seg(at(back, lvl), at(front, lvl)),
      seg(at(front, lvl), at(right, lvl)),
      seg(at(back, lvl), at(right, lvl), true),
    ],
  } satisfies GeoFigure;
})();

// ── №17 ───────────────────────────────────────────────────────────────

/** The river crossing of №17: banks, current, piers at А and Б, the boat's heading at angle α. */
function river(o: {
  w: number;
  h: number;
  top: number;
  bottom: number;
  current: number;
  left: number;
  right: number;
  x: number;
  pierW: number;
  pierH: number;
  B: readonly [number, number];
  A: readonly [number, number];
  boat: readonly number[];
  bow: readonly [number, number];
  heading: readonly [number, number];
  oar: readonly [number, number, number, number];
  labels: Record<string, readonly [number, number]>;
}): GeoFigure {
  const pw = o.pierW / 2;
  return {
    w: o.w,
    h: o.h,
    ariaLabel:
      'Река: берега, течение, причалы А и Б напротив друг друга, пункт В, лодка движется под углом α к течению',
    items: [
      seg([o.left, o.top], [o.right, o.top]),
      seg([o.left, o.bottom], [o.right, o.bottom]),
      ['arrow', o.left, o.current, o.right, o.current],
      poly(
        [o.x - pw, o.top - o.pierH],
        [o.x + pw, o.top - o.pierH],
        [o.x + pw, o.top],
        [o.x - pw, o.top],
      ),
      poly(
        [o.x - pw, o.bottom],
        [o.x + pw, o.bottom],
        [o.x + pw, o.bottom + o.pierH],
        [o.x - pw, o.bottom + o.pierH],
      ),
      seg([o.x, o.top], [o.x, o.A[1]], true),
      seg(o.A, o.B, true),
      ['dot', o.B[0], o.B[1]],
      ['arrow', o.bow[0], o.bow[1], o.heading[0], o.heading[1]],
      ['angle', o.bow[0], o.bow[1], o.heading[0], o.heading[1], o.right, o.current, 1],
      ['solid', o.boat],
      ['l', ...o.oar],
      ...Object.entries(o.labels).map(([t, [x, y]]) => ['t', x, y, t] as GeoItem),
    ],
  };
}

/** 2027 В9 = В10 №17 (task-17-river.png, 218×186). */
const V9_17 = river({
  w: 218,
  h: 186,
  top: 19.8,
  bottom: 165.8,
  current: 112.6,
  left: 2.6,
  right: 206,
  x: 21.1,
  pierW: 14,
  pierH: 9.9,
  B: [179.8, 19.8],
  A: [27.6, 155.4],
  bow: [55.3, 112.6],
  heading: [6.9, 59.5],
  boat: [55, 111, 66, 114, 90, 138, 84, 145, 56, 122],
  oar: [56, 148.6, 91.2, 117.1],
  labels: { Б: [7.9, 35], В: [192, 35], l: [97.8, 6.8], h: [14.5, 98], α: [65, 91], А: [9.6, 153] },
});

/** 2027 В21 = В22 №17 (task-17-river.png, 232×193). */
const V21_17 = river({
  w: 232,
  h: 193,
  top: 26.9,
  bottom: 174,
  current: 120.2,
  left: 7.2,
  right: 224.5,
  x: 38.5,
  pierW: 13.5,
  pierH: 10,
  B: [199.5, 26.9],
  A: [44.2, 167.3],
  bow: [71.2, 120.2],
  heading: [23.1, 64.9],
  boat: [70, 119, 80, 122, 102, 145, 96, 152, 72, 129],
  oar: [71.2, 158.7, 110.6, 125],
  labels: {
    Б: [29.8, 42.3],
    В: [207.7, 42.3],
    l: [116.8, 14.4],
    h: [29.8, 104.8],
    α: [80.8, 97],
    А: [25, 161],
  },
});

export const GEO_FIGURES = {
  'v1-1': V1_1,
  'v2-1': V2_1,
  'v3-1': V3_1,
  'v4-1': V4_1,
  'v5-1': V5_1,
  'v7-1': V7_1,
  'v9-1': V9_1,
  'v11-1': V11_1,
  'v13-1': V13_1,
  'v14-1': V14_1,
  'v15-1': V15_1,
  'v17-1': V17_1,
  'v18-1': V18_1,
  'v19-1': V19_1,
  'v21-1': V21_1,
  'v23-1': V23_1,
  'v24-1': V24_1,
  'v25-1': V25_1,
  'v1-3': V1_3,
  'v3-3': V3_3,
  'v4-3': V4_3,
  'v5-3': V5_3,
  'v7-3': V7_3,
  'v9-3': V9_3,
  'v10-3': V10_3,
  'v11-3': V11_3,
  'v12-3': V12_3,
  'v13-3': V13_3,
  'v16-3': V16_3,
  'v17-3': V17_3,
  'v19-3': V19_3,
  'v20-3': V20_3,
  'v21-3': V21_3,
  'v23-3': V23_3,
  'v24-3': V24_3,
  'v25-3': V25_3,
  'v9-17': V9_17,
  'v21-17': V21_17,
} as const satisfies Record<string, GeoFigure>;

export type GeoFigureId = keyof typeof GEO_FIGURES;
