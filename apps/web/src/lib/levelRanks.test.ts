import { MAX_LEVEL } from '@zybrilka/shared';
import { describe, expect, it } from 'vitest';
import { LEVEL_RANKS, levelRankFor, levelRankRange, nextLevelRank } from './levelRanks.js';

describe('level ranks', () => {
  it.each([
    [1, 'novice'],
    [5, 'novice'],
    [6, 'apprentice'],
    [10, 'apprentice'],
    [11, 'scholar'],
    [15, 'scholar'],
    [16, 'expert'],
    [20, 'expert'],
    [21, 'legend'],
    [30, 'legend'],
    [MAX_LEVEL, 'legend'],
  ])('level %i → %s', (level, id) => {
    expect(levelRankFor(level).id).toBe(id);
  });

  it('one rank every five levels', () => {
    expect(LEVEL_RANKS.map((r) => [r.minLevel, r.maxLevel])).toEqual([
      [1, 5],
      [6, 10],
      [11, 15],
      [16, 20],
      [21, null],
    ]);
  });

  it('treats invalid input as level 1', () => {
    expect(levelRankFor(0).id).toBe('novice');
    expect(levelRankFor(-3).id).toBe('novice');
    expect(levelRankFor(Number.NaN).id).toBe('novice');
    expect(levelRankFor(6.9).id).toBe('apprentice');
  });

  it('ranges are consecutive, never overlap, and cover every level', () => {
    for (let i = 1; i < LEVEL_RANKS.length; i++) {
      expect(LEVEL_RANKS[i]!.minLevel).toBe(LEVEL_RANKS[i - 1]!.maxLevel! + 1);
      expect(LEVEL_RANKS[i]!.index).toBe(i);
    }
    expect(LEVEL_RANKS[0]!.minLevel).toBe(1);
    expect(LEVEL_RANKS.at(-1)!.maxLevel).toBeNull();
    for (let level = 1; level <= MAX_LEVEL; level++) {
      const matching = LEVEL_RANKS.filter(
        (r) => level >= r.minLevel && (r.maxLevel === null || level <= r.maxLevel),
      );
      expect(matching).toHaveLength(1);
    }
  });

  it('knows the next rank and prints ranges', () => {
    expect(nextLevelRank(levelRankFor(7))!.name).toBe('Знаток');
    expect(nextLevelRank(levelRankFor(30))).toBeNull();
    expect(levelRankRange(levelRankFor(1))).toBe('1–5');
    expect(levelRankRange(levelRankFor(12))).toBe('11–15');
    expect(levelRankRange(levelRankFor(40))).toBe(`21–${MAX_LEVEL}`);
  });
});
