import { z } from 'zod';

/**
 * Student difficulty ratings 1..10 (docs/learning/ALGORITHMS.md § 5).
 *
 * Two numbers that are never mixed:
 * - a student's own rating — subjective difficulty, used only for that
 *   student;
 * - the community difficulty — a robust aggregate of everyone's ratings.
 *
 * The community value is the median of the ratings that survive two
 * filters, and is shown only from MIN_RATINGS_FOR_COMMUNITY ratings:
 *   1. «flat raters» (10+ ratings, all the same value) are left out —
 *      a student who taps «10» on everything says nothing about a task;
 *   2. Tukey fences: a rating outside [Q1 − 1.5·IQR, Q3 + 1.5·IQR] is an
 *      outlier for this task (a «1» among eights) and is dropped.
 * The median, not the mean, so a few extreme ratings cannot move it.
 *
 * A rating never changes whether an answer was correct, XP or mastery: a
 * student can find a task hard and solve it — that is information, not an
 * error.
 */

export const MIN_RATINGS_FOR_COMMUNITY = 5;
export const FLAT_RATER_MIN_RATINGS = 10;

export const difficultyRatingRequestSchema = z.object({
  rating: z.number().int().min(1).max(10),
});
export type DifficultyRatingRequest = z.infer<typeof difficultyRatingRequestSchema>;

export type DifficultyBand = 'easy' | 'medium' | 'hard' | 'very_hard';

export function difficultyBand(value: number): DifficultyBand {
  if (value <= 3) return 'easy';
  if (value <= 6) return 'medium';
  if (value <= 8) return 'hard';
  return 'very_hard';
}

export const DIFFICULTY_BAND_LABELS: Record<DifficultyBand, string> = {
  easy: 'лёгкое',
  medium: 'среднее',
  hard: 'сложное',
  very_hard: 'очень сложное',
};

export interface CommunityDifficulty {
  /** Ratings stored for the task. */
  readonly count: number;
  /** Ratings left after the anomaly filters. */
  readonly used: number;
  /** Median of the used ratings; null below the threshold (not shown). */
  readonly median: number | null;
  readonly confident: boolean;
  readonly band: DifficultyBand | null;
}

export interface DifficultyRatingResponse {
  readonly myRating: number | null;
  readonly community: CommunityDifficulty;
}

function quantile(sorted: readonly number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

export function aggregateDifficultyRatings(
  ratings: readonly { readonly userId: string; readonly rating: number }[],
  flatRaters: ReadonlySet<string> = new Set(),
): CommunityDifficulty {
  const count = ratings.length;
  let values = ratings
    .filter((r) => !flatRaters.has(r.userId) && r.rating >= 1 && r.rating <= 10)
    .map((r) => r.rating)
    .sort((a, b) => a - b);
  if (values.length >= MIN_RATINGS_FOR_COMMUNITY) {
    const q1 = quantile(values, 0.25);
    const q3 = quantile(values, 0.75);
    const iqr = q3 - q1;
    values = values.filter((v) => v >= q1 - 1.5 * iqr && v <= q3 + 1.5 * iqr);
  }
  const used = values.length;
  const confident = used >= MIN_RATINGS_FOR_COMMUNITY;
  const median = confident ? Math.round(quantile(values, 0.5) * 10) / 10 : null;
  return { count, used, median, confident, band: median === null ? null : difficultyBand(median) };
}

/**
 * The difficulty the Learning Engine uses to pick tasks, on the authored
 * 1..3 scale: the authored difficulty, moved towards the community median
 * once there is enough of it (1–10 → 1–3). Never the student's own rating.
 */
export function effectiveDifficulty(authored: number, communityMedian: number | null): number {
  if (communityMedian === null) return authored;
  const community = 1 + ((communityMedian - 1) / 9) * 2;
  return Math.round(((authored + community) / 2) * 100) / 100;
}
