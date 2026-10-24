import { MAX_LEVEL } from '@zybrilka/shared';
import { describe, expect, it } from 'vitest';
import { LEVEL_RANKS, levelRankFor, levelRankRange, nextLevelRank } from './levelRanks.js';

describe('level ranks', () => {
  it.each([
    [1, 'novice'],
    [2, 'novice'],
    [3, 'apprentice'],
    [4, 'apprentice'],
    [5, 'scholar'], // 5 was in both «3–5» and «5–10»: it starts the higher rank
    [10, 'scholar'],
    [11, 'scholar'], // the gap 11–14 stays with the rank before it
    [14, 'scholar'],
    [15, 'master'],
    [19, 'master'],
    [20, 'expert'], // 20 was in both «15–20» and «20–25»
    [24, 'expert'],
    [25, 'legend'],
    [30, 'legend'],
    [31, 'legend'],
    [MAX_LEVEL, 'legend'],
  ])('level %i → %s', (level, id) => {
    expect(levelRankFor(level).id).toBe(id);
  });

  it('treats invalid input as level 1', () => {
    expect(levelRankFor(0).id).toBe('novice');
    expect(levelRankFor(-3).id).toBe('novice');
    expect(levelRankFor(Number.NaN).id).toBe('novice');
    expect(levelRankFor(4.9).id).toBe('apprentice');
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
    expect(nextLevelRank(levelRankFor(4))!.name).toBe('Знаток');
    expect(nextLevelRank(levelRankFor(30))).toBeNull();
    expect(levelRankRange(levelRankFor(1))).toBe('1–2');
    expect(levelRankRange(levelRankFor(7))).toBe('5–14');
    expect(levelRankRange(levelRankFor(40))).toBe(`25–${MAX_LEVEL}`);
  });
});
