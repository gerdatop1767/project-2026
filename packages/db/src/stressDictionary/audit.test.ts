import { describe, expect, it } from 'vitest';
import { auditDictionary, readTask4Options } from './audit.js';

/**
 * Task 4 of the project's Дощинский 2027 variants against the official
 * FIPI 2026 list (= the dictionary). The reviewed result
 * (docs/imports/stress-dictionary-audit-2026.md): if the variants or the
 * dictionary change, this fails on purpose so a person reviews the new
 * finding — nothing is changed automatically.
 */
describe('stress dictionary × task 4 of the Дощинский 2027 variants', () => {
  const rows = auditDictionary();
  const list = (verdict: string) =>
    rows.filter((r) => r.verdict === verdict).map((r) => `V${r.variant}.${r.option} ${r.text}`);

  it('reads all 18 variants × 5 options', () => {
    expect(readTask4Options()).toHaveLength(90);
  });

  it('agreements', () => {
    expect(list('agrees')).toHaveLength(84);
  });

  // Each one is a variant task whose key the official list contradicts
  // (page of the list in brackets). The five confirmed key errors (V1, V2,
  // V7, V14, V18) are fixed; these three are `needs_review` with their keys
  // kept until the scan is checked (docs/imports/task-4-audit-2027.md).
  it('every conflict is a reviewed one', () => {
    expect(list('conflict')).toEqual([
      'V10.5 воссоздАла', // list: воссоздалА (p. 3)
      'V15.5 красивЕе', // list: красИвее (pp. 2, 5)
      'V16.2 пломбИровать', // list: пломбировАть (p. 4)
      'V16.3 начАли', // list: нАчали (p. 3)
    ]);
  });

  it('homographs are checked by hand: both variants treat «отзыв о книге» as «Отзыв», as the list does', () => {
    expect(list('homograph')).toEqual(['V7.3 отзЫв (о книге)', 'V10.1 отзЫв (на книгу)']);
    for (const r of rows.filter((x) => x.verdict === 'homograph'))
      expect(r.markedRight).toBe(false);
  });

  it('every word the variants use is in the official list', () => {
    expect(list('not_in_dictionary')).toEqual([]);
  });
});
