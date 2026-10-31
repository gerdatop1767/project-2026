/**
 * Interval-set answers (S3.1): "x ∈ (−∞;3] ∪ (5;+∞)" style answers,
 * normalized into a structured representation before comparison so
 * that equivalent notations ("," vs ";" separators, "U" vs "∪", ASCII
 * "inf" vs "∞", extra whitespace, reordered union terms) are treated
 * as the same answer. Deterministic, no `eval`, no arbitrary code
 * execution — an unparseable string yields `null` (INVALID_ANSWER_FORMAT)
 * rather than throwing.
 */

export interface Interval {
  left: number; // -Infinity allowed
  leftClosed: boolean;
  right: number; // +Infinity allowed
  rightClosed: boolean;
}

const EPSILON = 1e-9;

/**
 * Parses a single bound expression into a finite/infinite number.
 * Supports: integers/decimals (comma or dot), unary minus, simple
 * `a/b` fractions, `π`/`pi`, `√n`/`sqrt(n)`, `log_b(x)`/`log_b x`, and
 * `±∞`/`±inf`/`±infinity`. Returns `null` if the token isn't a
 * recognized numeric expression — never evaluates arbitrary code.
 */
export function parseBound(raw: string): number | null {
  const token = raw
    .trim()
    .toLowerCase()
    .replace(/−/g, '-') // U+2212 minus sign, common in typeset math, vs ASCII hyphen
    .replace(/,/g, '.')
    .replace(/\s+/g, '')
    // An explicit product sign before a factor is the implied one: "5*√39" = "5√39".
    .replace(/(\d)[*·×](?=[√π(]|pi|sqrt)/g, '$1');
  if (token === '') return null;

  const infinityMatch = /^([+-]?)(infinity|inf|∞)$/.exec(token);
  if (infinityMatch) {
    return infinityMatch[1] === '-' ? -Infinity : Infinity;
  }

  return parseSignedExpression(token);
}

function parseSignedExpression(token: string): number | null {
  const sum = parseTopLevelSum(token);
  if (sum !== undefined) return sum;
  if (token.startsWith('-')) {
    const inner = parseSignedExpression(token.slice(1));
    return inner === null ? null : -inner;
  }
  if (token.startsWith('+')) {
    return parseSignedExpression(token.slice(1));
  }
  return parseUnsignedExpression(token);
}

/**
 * "arctg(1/2)-3π", "-3π+arctg(1/2)": two terms joined by a "+"/"-" outside
 * any bracket (not a leading sign) — each term read by the same fixed
 * grammar. `undefined` when there is no such split, `null` when there is
 * one but a term is not readable.
 */
function parseTopLevelSum(token: string): number | null | undefined {
  let depth = 0;
  let at = -1;
  for (let i = 0; i < token.length; i++) {
    const char = token[i]!;
    if (char === '(') depth++;
    else if (char === ')') depth--;
    else if (i > 0 && depth === 0 && (char === '+' || char === '-')) at = i;
  }
  if (at < 0) return undefined;
  const first = parseSignedExpression(token.slice(0, at));
  const second = parseUnsignedExpression(token.slice(at + 1));
  if (first === null || second === null) return null;
  return token[at] === '+' ? first + second : first - second;
}

const INVERSE_TRIG: Record<string, (x: number) => number> = {
  arctg: Math.atan,
  arctan: Math.atan,
  arcsin: Math.asin,
  arccos: Math.acos,
};

/** True when the "(" at `open` is closed by the token's last character. */
function closesAtEnd(open: number, token: string): boolean {
  let depth = 0;
  for (let i = open; i < token.length; i++) {
    if (token[i] === '(') depth++;
    else if (token[i] === ')' && --depth === 0) return i === token.length - 1;
  }
  return false;
}

function parseUnsignedExpression(token: string): number | null {
  // A readable expression to a small natural power: "(log_5 34)^2", "log_5(34)^2".
  const power = /^(.+)\^(\d)$/.exec(token);
  if (power) {
    const raw = power[1]!;
    const inner = raw.startsWith('(') && raw.endsWith(')') ? raw.slice(1, -1) : raw;
    const base = parseSignedExpression(inner);
    return base === null ? null : base ** Number(power[2]);
  }

  // arctg(1/2), arcsin(√3/2), arccos 0.6 — an inverse trig function of a
  // number the grammar already reads.
  const inverse = /^(arctg|arctan|arcsin|arccos)\(?([^()]+)\)?$/.exec(token);
  if (inverse) {
    const argument = parseSignedExpression(inverse[2]!);
    if (argument === null) return null;
    const value = INVERSE_TRIG[inverse[1]!]!(argument);
    return Number.isNaN(value) ? null : value;
  }

  // Plain decimal, e.g. "5.4" or "3"
  if (/^\d+(\.\d+)?$/.test(token)) {
    return Number(token);
  }

  // Simple fraction "a/b"
  const fraction = /^(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/.exec(token);
  if (fraction) {
    const numerator = Number(fraction[1]);
    const denominator = Number(fraction[2]);
    if (denominator === 0) return null;
    return numerator / denominator;
  }

  if (token === 'pi' || token === 'π') return Math.PI;
  if (token === 'e') return Math.E;

  // A coefficient times the root of a readable expression: "3√(4-2√2)", "√(36-18√2)".
  const nestedRoot = /^(\d+(?:\.\d+)?)?(?:√|sqrt)\((.+)\)$/.exec(token);
  if (nestedRoot && closesAtEnd(token.indexOf('('), token)) {
    const radicand = parseSignedExpression(nestedRoot[2]!);
    if (radicand === null || radicand < 0) return null;
    return Number(nestedRoot[1] ?? 1) * Math.sqrt(radicand);
  }

  // √n or sqrt(n) or sqrt n
  const sqrtMatch = /^(?:√|sqrt)\(?(\d+(?:\.\d+)?)\)?$/.exec(token);
  if (sqrtMatch) {
    const value = Number(sqrtMatch[1]);
    return value < 0 ? null : Math.sqrt(value);
  }

  // A product/quotient of one coefficient, one π or √n and one divisor —
  // "11π/2", "5π", "π/2", "2√2", "-2√2" (sign handled above), "√3/9",
  // "2√21/√103". Still a fixed grammar, never an evaluator.
  const product =
    /^(\d+(?:\.\d+)?)?(π|pi|(?:√|sqrt)\(?(\d+(?:\.\d+)?)\)?)?(?:\/(?:(\d+(?:\.\d+)?)|(?:√|sqrt)\(?(\d+(?:\.\d+)?)\)?))?$/.exec(
      token,
    );
  if (product && (product[1] !== undefined || product[2] !== undefined)) {
    const [, coefficient, factor, radicand, divisor, divisorRadicand] = product;
    let value = coefficient === undefined ? 1 : Number(coefficient);
    if (factor !== undefined)
      value *= radicand === undefined ? Math.PI : Math.sqrt(Number(radicand));
    const denominator =
      divisor !== undefined
        ? Number(divisor)
        : divisorRadicand !== undefined
          ? Math.sqrt(Number(divisorRadicand))
          : 1;
    if (denominator === 0) return null;
    return value / denominator;
  }

  // A bracketed sum or difference of two such terms over an optional
  // divisor — "(18+4√69)/65", "(3-√5)/2". Same fixed grammar per term.
  const grouped = /^\(([^()]+)\)(?:\/(\d+(?:\.\d+)?))?$/.exec(token);
  if (grouped) {
    const inner = grouped[1]!;
    const divisor = grouped[2] === undefined ? 1 : Number(grouped[2]);
    if (divisor === 0) return null;
    const at = inner.slice(1).search(/[+-]/) + 1;
    if (at <= 0) {
      // A single bracketed term: "(5√39)/3" reads as "5√39/3".
      const term = parseSignedExpression(inner);
      return term === null ? null : term / divisor;
    }
    const first = parseSignedExpression(inner.slice(0, at));
    const second = parseUnsignedExpression(inner.slice(at + 1));
    if (first === null || second === null) return null;
    return (inner[at] === '+' ? first + second : first - second) / divisor;
  }

  // log_b(x) or log_b x, base and argument each a plain positive number
  const logMatch = /^log_?(\d+(?:\.\d+)?)\(?(\d+(?:\.\d+)?)\)?$/.exec(token);
  if (logMatch) {
    const base = Number(logMatch[1]);
    const arg = Number(logMatch[2]);
    if (base <= 0 || base === 1 || arg <= 0) return null;
    return Math.log(arg) / Math.log(base);
  }

  // A logarithm or inverse trig function over a divisor the grammar reads:
  // "log_2(5)/5", "(log_2 25)/10", "arccos(0.6)/(6π)". Split on the last "/" outside brackets.
  if (/^\(?(?:log|arc)/.test(token)) {
    let depth = 0;
    let at = -1;
    for (let i = 0; i < token.length; i++) {
      const char = token[i]!;
      if (char === '(') depth++;
      else if (char === ')') depth--;
      else if (char === '/' && depth === 0) at = i;
    }
    if (at > 0) {
      const unwrap = (part: string) =>
        part.startsWith('(') && closesAtEnd(0, part) ? part.slice(1, -1) : part;
      const numerator = parseUnsignedExpression(unwrap(token.slice(0, at)));
      const divisor = parseUnsignedExpression(unwrap(token.slice(at + 1)));
      if (numerator === null || divisor === null || divisor === 0) return null;
      return numerator / divisor;
    }
  }

  return null;
}

const OPEN_BRACKETS = new Set(['(', '[']);
const CLOSE_BRACKETS = new Set([')', ']']);

/**
 * Splits the interval's inner content ("a;b" or "a,b", where `a`/`b`
 * may themselves contain parens, e.g. "log_5(2)") on the first
 * top-level separator — one not nested inside a bound's own
 * parentheses — rather than a naive regex that would misfire on
 * nested brackets.
 */
function findTopLevelIndex(inner: string, separator: string): number {
  let depth = 0;
  for (let i = 0; i < inner.length; i++) {
    const char = inner[i]!;
    if (OPEN_BRACKETS.has(char)) depth++;
    else if (CLOSE_BRACKETS.has(char)) depth--;
    else if (depth === 0 && char === separator) return i;
  }
  return -1;
}

/**
 * ';' is preferred (unambiguous with a decimal comma inside a bound,
 * e.g. a fraction written "1,5"); ',' is only used as the separator
 * when no ';' is present at all, matching the "(-∞,3]" notation some
 * sources use instead of "(-∞;3]".
 */
function splitAtTopLevelSeparator(inner: string): [string, string] | null {
  const semicolonAt = findTopLevelIndex(inner, ';');
  if (semicolonAt >= 0) return [inner.slice(0, semicolonAt), inner.slice(semicolonAt + 1)];
  const commaAt = findTopLevelIndex(inner, ',');
  if (commaAt >= 0) return [inner.slice(0, commaAt), inner.slice(commaAt + 1)];
  return null;
}

function parseSingleInterval(segment: string): Interval | null {
  const trimmed = segment.trim();
  if (trimmed.length < 3) return null;

  const leftBracket = trimmed[0]!;
  const rightBracket = trimmed[trimmed.length - 1]!;
  if (!OPEN_BRACKETS.has(leftBracket) || !CLOSE_BRACKETS.has(rightBracket)) return null;

  const inner = trimmed.slice(1, -1);
  const parts = splitAtTopLevelSeparator(inner);
  if (!parts) return null;
  const [leftRaw, rightRaw] = parts;

  const left = parseBound(leftRaw);
  const right = parseBound(rightRaw);
  if (left === null || right === null) return null;
  if (left > right) return null;
  // A closed bound at an infinite endpoint isn't a valid interval notation.
  if (!Number.isFinite(left) && leftBracket === '[') return null;
  if (!Number.isFinite(right) && rightBracket === ']') return null;

  return {
    left,
    leftClosed: leftBracket === '[',
    right,
    rightClosed: rightBracket === ']',
  };
}

/**
 * Splits on the separators that may stand between the items of a set
 * answer: "∪"/"U", and a top-level ";" (one outside every bracket, so
 * the ";" inside "(a;b)" or "{a;b}" is never a split point).
 */
function splitItems(raw: string): string[] {
  const items: string[] = [];
  for (const piece of raw.split(/∪|\bU\b/i)) {
    let depth = 0;
    let start = 0;
    for (let i = 0; i < piece.length; i++) {
      const char = piece[i]!;
      if (OPEN_BRACKETS.has(char) || char === '{') depth++;
      else if (CLOSE_BRACKETS.has(char) || char === '}') depth--;
      else if (depth === 0 && char === ';') {
        items.push(piece.slice(start, i));
        start = i + 1;
      }
    }
    items.push(piece.slice(start));
  }
  return items.map((s) => s.trim()).filter(Boolean);
}

/** "{a}" / "{a; b}" or a bare finite number: isolated points. */
function parsePoints(segment: string): Interval[] | null {
  const inner = segment.startsWith('{') && segment.endsWith('}') ? segment.slice(1, -1) : segment;
  const points: Interval[] = [];
  for (const raw of inner.split(';')) {
    const value = parseBound(raw);
    if (value === null || !Number.isFinite(value)) return null;
    points.push({ left: value, leftClosed: true, right: value, rightClosed: true });
  }
  return points;
}

/**
 * Sorted, with touching/overlapping pieces merged, so that equal sets
 * written differently compare equal: "{1} ∪ (1;2]" is "[1;2]", and
 * "[0;1] ∪ [1;3)" is "[0;3)". (1;2) ∪ (2;3) stays two pieces.
 */
function mergeIntervals(intervals: readonly Interval[]): Interval[] {
  const sorted = [...intervals].sort(
    (a, b) => a.left - b.left || Number(b.leftClosed) - Number(a.leftClosed),
  );
  const merged: Interval[] = [];
  for (const next of sorted) {
    const last = merged[merged.length - 1];
    const touches =
      last !== undefined &&
      (next.left < last.right ||
        (boundsEqual(next.left, last.right) && (last.rightClosed || next.leftClosed)));
    if (!last || !touches) {
      merged.push({ ...next });
      continue;
    }
    if (boundsEqual(next.left, last.left)) last.leftClosed = last.leftClosed || next.leftClosed;
    if (next.right > last.right && !boundsEqual(next.right, last.right)) {
      last.right = next.right;
      last.rightClosed = next.rightClosed;
    } else if (boundsEqual(next.right, last.right)) {
      last.rightClosed = last.rightClosed || next.rightClosed;
    }
  }
  return merged;
}

/**
 * Parses a full interval-set answer such as "(−∞;3] ∪ (5;+∞)" into a
 * sorted list of intervals, or `null` if any segment is malformed
 * (INVALID_ANSWER_FORMAT) — the caller treats `null` as simply
 * "incorrect", never as a server error. Isolated points may be written
 * "{−50}" (or as a bare number), a leading "x ∈" / "a ∈" is ignored,
 * and items may be joined by "∪" or a top-level ";".
 */
export function parseIntervalSet(raw: string): readonly Interval[] | null {
  const normalized = raw.trim().replace(/^[a-zа-я]\s*∈\s*/i, '');
  if (normalized === '') return null;

  const segments = splitItems(normalized);
  if (segments.length === 0) return null;

  const intervals: Interval[] = [];
  for (const segment of segments) {
    const interval = parseSingleInterval(segment);
    if (interval) {
      intervals.push(interval);
      continue;
    }
    const points = parsePoints(segment);
    if (!points) return null;
    intervals.push(...points);
  }

  return mergeIntervals(intervals);
}

function boundsEqual(a: number, b: number): boolean {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return a === b;
  return Math.abs(a - b) < EPSILON;
}

/** Structural equality of two interval sets — order-independent (both are pre-sorted by parseIntervalSet). */
export function intervalSetsEqual(a: readonly Interval[], b: readonly Interval[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((intervalA, i) => {
    const intervalB = b[i]!;
    return (
      boundsEqual(intervalA.left, intervalB.left) &&
      intervalA.leftClosed === intervalB.leftClosed &&
      boundsEqual(intervalA.right, intervalB.right) &&
      intervalA.rightClosed === intervalB.rightClosed
    );
  });
}

/**
 * True when `userAnswer` denotes the same interval set as
 * `correctAnswer`. An unparseable user answer is simply "incorrect",
 * never a thrown error.
 */
export function checkIntervalAnswer(userAnswer: string, correctAnswer: string): boolean {
  const userSet = parseIntervalSet(userAnswer);
  if (userSet === null) return false;
  const correctSet = parseIntervalSet(correctAnswer);
  if (correctSet === null) return false;
  return intervalSetsEqual(userSet, correctSet);
}
