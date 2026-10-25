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
    expect(parseStressEntry('занялА | гл. | прош. вр., ж. р.')).toEqual({
      key: 'занялА (прош. вр., ж. р.)',
      marked: 'занялА',
      word: 'заняла',
      stressIndex: 5,
      partOfSpeech: 'гл.',
      formNote: 'прош. вр., ж. р.',
      removed2026: false,
    });
    expect(parseStressEntry('нарОст | сущ. | | removed2026')).toMatchObject({
      key: 'нарОст',
      removed2026: true,
    });
  });

  it('rejects ambiguous or malformed lines', () => {
    for (const bad of [
      'торты | сущ.', // no stress
      'тОртЫ | сущ.', // two stresses
      'тоРты | сущ.', // stress on a consonant
      'кот | сущ.', // nothing to choose — but no capital either
      'кОт | сущ.', // one vowel
      'свЕклА | сущ.',
      'свеклА | сущ. | | ', // fine shape, checked below for ё separately
      'свёклА | сущ.', // ё without the stress
      'tOrty | сущ.',
      'тОрты | сущ-ое',
      'тОрты | сущ. | | newflag',
      'тОрты | сущ. | a | b | c',
    ]) {
      const result = parseStressEntry(bad);
      if (bad === 'свеклА | сущ. | | ') expect(typeof result).toBe('object');
      else expect(typeof result, bad).toBe('string');
    }
  });

  it('keeps forms with different stress apart; refuses real duplicates', () => {
    const { entries, problems } = validateStressEntries([
      'зАнял | гл. | прош. вр., м. р.',
      'занялА | гл. | прош. вр., ж. р.',
      'зАняли | гл. | прош. вр., мн. ч.',
    ]);
    expect(problems).toEqual([]);
    expect(entries).toHaveLength(3);
    expect(validateStressEntries(['тОрты | сущ.', 'тОрты | сущ.']).problems[0]).toMatch(
      /duplicate/,
    );
    expect(
      validateStressEntries(['тОрты | сущ.', 'тОрты | сущ. | И. п. мн. ч.']).problems[0],
    ).toMatch(/same stressed form/);
  });

  it('display hides the stress and «ё»; vowels are the tappable letters', () => {
    expect(unstressedDisplay('свёкла')).toBe('свекла');
    expect(vowelIndices('свекла')).toEqual([2, 5]);
    expect(markStress('свекла', 2)).toBe('свЕкла');
  });
});
