import { describe, expect, it } from 'vitest';
import { toDailyPoints, toTaskNumberProgress } from './progressAdapter.js';

describe('toTaskNumberProgress', () => {
  it('derives the number list from real data, never a hardcoded range', () => {
    const rows = toTaskNumberProgress([]);
    expect(rows).toHaveLength(0);
  });

  it('only includes numbers with real published tasks (total>0), sorted ascending', () => {
    const rows = toTaskNumberProgress([
      {
        subjectId: 'math',
        taskNumber: 21,
        total: 3,
        completed: 1,
        correct: 0,
        incorrect: 0,
        accuracyPercent: null,
      },
      {
        subjectId: 'math',
        taskNumber: 0,
        total: 0,
        completed: 0,
        correct: 0,
        incorrect: 0,
        accuracyPercent: null,
      },
      {
        subjectId: 'math',
        taskNumber: 2,
        total: 4,
        completed: 2,
        correct: 0,
        incorrect: 0,
        accuracyPercent: null,
      },
    ]);
    expect(rows.map((r) => r.number)).toEqual([2, 21]);
  });

  it('a number with completed=0 stays untried even when total>0', () => {
    const rows = toTaskNumberProgress([
      {
        subjectId: 'math',
        taskNumber: 1,
        total: 5,
        completed: 0,
        correct: 0,
        incorrect: 0,
        accuracyPercent: null,
      },
    ]);
    expect(rows[0]).toMatchObject({ number: 1, percent: null, status: 'untried' });
  });

  it('computes completion percent (completed/total), not accuracy', () => {
    const rows = toTaskNumberProgress([
      {
        subjectId: 'math',
        taskNumber: 1,
        total: 4,
        completed: 3,
        correct: 0,
        incorrect: 0,
        accuracyPercent: null,
      },
    ]);
    expect(rows[0]).toMatchObject({ number: 1, percent: 75 });
  });

  it('passes through the real completed/total counts (never invented, for the by-number card UI)', () => {
    const rows = toTaskNumberProgress([
      {
        subjectId: 'math',
        taskNumber: 1,
        total: 4,
        completed: 3,
        correct: 0,
        incorrect: 0,
        accuracyPercent: null,
      },
    ]);
    expect(rows[0]).toMatchObject({ completed: 3, total: 4 });
  });

  it('bands percent into strong/medium/weak', () => {
    const strong = toTaskNumberProgress([
      {
        subjectId: 'math',
        taskNumber: 1,
        total: 10,
        completed: 8,
        correct: 0,
        incorrect: 0,
        accuracyPercent: null,
      },
    ]);
    expect(strong[0]!.status).toBe('strong');

    const medium = toTaskNumberProgress([
      {
        subjectId: 'math',
        taskNumber: 1,
        total: 10,
        completed: 5,
        correct: 0,
        incorrect: 0,
        accuracyPercent: null,
      },
    ]);
    expect(medium[0]!.status).toBe('medium');

    const weak = toTaskNumberProgress([
      {
        subjectId: 'math',
        taskNumber: 1,
        total: 10,
        completed: 1,
        correct: 0,
        incorrect: 0,
        accuracyPercent: null,
      },
    ]);
    expect(weak[0]!.status).toBe('weak');
  });
});

describe('toDailyPoints', () => {
  it('zero-fills every day in the requested range when there is no real data', () => {
    const points = toDailyPoints([], 7);
    expect(points).toHaveLength(7);
    expect(points.every((p) => p.solved === 0 && p.accuracyPercent === 0)).toBe(true);
  });

  it('places a real day at the correct position (today is last)', () => {
    const today = new Date().toISOString().slice(0, 10);
    const points = toDailyPoints([{ date: today, solved: 3, accuracyPercent: 100 }], 7);
    expect(points).toHaveLength(7);
    expect(points[points.length - 1]).toMatchObject({
      date: today,
      solved: 3,
      accuracyPercent: 100,
    });
    expect(points.slice(0, -1).every((p) => p.solved === 0)).toBe(true);
  });

  it('a day outside the requested range is simply not represented', () => {
    const farPast = '2000-01-01';
    const points = toDailyPoints([{ date: farPast, solved: 9, accuracyPercent: 100 }], 7);
    expect(points.every((p) => p.solved === 0)).toBe(true);
  });
});
