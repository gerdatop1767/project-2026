import { describe, expect, it } from 'vitest';
import {
  bucketOf,
  bucketStarts,
  changePercent,
  moscowDate,
  PeriodError,
  resolvePeriod,
} from './period.js';

// 2026-03-10 22:30 UTC is already 2026-03-11 01:30 in Moscow.
const NOW = new Date('2026-03-10T22:30:00Z');

describe('admin report periods (Europe/Moscow days)', () => {
  it('uses the Moscow calendar day, not UTC', () => {
    expect(moscowDate(NOW)).toBe('2026-03-11');
    const p = resolvePeriod({ period: 'today' }, NOW);
    expect(p).toMatchObject({ from: '2026-03-11', to: '2026-03-11', days: 1 });
    expect(p.startUtc.toISOString()).toBe('2026-03-10T21:00:00.000Z');
    expect(p.endUtc.toISOString()).toBe('2026-03-11T21:00:00.000Z');
  });

  it('compares with the same number of days right before', () => {
    const p = resolvePeriod({ period: '7d' }, NOW);
    expect(p).toMatchObject({ from: '2026-03-05', to: '2026-03-11', days: 7 });
    expect(p.previous).toMatchObject({ from: '2026-02-26', to: '2026-03-04', days: 7 });
  });

  it('handles calendar months (incl. February)', () => {
    expect(resolvePeriod({ period: 'month' }, NOW)).toMatchObject({
      from: '2026-03-01',
      to: '2026-03-11',
    });
    expect(resolvePeriod({ period: 'prev_month' }, NOW)).toMatchObject({
      from: '2026-02-01',
      to: '2026-02-28',
      days: 28,
    });
    expect(resolvePeriod({ period: 'yesterday' }, NOW)).toMatchObject({
      from: '2026-03-10',
      to: '2026-03-10',
    });
  });

  it('validates custom ranges', () => {
    expect(
      resolvePeriod({ period: 'custom', from: '2026-01-01', to: '2026-01-31' }, NOW),
    ).toMatchObject({ days: 31, granularity: 'day' });
    // The future is clipped to today.
    expect(resolvePeriod({ period: 'custom', from: '2026-03-01', to: '2026-12-31' }, NOW).to).toBe(
      '2026-03-11',
    );
    for (const bad of [
      { period: 'custom' as const },
      { period: 'custom' as const, from: '2026-02-30', to: '2026-03-01' },
      { period: 'custom' as const, from: '2026-03-05', to: '2026-03-01' },
      { period: 'custom' as const, from: '2026-04-01', to: '2026-04-02' },
      { period: 'custom' as const, from: '2010-01-01', to: '2026-01-01' },
    ]) {
      expect(() => resolvePeriod(bad, NOW)).toThrow(PeriodError);
    }
  });

  it('never divides by a zero base', () => {
    expect(changePercent(5, 0)).toBeNull();
    expect(changePercent(0, 0)).toBeNull();
    expect(changePercent(15, 10)).toBe(50);
    expect(changePercent(5, 10)).toBe(-50);
  });

  it('buckets by day / ISO week / month with explicit empty buckets', () => {
    const p = resolvePeriod({ period: 'custom', from: '2026-03-01', to: '2026-03-11' }, NOW);
    expect(bucketStarts(p, 'day')).toHaveLength(11);
    expect(bucketOf('2026-03-11', 'week')).toBe('2026-03-09'); // Wednesday → Monday
    expect(bucketStarts(p, 'week')).toEqual(['2026-02-23', '2026-03-02', '2026-03-09']);
    expect(bucketStarts(p, 'month')).toEqual(['2026-03-01']);
  });
});
