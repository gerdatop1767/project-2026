import { describe, expect, it } from 'vitest';
import {
  aggregateDifficultyRatings,
  difficultyBand,
  difficultyRatingRequestSchema,
  effectiveDifficulty,
} from './difficultyRating.js';

const r = (values: number[], prefix = 'u') =>
  values.map((rating, i) => ({ userId: `${prefix}${i}`, rating }));

describe('community difficulty', () => {
  it('only integers 1..10 are accepted', () => {
    for (const ok of [1, 5, 10])
      expect(difficultyRatingRequestSchema.safeParse({ rating: ok }).success).toBe(true);
    for (const bad of [0, 11, 5.5, -1, '7', null]) {
      expect(difficultyRatingRequestSchema.safeParse({ rating: bad }).success).toBe(false);
    }
  });

  it('is not shown below 5 ratings — no false precision', () => {
    const few = aggregateDifficultyRatings(r([9, 9, 8, 9]));
    expect(few).toMatchObject({ count: 4, median: null, confident: false, band: null });
  });

  it('uses the median: a couple of extreme ratings cannot move it', () => {
    expect(aggregateDifficultyRatings(r([7, 7, 8, 8, 8, 9])).median).toBe(8);
    const withOutliers = aggregateDifficultyRatings(r([7, 7, 8, 8, 8, 9, 1]));
    expect(withOutliers.median).toBe(8);
    expect(withOutliers.used).toBe(6); // the lone «1» is an outlier
    expect(withOutliers.band).toBe('hard');
  });

  it('leaves out «flat raters» who give every task the same value', () => {
    const ratings = [
      ...r([3, 3, 4, 3, 4]),
      { userId: 'spam1', rating: 10 },
      { userId: 'spam2', rating: 10 },
    ];
    const agg = aggregateDifficultyRatings(ratings, new Set(['spam1', 'spam2']));
    expect(agg).toMatchObject({ count: 7, used: 5, median: 3, band: 'easy' });
  });

  it('bands and the effective difficulty used to pick tasks', () => {
    expect([1, 3, 4, 6, 7, 8, 9, 10].map(difficultyBand)).toEqual([
      'easy',
      'easy',
      'medium',
      'medium',
      'hard',
      'hard',
      'very_hard',
      'very_hard',
    ]);
    expect(effectiveDifficulty(2, null)).toBe(2);
    expect(effectiveDifficulty(1, 10)).toBe(2); // authored easy, students say very hard
    expect(effectiveDifficulty(3, 1)).toBe(2);
  });
});
