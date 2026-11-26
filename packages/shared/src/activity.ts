import { z } from 'zod';

/**
 * Active time on the platform (docs/ACTIVE_TIME.md). Time is counted in
 * 30-second slots: a slot counts when the page (site or Telegram Mini App)
 * was visible AND the user did something (tap, key, scroll) in the last
 * minute. The server keeps each user's slots unique, so several tabs or
 * devices at once never count the same moment twice.
 */
export const ACTIVITY_SLOT_SECONDS = 30;
/** No action for this long — the page is open, but nobody is there. */
export const ACTIVITY_IDLE_MS = 60_000;
/** Slots older than this are refused (an offline device catching up is fine). */
export const ACTIVITY_MAX_AGE_HOURS = 48;
export const ACTIVITY_MAX_SLOTS_PER_REQUEST = 240;

/** The start of the slot a moment falls in, in epoch seconds. */
export const activitySlotOf = (ms: number): number =>
  Math.floor(ms / 1000 / ACTIVITY_SLOT_SECONDS) * ACTIVITY_SLOT_SECONDS;

export const activityHeartbeatSchema = z.object({
  /** Slot starts (epoch seconds, multiples of 30) this client was active in. */
  slots: z.array(z.number().int().nonnegative()).min(1).max(ACTIVITY_MAX_SLOTS_PER_REQUEST),
});
export type ActivityHeartbeatRequest = z.infer<typeof activityHeartbeatSchema>;

export interface ActivityHeartbeatResponse {
  /** Slots that were new — counted now. */
  readonly counted: number;
}

export interface ActivityDay {
  /** Moscow date, YYYY-MM-DD. */
  readonly date: string;
  readonly seconds: number;
}

export interface ActivityStatsResponse {
  readonly todaySeconds: number;
  readonly last7Seconds: number;
  readonly last30Seconds: number;
  readonly allSeconds: number;
  /** The last 30 days, oldest first, days without activity as 0. */
  readonly days: readonly ActivityDay[];
  readonly activeDays: number;
}
