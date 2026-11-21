import type { BankTask, Difficulty } from './types.js';

/**
 * «Where do the commas go» tasks (17–20). The author writes the sentence
 * with markers: `[,код]` — a comma is needed here, `[код]` — a tempting
 * place without a comma. Markers are numbered (1), (2)… in order; the
 * answer, the corrected sentence and the explanation of every position
 * are computed from the markers and the number's rule codes.
 */
export interface PositionsSpec {
  readonly taskNumber: number;
  readonly intro: string;
  /**
   * Every rule says whether it puts a comma (`comma: true`) or explains a
   * tempting place without one; the markup must agree with it.
   */
  readonly rules: Readonly<
    Record<string, { readonly text: string; readonly hard: boolean; readonly comma: boolean }>
  >;
  readonly tip: (codes: ReadonlySet<string>) => string;
  readonly hint: string;
  readonly kindOf: (codes: ReadonlySet<string>) => string;
}

const MARK = /\[(,?)([a-zA-Z0-9]+)\]/g;

export interface Position {
  readonly comma: boolean;
  readonly code: string;
}

export function parsePositions(text: string): {
  shown: string;
  corrected: string;
  positions: Position[];
} {
  const positions: Position[] = [];
  let k = 0;
  const shown = text.replace(MARK, (_, c: string, code: string) => {
    positions.push({ comma: c === ',', code });
    return ` (${++k})`;
  });
  const corrected = text.replace(MARK, (_, c: string) => (c === ',' ? ',' : ''));
  return { shown, corrected, positions };
}

/** The words on both sides of each marker, for the explanation. */
function around(text: string): [string, string][] {
  const out: [string, string][] = [];
  for (const m of text.matchAll(MARK)) {
    const before =
      text
        .slice(0, m.index)
        .replace(MARK, '')
        .match(/[А-Яа-яЁё0-9-]+/g) ?? [];
    const after =
      text
        .slice(m.index + m[0].length)
        .replace(MARK, '')
        .match(/[А-Яа-яЁё0-9-]+/g) ?? [];
    out.push([before[before.length - 1] ?? '', after[0] ?? '']);
  }
  return out;
}

export function buildPositionsTask(
  spec: PositionsSpec,
  n: number,
  text: string,
  difficulty: Difficulty,
): BankTask {
  const { shown, corrected, positions } = parsePositions(text);
  const digits = positions.map((p, i) => (p.comma ? String(i + 1) : '')).join('');
  const codes = new Set(positions.map((p) => p.code));
  const words = around(text);
  return {
    taskNumber: spec.taskNumber,
    n,
    difficulty,
    kind: spec.kindOf(codes),
    conditionMd: [
      'Укажите цифру(-ы), на месте которой(-ых) должна(-ы) стоять запятая(-ые).',
      shown,
    ].join('\n\n'),
    answer: { type: 'digits', digits },
    explanationMd: [
      spec.intro,
      `Расставим знаки: «${corrected}»`,
      ...positions.map((p, i) => {
        const [a, b] = words[i]!;
        const rule = spec.rules[p.code]!.text;
        return `(${i + 1}) Между «${a}» и «${b}» — ${p.comma ? '**запятая нужна**' : 'запятой нет'}. ${rule[0]!.toUpperCase()}${rule.slice(1)}.`;
      }),
      `**Обрати внимание.** ${spec.tip(codes)}`,
      `Ответ: ${digits}.`,
    ].join('\n\n'),
    hintMd: spec.hint,
  };
}

/** Difficulty by real traps: share of hard positions, then length; 30 / 40 / 30. */
export function rankDifficulty(spec: PositionsSpec, texts: readonly string[]): Difficulty[] {
  const scores = texts.map((t, i) => {
    const { positions } = parsePositions(t);
    const hard = positions.filter((p) => spec.rules[p.code]!.hard).length;
    return { i, s: hard + positions.length * 0.1 + i * 1e-4 };
  });
  const order = [...scores].sort((a, b) => a.s - b.s);
  const out: Difficulty[] = new Array(texts.length);
  const n = texts.length;
  order.forEach((o, rank) => (out[o.i] = rank < n * 0.3 ? 1 : rank < n * 0.7 ? 2 : 3));
  return out;
}

/** Exam-level limits for 17–20 (docs/imports/zybrilka-russian-17-20-analysis.md). */
export const EXAM_POSITIONS = {
  min: 4,
  max: 8,
  trapShare: [0.4, 0.5],
  singleDigitMax: 10,
} as const;

export function validatePositions(spec: PositionsSpec, texts: readonly string[]): string[] {
  const p: string[] = [];
  const seen = new Map<string, number>();
  let all = 0;
  let traps = 0;
  let single = 0;
  texts.forEach((t, i) => {
    const { positions, corrected } = parsePositions(t);
    const where = `№${spec.taskNumber}.${i + 1}`;
    if (positions.length < EXAM_POSITIONS.min || positions.length > EXAM_POSITIONS.max)
      p.push(`${where}: ${positions.length} positions`);
    const commas = positions.filter((x) => x.comma).length;
    if (commas === 0) p.push(`${where}: no position takes a comma`);
    if (commas === positions.length) p.push(`${where}: no trap`);
    if (commas === 1) single++;
    all += positions.length;
    traps += positions.length - commas;
    positions.forEach((x, k) => {
      const rule = spec.rules[x.code];
      if (!rule) p.push(`${where} (${k + 1}): unknown code ${x.code}`);
      else if (rule.comma !== x.comma)
        p.push(`${where} (${k + 1}): «${x.code}» ${rule.comma ? 'needs' : 'excludes'} a comma`);
    });
    if (t.replace(MARK, '').includes(','))
      p.push(`${where}: a comma outside the numbered positions`);
    if (/\s,|,,|,\s*[.!?;:]|^\s|\s$|\s{2}/.test(corrected))
      p.push(`${where}: broken punctuation after placing commas`);
    if (/\(\d\)/.test(t)) p.push(`${where}: write markers, not numbers`);
    const key = corrected.toLowerCase().replace(/[^а-яё]/g, '');
    if (seen.has(key)) p.push(`${where}: repeats ${spec.taskNumber}.${seen.get(key)}`);
    seen.set(key, i + 1);
  });
  if (texts.length === 100) {
    const share = traps / all;
    if (share < EXAM_POSITIONS.trapShare[0] || share > EXAM_POSITIONS.trapShare[1])
      p.push(`№${spec.taskNumber}: traps are ${(share * 100).toFixed(1)}% of positions`);
    if (single > EXAM_POSITIONS.singleDigitMax)
      p.push(`№${spec.taskNumber}: ${single} one-digit answers`);
  }
  return p;
}
