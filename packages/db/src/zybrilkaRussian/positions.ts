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
  readonly rules: Readonly<Record<string, { readonly text: string; readonly hard: boolean }>>;
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

export function buildPositionsTask(
  spec: PositionsSpec,
  n: number,
  text: string,
  difficulty: Difficulty,
): BankTask {
  const { shown, corrected, positions } = parsePositions(text);
  const digits = positions.map((p, i) => (p.comma ? String(i + 1) : '')).join('');
  const codes = new Set(positions.map((p) => p.code));
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
      ...positions.map(
        (p, i) =>
          `(${i + 1}) ${p.comma ? 'запятая нужна' : 'запятая не нужна'}: ${spec.rules[p.code]!.text}.`,
      ),
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

export function validatePositions(spec: PositionsSpec, texts: readonly string[]): string[] {
  const p: string[] = [];
  texts.forEach((t, i) => {
    const { positions } = parsePositions(t);
    const where = `№${spec.taskNumber} sentence ${i + 1}`;
    if (positions.length < 2) p.push(`${where}: fewer than 2 positions`);
    if (!positions.some((x) => x.comma)) p.push(`${where}: no position takes a comma`);
    for (const x of positions) if (!spec.rules[x.code]) p.push(`${where}: unknown code ${x.code}`);
    if (/\s,|,,/.test(parsePositions(t).corrected))
      p.push(`${where}: broken punctuation after placing commas`);
  });
  return p;
}
