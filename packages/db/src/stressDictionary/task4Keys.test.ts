import { describe, expect, it } from 'vitest';
import { checkTask4Keys } from './task4Keys.js';

/**
 * Task 4 of all 18 Дощинский 2027 variants against FIPI's
 * «Орфоэпический список – 2026» (docs/imports/task-4-audit-2027.md).
 * A new disagreement — a changed key, option or dictionary entry — fails
 * here and has to be looked at by a person.
 */
describe('task 4 keys × «Орфоэпический список – 2026»', () => {
  const checks = checkTask4Keys();
  const byVariant = new Map(checks.map((c) => [c.variant, c]));

  it('finds task 4 in all 18 variants, five options each', () => {
    expect(checks.map((c) => c.variant)).toEqual(Array.from({ length: 18 }, (_, i) => i + 1));
    for (const c of checks) expect(c.options.map((o) => o.option)).toEqual([1, 2, 3, 4, 5]);
  });

  it('the official list decides every option — no word outside it, no unresolved homograph', () => {
    for (const c of checks) {
      for (const o of c.options)
        expect(o.officialRight, `V${c.variant}.${o.option}`).not.toBeNull();
    }
  });

  it('homographs are decided by context, not by spelling alone', () => {
    for (const [variant, option] of [
      [7, 3],
      [10, 1],
    ] as const) {
      const o = byVariant.get(variant)!.options[option - 1]!;
      expect(o.text).toMatch(/книг/);
      expect(o.official).toBe('Отзыв');
      expect(o.officialRight).toBe(false);
    }
  });

  it('every published key is exactly the set of options the list marks right', () => {
    for (const c of checks.filter((x) => x.status === 'published')) {
      expect(c.verdict, `V${c.variant}: key ${c.key}, list ${c.expectedKey}`).toBe('confirmed');
    }
  });

  it('the keys corrected by this audit', () => {
    expect(Object.fromEntries([1, 2, 7, 14, 18].map((v) => [v, byVariant.get(v)!.key]))).toEqual({
      1: '25',
      2: '134',
      7: '24',
      14: '134',
      18: '2345',
    });
  });

  // Not decidable without the book's scan: the key disagrees with the list
  // and the explanation does not show which of the key or the transcribed
  // letter is wrong. Hidden from students (needs_review), data untouched.
  it.each([
    [10, '345', '34', 'воссоздАла'],
    [15, '2345', '234', 'красивЕе'],
    [16, '1235', '15', 'пломбИровать'],
  ])('V%i waits for a scan check: key %s kept, list gives %s', (variant, key, expected, word) => {
    const c = byVariant.get(variant)!;
    expect(c.status).toBe('needs_review');
    expect(c.key).toBe(key);
    expect(c.expectedKey).toBe(expected);
    expect(c.options.map((o) => o.marked)).toContain(word);
  });

  it('nothing else is held back', () => {
    expect(checks.filter((c) => c.status !== 'published').map((c) => c.variant)).toEqual([
      10, 15, 16,
    ]);
  });
});
