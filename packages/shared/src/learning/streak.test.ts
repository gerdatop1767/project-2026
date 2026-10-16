import { describe, expect, it } from 'vitest';
import { computeCurrentStreak, toMoscowDateString } from './streak.js';

describe('toMoscowDateString', () => {
  it('resolves a UTC instant to its Europe/Moscow calendar date, not the UTC date', () => {
    // 23:30 UTC on Oct 1 is 02:30 Moscow (UTC+3) on Oct 2 — a naive
    // `toISOString().slice(0, 10)` would wrongly say Oct 1.
    expect(toMoscowDateString(new Date('2026-10-01T23:30:00.000Z'))).toBe('2026-10-02');
  });

  it('23:59:59 Moscow and 00:00:01 Moscow land on different calendar days', () => {
    // 20:59:59 UTC = 23:59:59 Moscow (Oct 1)
    expect(toMoscowDateString(new Date('2026-10-01T20:59:59.000Z'))).toBe('2026-10-01');
    // 21:00:01 UTC = 00:00:01 Moscow (Oct 2)
    expect(toMoscowDateString(new Date('2026-10-01T21:00:01.000Z'))).toBe('2026-10-02');
  });

  it('browser/server local timezone never affects the result (pure UTC-instant -> Moscow mapping)', () => {
    // Same instant, constructed two different ways — must agree.
    const a = new Date('2026-10-02T10:00:00.000Z');
    const b = new Date(Date.UTC(2026, 9, 2, 10, 0, 0));
    expect(toMoscowDateString(a)).toBe(toMoscowDateString(b));
  });
});

describe('computeCurrentStreak', () => {
  it('a single active day (today) is a streak of 1', () => {
    expect(computeCurrentStreak(['2026-10-03'], '2026-10-03')).toBe(1);
  });

  it('three consecutive active days ending today = 3', () => {
    expect(computeCurrentStreak(['2026-10-01', '2026-10-02', '2026-10-03'], '2026-10-03')).toBe(3);
  });

  it('a gap breaks the chain — only the run ending today/yesterday counts', () => {
    // Oct 1 active, Oct 2 missed, Oct 3 (today) active.
    expect(computeCurrentStreak(['2026-10-01', '2026-10-03'], '2026-10-03')).toBe(1);
  });

  it('no activity today still shows the streak held from yesterday (not yet broken)', () => {
    const sevenDays = [
      '2026-09-26',
      '2026-09-27',
      '2026-09-28',
      '2026-09-29',
      '2026-09-30',
      '2026-10-01',
      '2026-10-02',
    ];
    expect(computeCurrentStreak(sevenDays, '2026-10-03')).toBe(7);
  });

  it('solving today after a streak ending yesterday extends it by exactly 1', () => {
    const sixDays = [
      '2026-09-27',
      '2026-09-28',
      '2026-09-29',
      '2026-09-30',
      '2026-10-01',
      '2026-10-02',
    ];
    expect(computeCurrentStreak([...sixDays, '2026-10-03'], '2026-10-03')).toBe(7);
  });

  it('2+ days of no activity (including today) resets the displayed streak to 0', () => {
    expect(computeCurrentStreak(['2026-09-28'], '2026-10-03')).toBe(0);
  });

  it('solving again the same day never counts the day twice (unique-day input is assumed, duplicates are harmless)', () => {
    expect(computeCurrentStreak(['2026-10-03', '2026-10-03'], '2026-10-03')).toBe(1);
  });

  it('a brand-new user with zero activity has a streak of 0', () => {
    expect(computeCurrentStreak([], '2026-10-03')).toBe(0);
  });

  it('accepts a Set as well as an array, with the same result', () => {
    const arr = ['2026-10-02', '2026-10-03'];
    expect(computeCurrentStreak(new Set(arr), '2026-10-03')).toBe(
      computeCurrentStreak(arr, '2026-10-03'),
    );
  });
});
