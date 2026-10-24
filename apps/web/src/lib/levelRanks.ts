import { MAX_LEVEL } from '@zybrilka/shared';

/**
 * Level ranks: the visual identity of a range of levels (emblem, palette,
 * motion). Purely presentational — the level itself always comes from the
 * server (`levelForXp`, docs/XP.md) and nothing here touches XP.
 *
 * Ranges are consecutive and never overlap. The brief asked for 1–2, 3–5,
 * 5–10, 15–20, 20–25, 25–30: a level shared by two ranges (5, 20) starts
 * the higher one, the gap 11–14 stays with the rank before it, and the
 * last rank also covers every level above 30 (levels go up to MAX_LEVEL).
 */
export type LevelRankId = 'novice' | 'apprentice' | 'scholar' | 'master' | 'expert' | 'legend';

export interface LevelRank {
  id: LevelRankId;
  /** 0-based position, for «Ранг 3 из 6». */
  index: number;
  name: string;
  minLevel: number;
  /** null = no upper bound (the last rank). */
  maxLevel: number | null;
  /** Two-stop palette for the emblem, bars and accents; `glow` for halos. */
  colors: { from: string; to: string; glow: string };
}

export const LEVEL_RANKS: readonly LevelRank[] = [
  {
    id: 'novice',
    index: 0,
    name: 'Новичок',
    minLevel: 1,
    maxLevel: 2,
    colors: { from: '#a3acc9', to: '#5f6a8f', glow: 'rgba(146, 158, 196, 0.35)' },
  },
  {
    id: 'apprentice',
    index: 1,
    name: 'Ученик',
    minLevel: 3,
    maxLevel: 4,
    colors: { from: '#e6a46b', to: '#a35f2c', glow: 'rgba(216, 140, 82, 0.4)' },
  },
  {
    id: 'scholar',
    index: 2,
    name: 'Знаток',
    minLevel: 5,
    maxLevel: 14,
    colors: { from: '#a9dcff', to: '#4f86d6', glow: 'rgba(110, 170, 240, 0.45)' },
  },
  {
    id: 'master',
    index: 3,
    name: 'Мастер',
    minLevel: 15,
    maxLevel: 19,
    colors: { from: '#ffd979', to: '#d98d12', glow: 'rgba(245, 180, 50, 0.5)' },
  },
  {
    id: 'expert',
    index: 4,
    name: 'Эксперт',
    minLevel: 20,
    maxLevel: 24,
    colors: { from: '#d39bff', to: '#7a12e2', glow: 'rgba(165, 70, 245, 0.55)' },
  },
  {
    id: 'legend',
    index: 5,
    name: 'Легенда',
    minLevel: 25,
    maxLevel: null,
    colors: { from: '#ff8ad8', to: '#4dc8ff', glow: 'rgba(200, 120, 255, 0.55)' },
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
