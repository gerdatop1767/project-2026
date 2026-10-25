import { describe, expect, it } from 'vitest';
import { auditDictionary, readTask4Options } from './audit.js';

/**
 * The reviewed result of the auxiliary cross-check
 * (docs/imports/stress-dictionary-audit-2026.md). If the variants or the
 * dictionary change, this fails on purpose: the new finding must be
 * reviewed by a person and the report updated — nothing is changed
 * automatically from this source.
 */
describe('stress dictionary × task 4 of the Дощинский 2027 variants', () => {
  const rows = auditDictionary();
  const list = (verdict: string) =>
    rows.filter((r) => r.verdict === verdict).map((r) => `V${r.variant}.${r.option} ${r.text}`);

  it('reads all 18 variants × 5 options', () => {
    expect(readTask4Options()).toHaveLength(90);
  });

  it('agreements', () => {
    expect(list('agrees')).toHaveLength(73);
  });

  it('every conflict is a reviewed one', () => {
    expect(list('conflict')).toEqual([
      'V1.1 аэропортЫ', // the source contradicts itself: V14.2 rejects it
      'V2.1 шАрфы', // marked wrong in the variant; шАрфы is the norm
      'V7.5 сосредоточЕние', // the source contradicts itself: V15.3 сосредотОчение
      'V10.5 воссоздАла', // dictionary: воссоздалА — needs a dictionary check
      'V14.5 дешевизнА', // the norm is дешевИзна
      'V15.5 красивЕе', // the norm is красИвее
      'V16.2 пломбИровать', // the norm is пломбировАть (V7.4 agrees)
      'V16.3 начАли', // the norm is нАчали
      'V18.5 освЕдомится', // marked wrong in the variant; освЕдомится is the norm
    ]);
  });

  it('words the variants use that the dictionary lacks (candidates, not added)', () => {
    expect(list('not_in_dictionary')).toEqual([
      'V5.1 принятА',
      'V7.3 отзЫв (о книге)',
      'V8.1 ободрИт',
      'V9.1 еретИк',
      'V10.1 отзЫв (на книгу)',
      'V10.3 досУг',
      'V12.3 ободрИтся',
      'V13.1 одолжИт',
    ]);
  });
});
