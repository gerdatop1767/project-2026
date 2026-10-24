import { z } from 'zod';

/**
 * Daily Telegram reminders (docs/REMINDERS.md): the site's settings and
 * the bot's message. Times are local to the chosen IANA timezone.
 */
export const REMINDER_DEFAULT_TIME = '19:00';
export const REMINDER_DEFAULT_TIMEZONE = 'Europe/Moscow';
/** A reminder later than this after its time is skipped for the day (the
 * worker was down): a 19:00 nudge at 23:30 helps nobody. */
export const REMINDER_LATE_WINDOW_MINUTES = 120;

export const reminderText = '📚 Время потренироваться! Реши несколько заданий ЕГЭ сегодня.';

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** «HH:MM» → minutes after midnight. */
export function minutesOfTime(time: string): number | null {
  const match = TIME_RE.exec(time);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

export function timeOfMinutes(minutes: number): string {
  const m = ((Math.floor(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** A timezone the runtime understands (IANA name). */
export function isValidTimezone(timezone: string): boolean {
  if (!/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+){0,2}$/.test(timezone) && timezone !== 'UTC') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/** The calendar date (YYYY-MM-DD) and minutes after midnight at `now` in `timezone`. */
export function localClock(now: Date, timezone: string): { date: string; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
  };
}

/** Whether a reminder set for `minuteOfDay` is due at `now` (and not too late). */
export function reminderDue(
  now: Date,
  timezone: string,
  minuteOfDay: number,
): { due: boolean; date: string } {
  const clock = localClock(now, timezone);
  const late = clock.minutes - minuteOfDay;
  return { due: late >= 0 && late < REMINDER_LATE_WINDOW_MINUTES, date: clock.date };
}

export const reminderSettingsRequestSchema = z.object({
  enabled: z.boolean(),
  time: z.string().regex(TIME_RE),
  timezone: z.string().max(64).refine(isValidTimezone, 'invalid timezone'),
});
export type ReminderSettingsRequest = z.infer<typeof reminderSettingsRequestSchema>;

export const reminderSettingsResponseSchema = z.object({
  enabled: z.boolean(),
  time: z.string(),
  timezone: z.string(),
  telegram: z.object({
    /** A Telegram account is attached to this site account. */
    linked: z.boolean(),
    /** That Telegram account pressed Start in the bot. */
    botStarted: z.boolean(),
    /** Telegram says the bot is blocked by the user. */
    blocked: z.boolean(),
    /** A Telegram account confirmed this account's link in the bot and
     * waits for the owner's confirmation here. Only its display name. */
    pendingLink: z.object({ name: z.string() }).nullable(),
  }),
});
export type ReminderSettingsResponse = z.infer<typeof reminderSettingsResponseSchema>;

export const telegramLinkResponseSchema = z.object({
  /** One-time token for `t.me/<bot>?start=link_<token>`. */
  token: z.string(),
  expiresAt: z.iso.datetime(),
});
export type TelegramLinkResponse = z.infer<typeof telegramLinkResponseSchema>;

export const telegramLinkConfirmRequestSchema = z.object({ accept: z.boolean() });
export type TelegramLinkConfirmRequest = z.infer<typeof telegramLinkConfirmRequestSchema>;

export const telegramLinkConfirmResponseSchema = z.object({
  status: z.enum([
    'linked',
    'already_linked',
    'taken',
    'provider_already_used',
    'nothing_pending',
    'rejected',
  ]),
  settings: reminderSettingsResponseSchema,
});
export type TelegramLinkConfirmResponse = z.infer<typeof telegramLinkConfirmResponseSchema>;
