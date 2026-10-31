/**
 * Server-side answer checking (docs/ARCHITECTURE.md §13 S2: "comma/dot,
 * spaces, ё/е, case, order-insensitive multi-digit answers"). Pure
 * functions, no I/O — the API is the only caller that matters, but
 * nothing here depends on it.
 *
 * This is intentionally simple: exact/normalized string match plus
 * numeric tolerance and order-insensitive multi-value answers. It is
 * NOT a full CAS/interval-set comparator — tasks whose answer needs
 * that (e.g. interval notation) should get a human-reviewed
 * `answerOptions`-based multiple-choice format instead until a richer
 * checker is built.
 */

import { parseBound } from './intervalAnswer.js';

/** Collapse whitespace, unify punctuation/letters that EGE graders treat as equivalent. */
export function normalizeAnswer(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\u2212/g, '-') // the typographic minus "−" (U+2212) is the same sign as "-"
    .replace(/\s+/g, ' ')
    .replace(/^- (?=\d)/, '-') // "- 0,5" → "-0,5"
    .replace(/,/g, '.');
}

/** A one-word answer ("да", "нет") typed as a sentence: "Да." / "Нет!" — the end mark is not part of it. */
function withoutEndMark(normalizedUser: string, normalizedCorrect: string): string {
  return /^[a-zа-я-]+$/.test(normalizedCorrect)
    ? normalizedUser.replace(/\s*[.!]+$/, '')
    : normalizedUser;
}

/** Splits a multi-value answer like "2; 5" or "2,5" or "2 5" into normalized tokens. */
function tokenize(normalized: string): readonly string[] {
  return normalized
    .split(/[\s;]+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .sort();
}

const SCIENTIFIC = /^([+-]?\d+(?:\.\d+)?)\s*[·*×x]\s*10\s*\^\s*\(?\s*([+−-]?\d+)\s*\)?$/;

/** "3.105·10^-21", "3.105*10^(-21)", "3.105×10^−21" → "3.105e-21"; anything else unchanged. */
function scientificToE(normalized: string): string {
  const match = SCIENTIFIC.exec(normalized);
  return match ? `${match[1]}e${match[2]!.replace('−', '-')}` : normalized;
}

/** Only for keys in scientific notation; compared relatively, as the values are tiny or huge. */
function scientificEquals(normalizedUser: string, normalizedCorrect: string): boolean {
  const key = scientificToE(normalizedCorrect);
  if (!/e[+-]?\d+$/.test(key)) return false;
  const user = Number(scientificToE(normalizedUser));
  const correct = Number(key);
  if (!Number.isFinite(user) || !Number.isFinite(correct) || correct === 0) return false;
  return Math.abs(user - correct) <= 1e-9 * Math.abs(correct);
}

/**
 * How a student may write a plain number key: a bracketed number «(-13)»,
 * and an integer in digit groups «2 062 500» (only whole groups of three,
 * so «2 5» — two answers — is never glued into 25).
 */
function plainNumberForm(normalizedUser: string, normalizedCorrect: string): string {
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(normalizedCorrect)) return normalizedUser;
  const bracketed = /^\(([+-]?\d+(?:\.\d+)?)\)$/.exec(normalizedUser);
  if (bracketed) return bracketed[1]!;
  if (/^[+-]?\d{1,3}(?: \d{3})+$/.test(normalizedUser)) return normalizedUser.replace(/ /g, '');
  return normalizedUser;
}

function numericEquals(a: string, b: string): boolean {
  if (a === '' || b === '') return false;
  const numA = Number(a);
  const numB = Number(b);
  if (Number.isNaN(numA) || Number.isNaN(numB)) return false;
  return Math.abs(numA - numB) < 1e-9;
}

/**
 * Only for answers keyed as exact expressions ("-11π/2; -5π",
 * "2√2163/103"): each token is read with the interval checker's fixed
 * bound grammar and the two lists are compared as multisets of numbers,
 * so "-5,5π; -5π" or "2√21/√103" are the same answer. Plain numeric keys
 * (part one) never reach this — their accepted forms stay as they were.
 */
function expressionTokensEqual(
  userTokens: readonly string[],
  correctTokens: readonly string[],
  normalizedCorrect: string,
): boolean {
  if (!/[π√/^]|pi|sqrt|arc|log/.test(normalizedCorrect)) return false;
  if (userTokens.length === 0 || userTokens.length !== correctTokens.length) return false;
  const read = (tokens: readonly string[]) => tokens.map((token) => parseBound(token));
  const user = read(userTokens);
  const correct = read(correctTokens);
  const finite = (values: (number | null)[]): values is number[] =>
    values.every((v) => v !== null && Number.isFinite(v));
  if (!finite(user) || !finite(correct)) return false;
  const byValue = (a: number, b: number) => a - b;
  const sortedCorrect = [...correct].sort(byValue);
  return [...user]
    .sort(byValue)
    .every(
      (value, i) => Math.abs(value - sortedCorrect[i]!) <= 1e-9 * Math.max(1, Math.abs(value)),
    );
}

const RATIO_KEY = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/;

/**
 * Only for keys written as a ratio "2:3": the student's "2 : 3", "4:6" or
 * "2/3" is the same ratio. The order is the key's, as the task asks for it.
 */
function ratioEquals(normalizedUser: string, normalizedCorrect: string): boolean {
  const key = RATIO_KEY.exec(normalizedCorrect);
  const user = /^(\d+(?:\.\d+)?)\s*[:/]\s*(\d+(?:\.\d+)?)$/.exec(normalizedUser);
  if (!key || !user || Number(key[2]) === 0 || Number(user[2]) === 0) return false;
  return Math.abs(Number(user[1]) / Number(user[2]) - Number(key[1]) / Number(key[2])) < 1e-9;
}

const DEGREE_SUFFIX = /\s*(?:°|градус(?:а|ов)?|град\.?)$/;
const ANGLE_EXPRESSION_KEY = /π|pi|arc/;

/**
 * Angles. A key written in degrees ("60°") also accepts the bare number
 * ("60", "60 градусов") and any exact radian form of the same angle
 * ("π/3", "arctg(√3)"). A key in radians ("π/6", "arccos(√5/5)") accepts
 * degrees only when they are marked as degrees ("30°") and equal exactly —
 * a bare number is never read as degrees there, so "30" stays wrong for π/6.
 */
function angleEquals(normalizedUser: string, normalizedCorrect: string): boolean {
  const close = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b));
  const userIsDegrees = DEGREE_SUFFIX.test(normalizedUser);
  const userValue = parseBound(normalizedUser.replace(DEGREE_SUFFIX, ''));
  if (userValue === null || !Number.isFinite(userValue)) return false;
  if (DEGREE_SUFFIX.test(normalizedCorrect)) {
    const keyDegrees = parseBound(normalizedCorrect.replace(DEGREE_SUFFIX, ''));
    if (keyDegrees === null || !Number.isFinite(keyDegrees)) return false;
    if (userIsDegrees || /^[+-]?\d+(?:\.\d+)?$/.test(normalizedUser)) {
      return close(userValue, keyDegrees);
    }
    // A radian expression ("π/3", "arctg(√3)") — a plain decimal like "1.05" is not one.
    return (
      ANGLE_EXPRESSION_KEY.test(normalizedUser) && close(userValue, (keyDegrees * Math.PI) / 180)
    );
  }
  if (!userIsDegrees) return false;
  // A part-one answer "в градусах": "127°" is the key "127" with its unit written out.
  if (/^[+-]?\d+(?:\.\d+)?$/.test(normalizedCorrect))
    return close(userValue, Number(normalizedCorrect));
  if (!ANGLE_EXPRESSION_KEY.test(normalizedCorrect)) return false;
  const keyRadians = parseBound(normalizedCorrect);
  return keyRadians !== null && close((userValue * Math.PI) / 180, keyRadians);
}

/** "(5;3), (6;2)" — a key that is a set of tuples (";" inside a tuple, as "," is the decimal comma). */
const TUPLE = /\(([^()]*)\)/g;
const TUPLE_SET_KEY = /^\(\s*[^();]+(?:;[^();]+)+\)(?:\s*[.;]?\s*\(\s*[^();]+(?:;[^();]+)+\))*$/;

function readTupleSet(normalized: string): number[][] | null {
  const tuples: number[][] = [];
  for (const match of normalized.matchAll(TUPLE)) {
    const values = match[1]!.split(';').map((part) => parseBound(part));
    if (values.length < 2 || values.some((v) => v === null || !Number.isFinite(v))) return null;
    tuples.push(values as number[]);
  }
  // Only separators may stand between the tuples: ",", ";", spaces (a "," is normalized to ".").
  if (normalized.replace(TUPLE, '').replace(/[\s.;]/g, '') !== '') return null;
  return tuples.length > 0 ? tuples : null;
}

/**
 * Only for keys that are a set of tuples ("(5;3), (6;2), (7;1)"): the same
 * tuples in any order, with any spacing and "," or ";" between them, are
 * the same answer. Each tuple's own order matters; a missing, extra or
 * repeated tuple does not match.
 */
function tupleSetEquals(normalizedUser: string, normalizedCorrect: string): boolean {
  if (!TUPLE_SET_KEY.test(normalizedCorrect)) return false;
  const key = readTupleSet(normalizedCorrect);
  const user = readTupleSet(normalizedUser);
  if (!key || !user || key.length !== user.length) return false;
  const close = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b));
  const remaining = [...key];
  for (const tuple of user) {
    const i = remaining.findIndex(
      (k) => k.length === tuple.length && k.every((value, j) => close(tuple[j]!, value)),
    );
    if (i < 0) return false;
    remaining.splice(i, 1);
  }
  return true;
}

/** True when every character of `normalized` is an ASCII digit 0-9 (and non-empty). */
function isDigitString(normalized: string): boolean {
  return normalized.length > 0 && /^[0-9]+$/.test(normalized);
}

export interface CheckAnswerOptions {
  /**
   * Opt-in, per-task flag — NOT a global default. Some multi-select EGE
   * tasks ask the student to "запишите номера ответов" where the
   * official key accepts any digit order (e.g. "125" and "521" are the
   * same selection); others (e.g. a multi-part answer position, or a
   * task whose own wording fixes an order) must NOT have their digits
   * reordered — "134" and "431" are different answers there. Callers
   * that know a specific task's answer is an order-free digit set pass
   * `digitSetOrderInsensitive: true` explicitly; the default (`false`
   * /omitted) preserves the exact existing behavior for every answer
   * format already in production (math included).
   */
  digitSetOrderInsensitive?: boolean;
}

/**
 * True when `userAnswer` matches `correctAnswer` after normalization —
 * exact string match, numeric match (so "6" === "6.0"), or, for
 * multi-value answers, the same set of tokens regardless of order.
 *
 * `options.digitSetOrderInsensitive` additionally allows a concatenated
 * digit string (no separators, e.g. "125") to match any permutation of
 * the same digits — scoped to this one call via the opt-in flag, never
 * applied by default. See `CheckAnswerOptions`.
 */
export function checkAnswer(
  userAnswer: string,
  correctAnswer: string,
  options?: CheckAnswerOptions,
): boolean {
  const normalizedCorrect = normalizeAnswer(correctAnswer);
  const normalizedUser = withoutEndMark(normalizeAnswer(userAnswer), normalizedCorrect);

  if (normalizedUser === normalizedCorrect) return true;
  if (tupleSetEquals(normalizedUser, normalizedCorrect)) return true;
  if (angleEquals(normalizedUser, normalizedCorrect)) return true;
  // A scientific key ("3.105e-21") is far below the absolute tolerance: compare it relatively only.
  if (/^[+-]?\d+(?:\.\d+)?e[+-]?\d+$/.test(normalizedCorrect))
    return scientificEquals(normalizedUser, normalizedCorrect);
  if (numericEquals(plainNumberForm(normalizedUser, normalizedCorrect), normalizedCorrect))
    return true;

  const userTokens = tokenize(normalizedUser);
  const correctTokens = tokenize(normalizedCorrect);
  if (
    userTokens.length > 1 &&
    userTokens.length === correctTokens.length &&
    userTokens.every((token, i) => {
      const correctToken = correctTokens[i]!;
      return token === correctToken || numericEquals(token, correctToken);
    })
  ) {
    return true;
  }

  if (expressionTokensEqual(userTokens, correctTokens, normalizedCorrect)) return true;
  // Expression roots may contain spaces ("arctg(1/2) - 3π; …"): read them split on ";" only.
  const bySemicolon = (normalized: string) =>
    normalized
      .split(';')
      .map((token) => token.replace(/\s+/g, ''))
      .filter(Boolean);
  if (
    expressionTokensEqual(
      bySemicolon(normalizedUser),
      bySemicolon(normalizedCorrect),
      normalizedCorrect,
    )
  )
    return true;
  if (ratioEquals(normalizedUser, normalizedCorrect)) return true;

  if (
    options?.digitSetOrderInsensitive &&
    isDigitString(normalizedUser) &&
    isDigitString(normalizedCorrect) &&
    normalizedUser.length === normalizedCorrect.length
  ) {
    return [...normalizedUser].sort().join('') === [...normalizedCorrect].sort().join('');
  }

  return false;
}
