import { z } from 'zod';
import type { BroadcastPart } from './telegramHtml.js';

/**
 * «Возврат пользователей» — who a targeted broadcast goes to
 * (docs/TELEGRAM_BOT.md §Рассылки по аудитории). A broadcast without an
 * audience goes, as before, to every chat that started the bot; with one,
 * only to registered users that match every filter set here AND have a
 * linked, unblocked bot chat — the only way the bot may write to someone.
 *
 * Always left out, whatever the filters: users who turned notifications off
 * (a saved `reminder_settings` row with `enabled = false`), and — unless
 * `allowRepeat` — users who already got a broadcast of the same stage.
 */
export const broadcastStages = ['d3', 'd7', 'd20'] as const;
export type BroadcastStage = (typeof broadcastStages)[number];

/** The three ready categories: account age windows (days since registration). */
export const BROADCAST_STAGE_PRESETS: Record<
  BroadcastStage,
  { label: string; accountAgeMinDays: number; accountAgeMaxDays: number }
> = {
  d3: { label: '3 дня после регистрации', accountAgeMinDays: 3, accountAgeMaxDays: 6 },
  d7: { label: '7 дней после регистрации', accountAgeMinDays: 7, accountAgeMaxDays: 19 },
  d20: { label: '20 дней после регистрации', accountAgeMinDays: 20, accountAgeMaxDays: 89 },
};

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const days = z.number().int().min(0).max(3650);
const count = z.number().int().min(0).max(1_000_000);

export const broadcastAudienceSchema = z
  .object({
    /** Ready category; also the «already got this stage» guard. */
    stage: z.enum(broadcastStages).nullable().default(null),
    /** Explicit admin decision to send the same stage again. */
    allowRepeat: z.boolean().default(false),
    /** Registration date range (Moscow dates, inclusive). */
    registeredFrom: isoDate.optional(),
    registeredTo: isoDate.optional(),
    /** Account age in full days. */
    accountAgeMinDays: days.optional(),
    accountAgeMaxDays: days.optional(),
    /** Last activity (answer, sign-in or consented analytics event): at least N days ago… */
    inactiveMinDays: days.optional(),
    /** …or within the last N days. */
    activeWithinDays: days.optional(),
    /** Days with at least one answer within the last `activityWindowDays`. */
    activityWindowDays: z.number().int().min(1).max(365).default(7),
    activeDaysMin: days.optional(),
    activeDaysMax: days.optional(),
    /** Tasks answered correctly, all time. */
    solvedMin: count.optional(),
    solvedMax: count.optional(),
    /** Chose at least one of these subjects (empty: any). */
    subjects: z.array(z.string().min(1).max(40)).max(20).default([]),
    /** Played any mini-game (signed-in answers). */
    miniGames: z.enum(['any', 'played', 'not_played']).default('any'),
    /** Removed by hand from this broadcast. */
    excludeUserIds: z.array(z.uuid()).max(5000).default([]),
  })
  .strict();

export type BroadcastAudience = z.infer<typeof broadcastAudienceSchema>;
export type BroadcastAudienceInput = z.input<typeof broadcastAudienceSchema>;

/** One matching user in the admin preview — no contacts, no chat id. */
export interface BroadcastAudienceUser {
  readonly id: string;
  readonly name: string | null;
  readonly registeredAt: string;
  readonly lastActiveAt: string | null;
  readonly solved: number;
}

export interface BroadcastAudiencePreview {
  /** Will receive it if confirmed now. */
  readonly count: number;
  /** Match the filters but are left out — and why. */
  readonly leftOut: {
    readonly noBotChat: number;
    readonly notificationsOff: number;
    readonly stageAlreadySent: number;
    readonly excludedByHand: number;
  };
  readonly sample: readonly BroadcastAudienceUser[];
}

/** Button under a tracked broadcast: one link per recipient. */
export const BROADCAST_BUTTON_TEXT_MAX = 40;
export const DEFAULT_BROADCAST_BUTTON_TEXT = 'Открыть Зубрилку';

/**
 * A button can go under a text message or a single photo — Telegram has no
 * buttons on an album, so a tracked broadcast with several images must send
 * its text separately (the button goes under the text).
 */
export function broadcastButtonFits(parts: readonly BroadcastPart[]): boolean {
  const last = parts[parts.length - 1];
  return last?.kind === 'text' || last?.kind === 'photo';
}

/** The tracked link of one recipient (`/api/v1/go/b/:token`). */
export function broadcastClickUrl(webBaseUrl: string, token: string): string {
  return new URL(`/api/v1/go/b/${token}`, webBaseUrl).toString();
}
