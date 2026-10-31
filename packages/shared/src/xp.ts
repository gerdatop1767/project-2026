import { z } from 'zod';

/**
 * Levels (docs/XP.md). The ONE place a level is derived from total XP —
 * the API computes every level it returns with these functions and the
 * web app only shows what the API sent, so the header, the profile and
 * the «Уровень» page can never disagree.
 *
 * Accumulated XP is the only source of truth: a level is never stored or
 * incremented on its own, it is always `levelForXp(totalXp)`.
 *
 * Curve: the XP needed to go from level k to k+1 starts at 50 and grows
 * by 30, 40, 50, … per level; that growth is capped at +100 per level so
 * later levels keep asking for steady practice without turning into an
 * endless grind. Thresholds: L2 = 50, L3 = 130, L4 = 250, L5 = 420,
 * L6 = 650, L10 = 2 370, L20 = 13 570.
 */
export const XP_LEVEL_CURVE = {
  firstStep: 50,
  firstGrowth: 30,
  growthIncrement: 10,
  maxGrowth: 100,
  maxLevel: 50,
} as const;

function buildThresholds(): readonly number[] {
  const { firstStep, firstGrowth, growthIncrement, maxGrowth, maxLevel } = XP_LEVEL_CURVE;
  const thresholds = [0];
  let step: number = firstStep;
  let growth: number = firstGrowth;
  for (let level = 2; level <= maxLevel; level++) {
    thresholds.push(thresholds[thresholds.length - 1]! + step);
    step += growth;
    growth = Math.min(growth + growthIncrement, maxGrowth);
  }
  return thresholds;
}

/** `LEVEL_THRESHOLDS[i]` = total XP at which level `i + 1` starts. */
export const LEVEL_THRESHOLDS: readonly number[] = buildThresholds();

export const MAX_LEVEL = LEVEL_THRESHOLDS.length;

/** Total XP at which `level` starts (level 1 = 0). */
export function xpForLevel(level: number): number {
  const clamped = Math.min(Math.max(Math.floor(level), 1), MAX_LEVEL);
  return LEVEL_THRESHOLDS[clamped - 1]!;
}

/** The level for an amount of accumulated XP (1 for 0 or anything invalid). */
export function levelForXp(totalXp: number): number {
  if (!Number.isFinite(totalXp) || totalXp <= 0) return 1;
  let level = 1;
  while (level < MAX_LEVEL && totalXp >= LEVEL_THRESHOLDS[level]!) level++;
  return level;
}

export interface LevelProgress {
  totalXp: number;
  level: number;
  /** Total XP where the current level started. */
  levelStartXp: number;
  /** Total XP where the next level starts; null at the maximum level. */
  nextLevelXp: number | null;
  /** XP earned inside the current level. */
  xpIntoLevel: number;
  /** XP the current level spans; null at the maximum level. */
  xpForNextLevel: number | null;
  /** XP still missing for the next level; null at the maximum level. */
  xpToNextLevel: number | null;
  /** 0..1 share of the current level done (1 at the maximum level). */
  progress: number;
  maxLevel: number;
  isMaxLevel: boolean;
}

export function levelProgress(totalXp: number): LevelProgress {
  const total = Number.isFinite(totalXp) && totalXp > 0 ? Math.floor(totalXp) : 0;
  const level = levelForXp(total);
  const levelStartXp = xpForLevel(level);
  const isMaxLevel = level >= MAX_LEVEL;
  const nextLevelXp = isMaxLevel ? null : xpForLevel(level + 1);
  const span = nextLevelXp === null ? null : nextLevelXp - levelStartXp;
  const into = total - levelStartXp;
  return {
    totalXp: total,
    level,
    levelStartXp,
    nextLevelXp,
    xpIntoLevel: into,
    xpForNextLevel: span,
    xpToNextLevel: nextLevelXp === null ? null : nextLevelXp - total,
    progress: span === null ? 1 : Math.min(1, into / span),
    maxLevel: MAX_LEVEL,
    isMaxLevel,
  };
}

// ------------------------------------------------------------------ API

/** What an XP event was for (docs/XP.md has the rules for each). */
export const xpEventKinds = ['task_first_solve', 'task_review'] as const;
export type XpEventKind = (typeof xpEventKinds)[number];

export const levelProgressSchema = z.object({
  totalXp: z.number().int().nonnegative(),
  level: z.number().int().positive(),
  levelStartXp: z.number().int().nonnegative(),
  nextLevelXp: z.number().int().nullable(),
  xpIntoLevel: z.number().int().nonnegative(),
  xpForNextLevel: z.number().int().nullable(),
  xpToNextLevel: z.number().int().nullable(),
  progress: z.number().min(0).max(1),
  maxLevel: z.number().int().positive(),
  isMaxLevel: z.boolean(),
});

/** GET /progress/xp */
export type XpSummaryResponse = LevelProgress;

export const xpHistoryItemSchema = z.object({
  id: z.uuid(),
  amount: z.number().int().positive(),
  kind: z.enum(xpEventKinds),
  createdAt: z.iso.datetime(),
  /** The task the XP was for (null if it no longer exists). */
  task: z
    .object({
      id: z.uuid(),
      subjectId: z.string(),
      subjectName: z.string(),
      taskNumber: z.number().int(),
    })
    .nullable(),
});
export type XpHistoryItem = z.infer<typeof xpHistoryItemSchema>;

/** GET /progress/xp/history — newest first, keyset-paginated. */
export const xpHistoryResponseSchema = z.object({
  items: z.array(xpHistoryItemSchema),
  nextCursor: z.string().nullable(),
});
export type XpHistoryResponse = z.infer<typeof xpHistoryResponseSchema>;

/** Present on a signed-in attempt's result: what this answer earned. */
export const attemptXpSchema = z.object({
  awarded: z.number().int().nonnegative(),
  kind: z.enum(xpEventKinds).nullable(),
  totalXp: z.number().int().nonnegative(),
  level: z.number().int().positive(),
  previousLevel: z.number().int().positive(),
});
export type AttemptXp = z.infer<typeof attemptXpSchema>;
