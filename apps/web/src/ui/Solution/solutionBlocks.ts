/**
 * The structure of a written solution (docs/testing/solutions-display-audit.md).
 * Solutions are stored as paragraphs separated by a blank line; most start
 * with a label — «Что дано:», «Идея:», «Шаг 2.», «Шаг 3 (проверка).»,
 * «ОДЗ:», «Ответ:». Only labels that really occur in the content are
 * recognised. The label text is kept exactly as written (with its own
 * punctuation); nothing is added, removed or reworded — only how each
 * paragraph is laid out changes.
 */
export type SolutionBlockKind = 'given' | 'idea' | 'step' | 'answer' | 'note' | 'text';

export interface SolutionBlock {
  kind: SolutionBlockKind;
  /** The label exactly as written, punctuation included («Шаг 2.»); null for plain text. */
  label: string | null;
  /** The rest of the paragraph (inner line breaks kept). */
  body: string;
}

const QUALIFIER = String.raw`(?:\s*\([^()\n]{1,40}\))?`;
const LABELS: readonly [SolutionBlockKind, string][] = [
  ['step', String.raw`Шаг\s*\d+${QUALIFIER}`],
  ['answer', String.raw`Ответ${QUALIFIER}`],
  ['given', String.raw`Что дано|Дано`],
  ['idea', String.raw`Идея${QUALIFIER}`],
  ['note', String.raw`ОДЗ|Проверка|Примечание|Замечание|Итого|Итог|Пример|Как это получено`],
];

const LABEL_RE = new RegExp(
  String.raw`^(\*\*)?(` +
    LABELS.map(([, re]) => `(${re})`).join('|') +
    String.raw`)\s*([:.])(\*\*)?\s*`,
  'u',
);

export function parseSolution(text: string): SolutionBlock[] {
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((paragraph) => {
      const m = LABEL_RE.exec(paragraph);
      // «**Шаг 1.**» and «Шаг 1.» both count; a bold marker must close.
      if (!m || Boolean(m[1]) !== Boolean(m[m.length - 1])) {
        return { kind: 'text' as const, label: null, body: paragraph };
      }
      const groupIndex = m.slice(3, 3 + LABELS.length).findIndex((g) => g !== undefined);
      const kind = LABELS[groupIndex]![0];
      const body = paragraph.slice(m[0].length);
      if (!body.trim()) return { kind: 'text' as const, label: null, body: paragraph };
      return { kind, label: `${m[2]}${m[3 + LABELS.length]}`, body };
    });
}

/** Characters that make a space-free run a formula written in plain text. */
const FORMULA_SIGN = /[=<>≤≥≠≈→⇒⇔∈∉∪∩√±·×÷^²³⁴⁵⁶⁷⁸⁹⁰₀₁₂₃₄₅₆₇₈₉|∞π∠°′−+/]/u;
const WORD_JOINER = '\u2060';
/** Signs that only a formula has (a «/» or «-» also joins words: «м/с», «по-русски»). */
const STRONG_SIGN = /[=<>≤≥≠≈→⇒⇔∈∉∪∩√±·×÷^²³⁴⁵⁶⁷⁸⁹⁰₀₁₂₃₄₅₆₇₈₉|∞π∠°′]/u;

function isPlainFormula(run: string): boolean {
  if (run.length < 2 || run.length > 48 || !FORMULA_SIGN.test(run)) return false;
  // «существительным/количественным» is prose, not a formula.
  if (/[а-яё]{4,}/iu.test(run) && !STRONG_SIGN.test(run)) return false;
  return true;
}

/** Joins the characters of one run, never next to emphasis markers (`**`, `_`, `#`). */
function bind(run: string): string {
  const chars = [...run];
  let out = chars[0]!;
  for (let i = 1; i < chars.length; i++) {
    const marker = /[*_#]/.test(chars[i - 1]!) || /[*_#]/.test(chars[i]!);
    out += (marker ? '' : WORD_JOINER) + chars[i]!;
  }
  return out;
}

/**
 * A plain-text formula («(|x|−a²)²», «y=6√a−1») is one unit: the browser
 * would otherwise break it before «−» or after «-» mid-expression. Each
 * space-free run that holds a math sign gets a word joiner between its
 * characters — invisible, nothing else changes — so lines break at the
 * spaces around it. A run longer than the line still wraps (CSS
 * `overflow-wrap: anywhere`). LaTeX `$…$` is left alone.
 */
export function bindPlainFormulas(text: string): string {
  return text
    .split(/(\$\$[^$]+?\$\$|\$[^$]+?\$)/)
    .map((part, i) =>
      i % 2 === 1
        ? part
        : part.replace(/[^\s]+/gu, (run) => (isPlainFormula(run) ? bind(run) : run)),
    )
    .join('');
}
