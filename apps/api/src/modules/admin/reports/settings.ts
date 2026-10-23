import { schema } from '@zybrilka/db';
import type { Database } from '@zybrilka/db';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

/**
 * Admin thresholds (quality signals and alerts), stored in `app_settings`
 * under one key. Every value has a documented default; changes go through
 * PUT /admin/settings and the audit log. Explainable on purpose: each
 * signal says which threshold it crossed.
 */
export const SETTINGS_KEY = 'admin.settings';

export const adminSettingsSchema = z.object({
  quality: z
    .object({
      /** Attempts needed before accuracy-based signals are shown at all. */
      minSample: z.number().int().min(5).max(10_000).default(30),
      /** Accuracy (0..1) below which a task is flagged «очень низкая точность». */
      lowAccuracy: z.number().min(0).max(1).default(0.15),
      /** Drop in accuracy (absolute, 0..1) vs the previous period to flag a spike of errors. */
      accuracyDrop: z.number().min(0.05).max(1).default(0.25),
      /** Open complaints on one task to flag it. */
      complaints: z.number().int().min(1).max(1000).default(2),
      /** Share of guests/users who opened the task but never answered (needs the same min sample of opens). */
      abandonment: z.number().min(0).max(1).default(0.6),
    })
    .default({
      minSample: 30,
      lowAccuracy: 0.15,
      accuracyDrop: 0.25,
      complaints: 2,
      abandonment: 0.6,
    }),
  alerts: z
    .object({
      /** Answers in the last 24h below this share of the 7-day daily average. */
      solvesDropShare: z.number().min(0.05).max(1).default(0.5),
      /** Minimum 7-day daily average of answers before a drop can alert. */
      solvesMinDaily: z.number().int().min(1).max(100_000).default(20),
      /** Server-error (5xx) share of requests in the last hour. */
      errorRate: z.number().min(0.001).max(1).default(0.05),
      errorMinRequests: z.number().int().min(10).max(1_000_000).default(50),
      /** Complaints in the last 24h at least this many times the 30-day daily average… */
      complaintsFactor: z.number().min(1).max(100).default(3),
      /** …and at least this many. */
      complaintsMin: z.number().int().min(1).max(10_000).default(5),
      /** Accuracy in the last 24h differing from the 30-day accuracy by more than this. */
      accuracyShift: z.number().min(0.05).max(1).default(0.15),
      accuracyMinAnswers: z.number().int().min(10).max(1_000_000).default(50),
      /** Failed sign-ins (4xx/5xx from /auth) share in the last hour. */
      authFailureRate: z.number().min(0.01).max(1).default(0.3),
      authMinRequests: z.number().int().min(5).max(1_000_000).default(20),
    })
    .default({
      solvesDropShare: 0.5,
      solvesMinDaily: 20,
      errorRate: 0.05,
      errorMinRequests: 50,
      complaintsFactor: 3,
      complaintsMin: 5,
      accuracyShift: 0.15,
      accuracyMinAnswers: 50,
      authFailureRate: 0.3,
      authMinRequests: 20,
    }),
});
export type AdminSettings = z.infer<typeof adminSettingsSchema>;

export async function loadSettings(db: Database): Promise<AdminSettings> {
  const [row] = await db
    .select({ value: schema.appSettings.value })
    .from(schema.appSettings)
    .where(eq(schema.appSettings.key, SETTINGS_KEY));
  const parsed = adminSettingsSchema.safeParse(row?.value ?? {});
  return parsed.success ? parsed.data : adminSettingsSchema.parse({});
}

export async function saveSettings(db: Database, settings: AdminSettings) {
  await db
    .insert(schema.appSettings)
    .values({ key: SETTINGS_KEY, value: settings, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: schema.appSettings.key,
      set: { value: settings, updatedAt: new Date() },
    });
}

/** External notification channels. Telegram carries the owner notifications
 * set up in «Уведомления» (when the bot token is configured); the threshold
 * alerts of this module are shown in the panel only. No email is sent. */
export function notificationChannels(botConfigured: boolean) {
  return {
    telegram: botConfigured ? 'connected' : 'not_connected',
    email: 'not_connected',
  } as const;
}
