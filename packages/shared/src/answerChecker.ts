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
  return raw.trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').replace(/,/g, '.');
}

/** Splits a multi-value answer like "2; 5" or "2,5" or "2 5" into normalized tokens. */
function tokenize(normalized: string): readonly string[] {
  return normalized
    .split(/[\s;]+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .sort();
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
  if (!/[π√/]|pi|sqrt|arc/.test(normalizedCorrect)) return false;
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
  const normalizedUser = normalizeAnswer(userAnswer);
  const normalizedCorrect = normalizeAnswer(correctAnswer);

  if (normalizedUser === normalizedCorrect) return true;
  if (numericEquals(normalizedUser, normalizedCorrect)) return true;

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
