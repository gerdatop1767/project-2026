import { describe, expect, it } from 'vitest';
import { REVIEW_RULE, decideTaskXp, reviewXpValue, taskXpValue } from './rules.js';

const task = (difficulty: number, subjectId = 'math') => ({
  id: '00000000-0000-4000-8000-000000000001',
  subjectId,
  taskNumber: 3,
  difficulty,
});
const now = new Date('2026-10-23T10:00:00Z');

describe('XP rules', () => {
  it('maps difficulty to the documented values', () => {
    expect([1, 2, 3, 4].map((d) => taskXpValue(task(d)).amount)).toEqual([10, 15, 25, 35]);
    expect(taskXpValue(task(0))).toEqual({ amount: 15, difficultyKnown: false });
  });

  it('values every subject the same at equal difficulty', () => {
    for (const subject of ['math', 'russian', 'physics', 'history', 'unknown-subject']) {
      expect(taskXpValue(task(3, subject)).amount).toBe(25);
    }
  });

  it('nothing for a wrong answer', () => {
    expect(
      decideTaskXp({ task: task(3), correct: false, lastAwardAt: null, now, moscowDate: 'd' }),
    ).toBeNull();
  });

  it('first solve gets full value under a stable key', () => {
    expect(
      decideTaskXp({ task: task(3), correct: true, lastAwardAt: null, now, moscowDate: 'd' }),
    ).toMatchObject({ kind: 'task_first_solve', amount: 25, dedupKey: `task:${task(3).id}:first` });
  });

  it('review only after the waiting period, keyed by day', () => {
    const justBefore = new Date(
      now.getTime() - (REVIEW_RULE.minDaysSinceLastAward * 86_400_000 - 1),
    );
    expect(
      decideTaskXp({ task: task(3), correct: true, lastAwardAt: justBefore, now, moscowDate: 'd' }),
    ).toBeNull();
    const long = new Date(now.getTime() - REVIEW_RULE.minDaysSinceLastAward * 86_400_000);
    expect(
      decideTaskXp({
        task: task(3),
        correct: true,
        lastAwardAt: long,
        now,
        moscowDate: '2026-10-23',
      }),
    ).toMatchObject({
      kind: 'task_review',
      amount: 8,
      dedupKey: `task:${task(3).id}:review:2026-10-23`,
    });
  });

  it('a review is never below the floor', () => {
    expect(reviewXpValue(task(1))).toBe(3);
  });
});
