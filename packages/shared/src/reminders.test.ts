import { describe, expect, it } from 'vitest';
import {
  isValidTimezone,
  localClock,
  minutesOfTime,
  reminderDue,
  reminderSettingsRequestSchema,
  timeOfMinutes,
} from './reminders.js';

describe('reminder time and timezones', () => {
  it('converts times both ways', () => {
    expect(minutesOfTime('00:00')).toBe(0);
    expect(minutesOfTime('19:30')).toBe(1170);
    expect(minutesOfTime('24:00')).toBeNull();
    expect(timeOfMinutes(1170)).toBe('19:30');
  });

  it('reads the local date and time in a timezone', () => {
    const at = new Date('2026-10-24T21:30:00Z');
    expect(localClock(at, 'Europe/Moscow')).toEqual({ date: '2026-10-25', minutes: 30 });
    expect(localClock(at, 'Europe/Kaliningrad')).toEqual({ date: '2026-10-24', minutes: 1410 });
    expect(localClock(at, 'Asia/Vladivostok').date).toBe('2026-10-25');
  });

  it('is due from the chosen minute for two hours, on the local date', () => {
    const tz = 'Europe/Moscow';
    expect(reminderDue(new Date('2026-10-24T15:59:00Z'), tz, 19 * 60).due).toBe(false);
    expect(reminderDue(new Date('2026-10-24T16:00:00Z'), tz, 19 * 60)).toEqual({
      due: true,
      date: '2026-10-24',
    });
    expect(reminderDue(new Date('2026-10-24T17:59:00Z'), tz, 19 * 60).due).toBe(true);
    expect(reminderDue(new Date('2026-10-24T18:00:00Z'), tz, 19 * 60).due).toBe(false);
  });

  it('accepts real IANA zones only', () => {
    expect(isValidTimezone('Europe/Moscow')).toBe(true);
    expect(isValidTimezone('Asia/Yekaterinburg')).toBe(true);
    expect(isValidTimezone('Mars/Olympus')).toBe(false);
    expect(isValidTimezone('../../etc')).toBe(false);
    expect(
      reminderSettingsRequestSchema.safeParse({ enabled: true, time: '7:5', timezone: 'UTC' })
        .success,
    ).toBe(false);
  });
});
