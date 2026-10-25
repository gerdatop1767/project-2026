import { describe, expect, it } from 'vitest';
import {
  markStress,
  parseStressEntry,
  unstressedDisplay,
  validateStressEntries,
  vowelIndices,
} from './miniGames.js';

describe('stress dictionary lines', () => {
  it('parses a marked form with its part of speech and form note', () => {
    expect(parseStressEntry('занялА | гл. | прош. вр., ж. р. | с. 3')).toEqual({
      key: 'занялА (прош. вр., ж. р.)',
      marked: 'занялА',
      word: 'заняла',
      stressIndex: 5,
      partOfSpeech: 'гл.',
      formNote: 'прош. вр., ж. р.',
      pages: [3],
    });
    expect(parseStressEntry('красИвее | прил. | сравн. ст. | с. 2, с. 5')).toMatchObject({
      key: 'красИвее (сравн. ст.)',
      pages: [2, 5],
    });
  });

  it('rejects ambiguous or malformed lines', () => {
    for (const bad of [
      'торты | сущ. | | с. 2', // no stress
      'тОртЫ | сущ. | | с. 2', // two stresses
      'тоРты | сущ. | | с. 2', // stress on a consonant
      'кОт | сущ. | | с. 2', // one vowel
      'свЕклА | сущ. | | с. 2',
      'свёклА | сущ. | | с. 2', // ё without the stress
      'tOrty | сущ. | | с. 2',
      'тОрты | сущ-ое | | с. 2',
      'тОрты | сущ.', // no source page
      'тОрты | сущ. | | стр 2',
      'тОрты | сущ. | a | с. 2 | c',
    ]) {
      expect(typeof parseStressEntry(bad), bad).toBe('string');
    }
    // «е» in place of «ё» is a valid spelling (FIPI allows it in task 4).
    expect(typeof parseStressEntry('свеклА | сущ. | | с. 2')).toBe('object');
  });

  it('keeps forms with different stress apart; refuses real duplicates', () => {
    const { entries, problems } = validateStressEntries([
      'зАнял | гл. | прош. вр., м. р. | с. 3',
      'занялА | гл. | прош. вр., ж. р. | с. 3',
      'зАняли | гл. | прош. вр., мн. ч. | с. 3',
      'Отзыв | сущ. | о книге | с. 2',
      'отзЫв | сущ. | посла | с. 2',
    ]);
    expect(problems).toEqual([]);
    expect(entries).toHaveLength(5);
    expect(
      validateStressEntries(['тОрты | сущ. | | с. 2', 'тОрты | сущ. | | с. 2']).problems[0],
    ).toMatch(/duplicate/);
    expect(
      validateStressEntries(['тОрты | сущ. | | с. 2', 'тОрты | сущ. | И. п. мн. ч. | с. 2'])
        .problems[0],
    ).toMatch(/same stressed form/);
  });

  it('display hides the stress and «ё»; vowels are the tappable letters', () => {
    expect(unstressedDisplay('свёкла')).toBe('свекла');
    expect(vowelIndices('свекла')).toEqual([2, 5]);
    expect(markStress('свекла', 2)).toBe('свЕкла');
  });
});
