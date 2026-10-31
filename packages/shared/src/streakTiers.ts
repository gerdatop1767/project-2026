/**
 * Streak tiers — one table for the header flame and the admin analytics,
 * so both always agree. Ranges are contiguous and non-overlapping:
 * 1–4, 5–14, 15–29, 30–39, 40–59, 60+ (anything above 90 stays tier 6).
 * 0 (or no streak) is tier 0: no active streak, never shown as one.
 */
export const STREAK_TIERS = [
  { tier: 1, min: 1, max: 4, label: '1–4' },
  { tier: 2, min: 5, max: 14, label: '5–14' },
  { tier: 3, min: 15, max: 29, label: '15–29' },
  { tier: 4, min: 30, max: 39, label: '30–39' },
  { tier: 5, min: 40, max: 59, label: '40–59' },
  { tier: 6, min: 60, max: null, label: '60+' },
] as const;

export type StreakTier = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export function streakTier(days: number | null | undefined): StreakTier {
  if (days === null || days === undefined || !Number.isFinite(days) || days < 1) return 0;
  const n = Math.floor(days);
  for (const t of STREAK_TIERS) {
    if (n >= t.min && (t.max === null || n <= t.max)) return t.tier;
  }
  return 6;
}
