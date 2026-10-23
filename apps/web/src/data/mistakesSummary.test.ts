import { describe, expect, it } from 'vitest';
import { computeMistakesSummary, type Mistake } from './sampleMistakes.js';

const make = (id: string, status: Mistake['status'], repeated = false): Mistake => ({
  id,
  taskId: `t-${id}`,
  taskNumber: 1,
  subjectId: 'math',
  topic: 'Уравнения',
  difficultyLabel: 'Среднее',
  condition: 'x',
  date: '2026-10-01T00:00:00.000Z',
  userAnswer: '1',
  correctAnswer: '2',
  status,
  repeated,
});

describe('computeMistakesSummary', () => {
  it('derives improvement from mistakes solved again, not a fixed figure', () => {
    const s = computeMistakesSummary([
      make('a', 'reviewed'),
      make('b', 'unsolved', true),
      make('c', 'unsolved'),
      make('d', 'reviewed'),
    ]);
    expect(s.improvementPercent).toBe(50);
    expect(s.reviewedAgainCount).toBe(2);
    expect(s.repeatedPercent).toBe(25);
  });

  it('is zero for an empty list', () => {
    expect(computeMistakesSummary([]).improvementPercent).toBe(0);
  });
});
