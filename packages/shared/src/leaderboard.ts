import { z } from 'zod';

/**
 * Leaderboard (docs/LEADERBOARD.md). Ranked by the XP earned in the period
 * — XP is awarded once per task and for spaced review (docs/XP.md), so
 * repeating easy tasks cannot farm the rating the way a raw count could.
 */
export const leaderboardPeriods = ['today', 'week', 'all'] as const;
export type LeaderboardPeriod = (typeof leaderboardPeriods)[number];

export const LEADERBOARD_DEFAULT_LIMIT = 50;
export const LEADERBOARD_MAX_LIMIT = 100;
/** How many generated avatar pictures the rating cycles through. */
export const LEADERBOARD_AVATAR_VARIANTS = 24;

export const leaderboardQuerySchema = z.object({
  period: z.enum(leaderboardPeriods).default('week'),
  /** A subject id (`math`, `russian`…); omitted = all subjects. */
  subject: z
    .string()
    .regex(/^[a-z0-9_-]{1,40}$/)
    .optional(),
  limit: z.coerce
    .number()
    .int()
    .min(0)
    .max(LEADERBOARD_MAX_LIMIT)
    .default(LEADERBOARD_DEFAULT_LIMIT),
});
export type LeaderboardQuery = z.infer<typeof leaderboardQuerySchema>;

/** Only what a rating needs: a public name, never an id, email or photo. */
export const leaderboardEntrySchema = z.object({
  /** 1-based; equal points share a rank (1, 2, 2, 4). */
  rank: z.number().int().positive(),
  /** Custom display name, or first name + last-name initial, or «Участник». */
  name: z.string(),
  /** Overall level (from all-time XP), whatever the period. */
  level: z.number().int().positive(),
  /** XP earned in the period (and subject). */
  points: z.number().int().nonnegative(),
  /** Distinct tasks answered correctly in the period. */
  solved: z.number().int().nonnegative(),
  /** Correct answers / all answers in the period; null with no answers. */
  accuracyPercent: z.number().int().min(0).max(100).nullable(),
  isMe: z.boolean(),
  /** 0–359: a stable colour for the generated avatar. */
  avatarHue: z.number().int().min(0).max(359),
  /** Which of the generated avatar pictures (0 … LEADERBOARD_AVATAR_VARIANTS−1):
   * stable for a user, derived from a hash — never their photo or id. */
  avatarVariant: z
    .number()
    .int()
    .min(0)
    .max(LEADERBOARD_AVATAR_VARIANTS - 1),
  /** The picture the user's own profile shows, served from our domain
   * (`/api/v1/leaderboard/avatars/<image id>?v=<hash>` — an image id, never
   * the user's). null = none stored here (or only a provider URL, which is
   * not handed out): the generated avatar is shown instead. */
  avatarUrl: z.string().nullable(),
});
export type LeaderboardEntry = z.infer<typeof leaderboardEntrySchema>;

export const leaderboardMeSchema = z.object({
  /** null = no points in this period yet (not in the rating). */
  rank: z.number().int().positive().nullable(),
  level: z.number().int().positive(),
  points: z.number().int().nonnegative(),
  solved: z.number().int().nonnegative(),
  accuracyPercent: z.number().int().min(0).max(100).nullable(),
});
export type LeaderboardMe = z.infer<typeof leaderboardMeSchema>;

/** GET /leaderboard */
export const leaderboardResponseSchema = z.object({
  period: z.enum(leaderboardPeriods),
  subjectId: z.string().nullable(),
  /** Start of the period (null = all time). */
  since: z.iso.datetime().nullable(),
  /** Everyone with points in the period. */
  participants: z.number().int().nonnegative(),
  entries: z.array(leaderboardEntrySchema),
  me: leaderboardMeSchema,
});
export type LeaderboardResponse = z.infer<typeof leaderboardResponseSchema>;
