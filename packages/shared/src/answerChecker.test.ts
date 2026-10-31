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

  it('reads inverse-trig roots with a π shift, with or without spaces', () => {
    const key = 'arctg(1/2)-3π; arctg(11/2)-3π';
    expect(checkAnswer(key, key)).toBe(true);
    expect(checkAnswer('arctg(11/2) - 3π; arctg 0,5 - 3π', key)).toBe(true);
    expect(checkAnswer('-3π+arctg(0,5); -3π+arctan(5,5)', key)).toBe(true);
    expect(checkAnswer('arctg(1/2)-3π', key)).toBe(false);
    expect(checkAnswer('arctg(1/2)-2π; arctg(11/2)-3π', key)).toBe(false);
  });
});

describe('checkAnswer — scientific notation keys', () => {
  it('accepts the usual ways to write a·10^n and compares relatively', () => {
    const key = '3.105e-21';
    for (const answer of [
      '3,105·10^-21',
      '3,105*10^(-21)',
      '3.105×10^−21',
      '3,105e-21',
      '31,05·10^(-22)',
    ])
      expect(checkAnswer(answer, key)).toBe(true);
    expect(checkAnswer('3,1·10^-21', key)).toBe(false);
    expect(checkAnswer('3,105·10^-20', key)).toBe(false);
    expect(checkAnswer('0', key)).toBe(false);
  });

  it('leaves ordinary numeric keys as they were', () => {
    expect(checkAnswer('2·10^2', '200')).toBe(false);
    expect(checkAnswer('1e-12', '0')).toBe(true);
  });
});

describe('checkAnswer — angles in degrees and radians', () => {
  it('a degree key accepts the bare number, the unit and exact radian forms', () => {
    for (const answer of ['60', '60°', '60 °', '60 градусов', 'π/3', 'arctg(√3)', 'arccos(1/2)']) {
      expect(checkAnswer(answer, '60°'), answer).toBe(true);
    }
  });

  it('a degree key rejects other angles and approximate radians', () => {
    for (const answer of ['61', '30°', 'π/6', 'π/3+0.001', '1.0472', 'arctg(3)', '60 минут']) {
      expect(checkAnswer(answer, '60°'), answer).toBe(false);
    }
  });

  it('a radian key accepts degrees only when marked as degrees and exactly equal', () => {
    expect(checkAnswer('30°', 'π/6')).toBe(true);
    expect(checkAnswer('30 градусов', 'π/6')).toBe(true);
    expect(checkAnswer('arctg(√3/3)', 'π/6')).toBe(true);
    expect(checkAnswer('30', 'π/6')).toBe(false); // a bare number is not read as degrees here
    expect(checkAnswer('60°', 'π/6')).toBe(false);
    expect(checkAnswer('30°', 'arctg(2)')).toBe(false);
  });

  it('an arc-function key accepts its exact degree measure', () => {
    expect(checkAnswer('45°', 'arctg(1)')).toBe(true);
    expect(checkAnswer('44°', 'arctg(1)')).toBe(false);
  });

  it('a part-one number «в градусах» accepts the same number with its unit', () => {
    expect(checkAnswer('127°', '127')).toBe(true);
    expect(checkAnswer('127 градусов', '127')).toBe(true);
    expect(checkAnswer('128°', '127')).toBe(false);
  });
});

describe('checkAnswer — a set of pairs', () => {
  const key = '(5;3), (6;2), (7;1), (8;6), (9;5)';

  it('accepts the same pairs in any order, with any spacing and "," or ";" between them', () => {
    for (const answer of [
      key,
      '(9;5), (8;6), (7;1), (6;2), (5;3)',
      '(5;3);(6;2);(7;1);(8;6);(9;5)',
      '(5; 3) (6; 2) (7; 1) (8; 6) (9; 5)',
      '(7;1),(5;3),(9;5),(6;2),(8;6)',
    ]) {
      expect(checkAnswer(answer, key), answer).toBe(true);
    }
  });

  it('rejects a swapped pair, a missing, extra or repeated pair, and stray text', () => {
    for (const answer of [
      '(3;5), (6;2), (7;1), (8;6), (9;5)',
      '(5;3), (6;2), (7;1), (8;6)',
      '(5;3), (6;2), (7;1), (8;6), (9;5), (4;4)',
      '(5;3), (5;3), (7;1), (8;6), (9;5)',
      '(5;3), (6;2), (7;1), (8;6), (9;5) и ещё',
      '5;3 6;2 7;1 8;6 9;5',
    ]) {
      expect(checkAnswer(answer, key), answer).toBe(false);
    }
  });

  it('keeps "," as the decimal comma inside a pair', () => {
    expect(checkAnswer('(0,5;1)', '(0.5;1)')).toBe(true);
    expect(checkAnswer('(5,3)', '(5;3)')).toBe(false);
  });
});

describe('checkAnswer — signs and end marks', () => {
  it('reads the typographic minus and a spaced leading minus as "-"', () => {
    expect(checkAnswer('−0,5', '-0.5')).toBe(true);
    expect(checkAnswer('- 0,5', '-0.5')).toBe(true);
    expect(checkAnswer('0,5', '-0.5')).toBe(false);
    expect(checkAnswer('−0,4', '-0.5')).toBe(false);
  });

  it('ignores a full stop or "!" after a one-word answer, nothing else', () => {
    expect(checkAnswer('Да.', 'да')).toBe(true);
    expect(checkAnswer('Нет!', 'нет')).toBe(true);
    expect(checkAnswer('нет.', 'да')).toBe(false);
    expect(checkAnswer('да?', 'да')).toBe(false);
  });
});

// Found by the pre-deploy answer matrix: correct answers in common forms were marked wrong.
describe('checkAnswer — equivalent forms students write (pre-deploy matrix)', () => {
  it('accepts an explicit multiplication sign and a bracketed product over a divisor', () => {
    for (const form of ['5*√39/3', '5·√39/3', '5×√39/3', '(5√39)/3', '(5*√39)/3'])
      expect(checkAnswer(form, '5√39/3'), form).toBe(true);
    expect(checkAnswer('11*π/2', '11π/2')).toBe(true);
  });

  it('still rejects a wrong coefficient, radicand or divisor written the same way', () => {
    for (const form of ['5*√38/3', '(5√39)/2', '4*√39/3', '5*√39', '(5√39)'])
      expect(checkAnswer(form, '5√39/3'), form).toBe(false);
  });

  it('reads logarithm and power keys as numbers, not only as the exact string', () => {
    // KNOWN LIMITATION: «(log_5 34)^2» with a space is not read — spaces are
    // dropped before parsing, which glues base and argument («log_534»).
    for (const form of ['log_5(34)^2', '(log5(34))^2', '(log_5(34))^2'])
      expect(checkAnswer(form, '(log_5(34))^2'), form).toBe(true);
    expect(checkAnswer('(log_2(126))^2; (log_2(6))^2', '(log_2(6))^2; (log_2(126))^2')).toBe(true);
    for (const form of ['log_5(34)', '(log_5(35))^2', '(log_5(34))^3', '2·log_5(34)'])
      expect(checkAnswer(form, '(log_5(34))^2'), form).toBe(false);
  });

  it('accepts a bracketed number and digit groups for a plain number key', () => {
    expect(checkAnswer('(-13)', '-13')).toBe(true);
    expect(checkAnswer('2 062 500', '2062500')).toBe(true);
    expect(checkAnswer('62 500', '62500')).toBe(true);
    expect(checkAnswer('(13)', '-13')).toBe(false);
    expect(checkAnswer('2 06 2500', '2062500')).toBe(false);
    expect(checkAnswer('20 625 00', '2062500')).toBe(false);
    // Two answers separated by a space are never glued into one number.
    expect(checkAnswer('2 5', '25')).toBe(false);
    expect(checkAnswer('1 500', '1.5')).toBe(false);
  });
});
