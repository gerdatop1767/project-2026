import { describe, expect, it } from 'vitest';
import { LEVEL_THRESHOLDS, MAX_LEVEL, levelForXp, levelProgress, xpForLevel } from './xp.js';

describe('level curve', () => {
  it('hits the planned anchors', () => {
    expect(LEVEL_THRESHOLDS.slice(0, 6)).toEqual([0, 50, 130, 250, 420, 650]);
    expect(xpForLevel(10)).toBe(2370);
    expect(xpForLevel(20)).toBe(13570);
  });

  it('every level needs at least as much XP as the previous one, growth capped at +100', () => {
    for (let i = 2; i < LEVEL_THRESHOLDS.length; i++) {
      const step = LEVEL_THRESHOLDS[i]! - LEVEL_THRESHOLDS[i - 1]!;
      const previous = LEVEL_THRESHOLDS[i - 1]! - LEVEL_THRESHOLDS[i - 2]!;
      expect(step).toBeGreaterThan(previous);
      expect(step - previous).toBeLessThanOrEqual(100);
    }
  });

  it('starts at level 1 and treats junk as 0 XP', () => {
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(-5)).toBe(1);
    expect(levelForXp(Number.NaN)).toBe(1);
  });

  it('switches exactly at the threshold', () => {
    expect(levelForXp(49)).toBe(1);
    expect(levelForXp(50)).toBe(2);
    expect(levelForXp(129)).toBe(2);
    expect(levelForXp(130)).toBe(3);
  });

  it('crosses several levels in one go', () => {
    expect(levelForXp(0 + 420)).toBe(5);
  });

  it('reports progress inside a level', () => {
    expect(levelProgress(90)).toMatchObject({
      level: 2,
      levelStartXp: 50,
      nextLevelXp: 130,
      xpIntoLevel: 40,
      xpForNextLevel: 80,
      xpToNextLevel: 40,
      progress: 0.5,
      isMaxLevel: false,
    });
  });

  it('has an explicit maximum level', () => {
    const top = xpForLevel(MAX_LEVEL);
    expect(levelForXp(top * 10)).toBe(MAX_LEVEL);
    expect(levelProgress(top + 5)).toMatchObject({
      level: MAX_LEVEL,
      nextLevelXp: null,
      xpToNextLevel: null,
      progress: 1,
      isMaxLevel: true,
    });
  });
});
