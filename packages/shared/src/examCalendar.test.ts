import { describe, expect, it } from 'vitest';
import { daysWordRu, examCountdown, moscowDate, type EgeMainPeriod } from './examCalendar.js';
import { inactivityReminderText } from './reminders.js';

const p2027: EgeMainPeriod = {
  year: 2027,
  firstExamDate: '2027-06-01',
  lastDate: '2027-07-09',
  status: 'approved',
  source: 'test',
};

describe('EGE calendar', () => {
  it('counts whole Moscow calendar days to the first main-period exam', () => {
    // 2026-11-15 00:30 MSK is still 2026-11-14 in UTC.
    expect(moscowDate(new Date('2026-11-14T21:30:00Z'))).toBe('2026-11-15');
    expect(examCountdown(new Date('2026-11-14T21:30:00Z'), [p2027])).toMatchObject({
      kind: 'before',
      days: 198,
    });
    expect(examCountdown(new Date('2027-05-31T20:59:00Z'), [p2027])).toMatchObject({
      kind: 'before',
      days: 1,
    });
  });

  it('the early period is not «the first EGE»: only the configured main period counts', () => {
    // 1 April 2027 — during the early period, the countdown still targets 1 June.
    expect(examCountdown(new Date('2027-04-01T09:00:00Z'), [p2027])).toMatchObject({
      kind: 'before',
      days: 61,
    });
  });

  it('during the main period and after it ends — no countdown', () => {
    expect(examCountdown(new Date('2027-06-01T06:00:00Z'), [p2027]).kind).toBe('during');
    expect(examCountdown(new Date('2027-07-09T20:00:00Z'), [p2027]).kind).toBe('during');
    expect(examCountdown(new Date('2027-07-10T09:00:00Z'), [p2027]).kind).toBe('unknown');
    expect(examCountdown(new Date('2027-07-10T09:00:00Z'), []).kind).toBe('unknown');
  });

  it('moves to the next configured year and follows a changed date', () => {
    const p2028 = { ...p2027, year: 2028, firstExamDate: '2028-05-29', lastDate: '2028-07-05' };
    expect(examCountdown(new Date('2027-08-01T09:00:00Z'), [p2028, p2027])).toMatchObject({
      kind: 'before',
      period: { year: 2028 },
    });
    const moved = { ...p2027, firstExamDate: '2027-06-03' };
    expect(examCountdown(new Date('2027-06-01T09:00:00Z'), [moved])).toMatchObject({
      kind: 'before',
      days: 2,
    });
  });

  it('ignores a malformed entry instead of guessing', () => {
    const broken = { ...p2027, firstExamDate: '2027-13-40' };
    const inverted = { ...p2027, firstExamDate: '2027-08-01' };
    expect(examCountdown(new Date('2027-01-01T09:00:00Z'), [broken, inverted]).kind).toBe(
      'unknown',
    );
  });

  it('Russian plural of days', () => {
    expect([1, 2, 5, 11, 12, 14, 21, 22, 25, 111, 184, 198].map((n) => daysWordRu(n))).toEqual([
      'день',
      'дня',
      'дней',
      'дней',
      'дней',
      'дней',
      'день',
      'дня',
      'дней',
      'дней',
      'дня',
      'дней',
    ]);
  });
});

describe('inactivity reminder text', () => {
  const now = new Date('2026-11-15T09:00:00Z');
  it('has the computed day count; a draft schedule says so', () => {
    expect(inactivityReminderText(now, examCountdown(now, [p2027]))).toBe(
      'Привет! Давно не виделись 👋\n\nДо первого ЕГЭ осталось 198 дней.\n\n' +
        'Не забывай готовиться! Даже 15–20 минут занятий сегодня помогут приблизиться к цели.\n\n' +
        'Загляни в Зубрилку и продолжай свой прогресс 💙',
    );
    const draft = { ...p2027, status: 'project' as const };
    expect(inactivityReminderText(now, examCountdown(now, [draft]))).toContain(
      'осталось 198 дней (по проекту расписания).',
    );
  });
  it('without a configured date: no number at all; during the exams: no message', () => {
    const text = inactivityReminderText(now, { kind: 'unknown' })!;
    expect(text).not.toMatch(/\d+ (день|дня|дней)/);
    expect(text).toContain('Давно не виделись');
    expect(inactivityReminderText(now, { kind: 'during', period: p2027 })).toBeNull();
  });
  it('the default calendar (2027 project) is wired in', () => {
    expect(inactivityReminderText(now)).toContain('До первого ЕГЭ осталось 198 дней');
  });
});
