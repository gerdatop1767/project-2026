import { MAX_LEVEL } from '@zybrilka/shared';

/**
 * Level ranks: the visual identity of a range of levels (the approved
 * emblem artwork and a matching palette). Purely presentational — the level
 * itself always comes from the server (`levelForXp`, docs/XP.md) and nothing
 * here touches XP.
 *
 * Five ranks, one every five levels: 1–5, 6–10, 11–15, 16–20, and the last
 * from 21 up to the maximum level. Consecutive, never overlapping.
 */
export type LevelRankId = 'novice' | 'apprentice' | 'scholar' | 'expert' | 'legend';

export interface LevelRank {
  id: LevelRankId;
  /** 0-based position, for «Ранг 3 из 5». */
  index: number;
  name: string;
  minLevel: number;
  /** null = no upper bound (the last rank). */
  maxLevel: number | null;
  /** Two-stop palette (taken from the emblem) for bars and accents; `glow` for shadows. */
  colors: { from: string; to: string; glow: string };
}

export const LEVEL_RANKS: readonly LevelRank[] = [
  {
    id: 'novice',
    index: 0,
    name: 'Новичок',
    minLevel: 1,
    maxLevel: 5,
    colors: { from: '#aab4ff', to: '#5d68d6', glow: 'rgba(120, 132, 240, 0.4)' },
  },
  {
    id: 'apprentice',
    index: 1,
    name: 'Ученик',
    minLevel: 6,
    maxLevel: 10,
    colors: { from: '#ffad6b', to: '#d9581f', glow: 'rgba(240, 120, 50, 0.4)' },
  },
  {
    id: 'scholar',
    index: 2,
    name: 'Знаток',
    minLevel: 11,
    maxLevel: 15,
    colors: { from: '#9fd0ff', to: '#3f7fe0', glow: 'rgba(90, 150, 240, 0.45)' },
  },
  {
    id: 'expert',
    index: 3,
    name: 'Эксперт',
    minLevel: 16,
    maxLevel: 20,
    colors: { from: '#d59bff', to: '#8a2be2', glow: 'rgba(165, 70, 245, 0.5)' },
  },
  {
    id: 'legend',
    index: 4,
    name: 'Легенда',
    minLevel: 21,
    maxLevel: null,
    colors: { from: '#ffa8e0', to: '#5aa8ff', glow: 'rgba(200, 140, 255, 0.5)' },
  },
];

/** The rank a level belongs to (anything below 1 counts as level 1). */
export function levelRankFor(level: number): LevelRank {
  const l = Number.isFinite(level) ? Math.max(1, Math.floor(level)) : 1;
  for (let i = LEVEL_RANKS.length - 1; i >= 0; i--) {
    if (l >= LEVEL_RANKS[i]!.minLevel) return LEVEL_RANKS[i]!;
  }
  return LEVEL_RANKS[0]!;
}

/** The rank after this one, or null for the last. */
export function nextLevelRank(rank: LevelRank): LevelRank | null {
  return LEVEL_RANKS[rank.index + 1] ?? null;
}

/** «1–2», «5–14», «25–50» (the last rank ends at the maximum level). */
export function levelRankRange(rank: LevelRank): string {
  return `${rank.minLevel}–${rank.maxLevel ?? MAX_LEVEL}`;
}

/** CSS custom properties carrying a rank's palette (for `style`). */
export function levelRankStyle(rank: LevelRank): Record<string, string> {
  return {
    '--rank-from': rank.colors.from,
    '--rank-to': rank.colors.to,
    '--rank-glow': rank.colors.glow,
  };
}
