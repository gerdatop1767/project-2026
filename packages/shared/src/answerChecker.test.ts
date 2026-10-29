import { describe, expect, it } from 'vitest';
import { checkAnswer, normalizeAnswer } from './answerChecker.js';

describe('normalizeAnswer', () => {
  it('trims, lowercases, and collapses whitespace', () => {
    expect(normalizeAnswer('  Ответ  ')).toBe('ответ');
    expect(normalizeAnswer('a   b')).toBe('a b');
  });

  it('treats ё and е as equivalent', () => {
    expect(normalizeAnswer('трёх')).toBe(normalizeAnswer('трех'));
  });

  it('treats comma and dot as equivalent decimal separators', () => {
    expect(normalizeAnswer('0,4')).toBe(normalizeAnswer('0.4'));
  });
});

describe('checkAnswer', () => {
  it('accepts an exact match', () => {
    expect(checkAnswer('4', '4')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(checkAnswer('ДА', 'да')).toBe(true);
  });

  it('accepts a decimal comma against a decimal dot', () => {
    expect(checkAnswer('0,4', '0.4')).toBe(true);
  });

  it('treats numerically-equal values as equal regardless of formatting', () => {
    expect(checkAnswer('6.0', '6')).toBe(true);
    expect(checkAnswer('6', '6.00')).toBe(true);
  });

  it('is order-insensitive for multi-value answers', () => {
    expect(checkAnswer('5 2', '2 5')).toBe(true);
    expect(checkAnswer('2, 5', '5; 2')).toBe(true);
  });

  it('rejects a wrong multi-value answer', () => {
    expect(checkAnswer('2 3', '2 5')).toBe(false);
  });

  it('rejects a genuinely wrong answer', () => {
    expect(checkAnswer('5', '4')).toBe(false);
  });

  it('rejects an empty answer against a real one', () => {
    expect(checkAnswer('', '4')).toBe(false);
  });

  it('does not treat a numeric string as equal to a non-numeric one', () => {
    expect(checkAnswer('да', '4')).toBe(false);
  });

  it('by default treats a concatenated digit string as order-sensitive (not a set)', () => {
    // "134" vs "431" must NOT match unless the caller explicitly opts in —
    // this is the default used everywhere today, math included.
    expect(checkAnswer('134', '431')).toBe(false);
    expect(checkAnswer('431', '134')).toBe(false);
  });

  it('still matches an exact concatenated digit answer by default', () => {
    expect(checkAnswer('234', '234')).toBe(true);
  });

  it('digitSetOrderInsensitive: true accepts any permutation of the same digits', () => {
    expect(checkAnswer('134', '431', { digitSetOrderInsensitive: true })).toBe(true);
    expect(checkAnswer('521', '125', { digitSetOrderInsensitive: true })).toBe(true);
  });

  it('digitSetOrderInsensitive: true still rejects a different digit set', () => {
    expect(checkAnswer('135', '431', { digitSetOrderInsensitive: true })).toBe(false);
    // different length — not the same set, never treated as equal
    expect(checkAnswer('13', '431', { digitSetOrderInsensitive: true })).toBe(false);
  });

  it('digitSetOrderInsensitive: true does not affect non-digit or space-separated answers', () => {
    expect(checkAnswer('действительной', 'действенной', { digitSetOrderInsensitive: true })).toBe(
      false,
    );
    // space-separated multi-value answers keep using the existing token path
    expect(checkAnswer('5 2', '2 5', { digitSetOrderInsensitive: true })).toBe(true);
  });

  it('accepts answers with extra surrounding/internal whitespace (Russian short answers)', () => {
    expect(checkAnswer('  заглавных ', 'заглавных')).toBe(true);
    expect(checkAnswer('234', ' 234 ')).toBe(true);
  });

  describe('digitSetOrderInsensitive edge cases (EGE "Запишите номера ответов" format)', () => {
    it('"35" and "53" are the same selection (reordered digits)', () => {
      expect(checkAnswer('35', '53', { digitSetOrderInsensitive: true })).toBe(true);
    });

    it('"35" and "34" are NOT the same selection (different digit, same length)', () => {
      expect(checkAnswer('35', '34', { digitSetOrderInsensitive: true })).toBe(false);
    });

    it('never matches answers of different length, even as a superset/subset ("35" vs "355")', () => {
      expect(checkAnswer('35', '355', { digitSetOrderInsensitive: true })).toBe(false);
      expect(checkAnswer('355', '35', { digitSetOrderInsensitive: true })).toBe(false);
    });

    it('treats the answer as a multiset, not a set — repeated digits must repeat the same number of times', () => {
      // "223" and "232" are the same multiset {2,2,3} in different order — equal.
      expect(checkAnswer('232', '223', { digitSetOrderInsensitive: true })).toBe(true);
      // "223" and "233" are different multisets ({2,2,3} vs {2,3,3}) — NOT equal,
      // even though both are length 3 and share two of three digits.
      expect(checkAnswer('223', '233', { digitSetOrderInsensitive: true })).toBe(false);
    });

    it('a space-separated answer does not fall into the digit-set path (format mismatch, not a match)', () => {
      // "3 5" is tokenized as two separate tokens, not a single 2-digit string —
      // it is compared via the existing token-order-insensitive path (already
      // order-insensitive on its own), never via digitSetOrderInsensitive.
      expect(checkAnswer('3 5', '35', { digitSetOrderInsensitive: true })).toBe(false);
      expect(checkAnswer('3 5', '5 3', { digitSetOrderInsensitive: true })).toBe(true);
    });
  });
});

describe('checkAnswer — exact-expression keys (EGE-2027 part two)', () => {
  it('accepts equal roots in any order and any equivalent form', () => {
    expect(checkAnswer('-5π; -11π/2', '-11π/2; -5π')).toBe(true);
    expect(checkAnswer('-5,5π; -5π', '-11π/2; -5π')).toBe(true);
    expect(checkAnswer('-11π/2; -4π', '-11π/2; -5π')).toBe(false);
    expect(checkAnswer('-11π/2', '-11π/2; -5π')).toBe(false);
  });

  it('accepts a radical in either written form', () => {
    expect(checkAnswer('2√21/√103', '2√2163/103')).toBe(true);
    expect(checkAnswer('0.903', '2√2163/103')).toBe(false);
  });

  it('leaves plain numeric keys exactly as before', () => {
    expect(checkAnswer('1/8', '0.125')).toBe(false);
    expect(checkAnswer('0,125', '0.125')).toBe(true);
  });

  it('compares a ratio key as a ratio, in the order the key gives', () => {
    expect(checkAnswer('2:3', '2:3')).toBe(true);
    expect(checkAnswer('2 : 3', '2:3')).toBe(true);
    expect(checkAnswer('4:6', '2:3')).toBe(true);
    expect(checkAnswer('2/3', '2:3')).toBe(true);
    expect(checkAnswer('3:2', '2:3')).toBe(false);
    expect(checkAnswer('0,67', '2:3')).toBe(false);
    // Non-ratio keys never read a user's "a:b".
    expect(checkAnswer('4:6', '0.6666')).toBe(false);
  });

  it('reads (p ± q√r)/d roots in an expression key', () => {
    expect(checkAnswer('(3+√5)/2; 1', '1; (3+√5)/2')).toBe(true);
    expect(checkAnswer('2,618; 1', '1; (3+√5)/2')).toBe(false);
  });
});
