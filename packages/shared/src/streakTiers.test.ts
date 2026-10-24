import { describe, expect, it } from 'vitest';
import { STREAK_TIERS, streakTier } from './streakTiers.js';

describe('streakTier', () => {
  it('no streak is tier 0, never an active streak', () => {
    for (const v of [0, -1, null, undefined, Number.NaN, 0.5]) expect(streakTier(v)).toBe(0);
  });

  it.each([
    [1, 1],
    [4, 1],
    [5, 2],
    [14, 2],
    [15, 3],
    [29, 3],
    [30, 4],
    [39, 4],
    [40, 5],
    [59, 5],
    [60, 6],
    [90, 6],
    [365, 6],
  ])('%i days → tier %i', (days, tier) => {
    expect(streakTier(days)).toBe(tier);
  });

  it('ranges are contiguous with no gaps or overlaps', () => {
    for (let i = 1; i < STREAK_TIERS.length; i++) {
      expect(STREAK_TIERS[i]!.min).toBe((STREAK_TIERS[i - 1]!.max as number) + 1);
    }
    for (let d = 1; d <= 120; d++) expect(streakTier(d)).toBeGreaterThan(0);
  });
});
