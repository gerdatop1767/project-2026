import { z } from 'zod';

/**
 * Owner-only Telegram notifications (docs/TELEGRAM_BOT.md): which kinds are
 * on, and what each queued notification carries. Turning a kind off only
 * stops the Telegram message — registrations, complaints and error logging
 * carry on exactly as before.
 */
export const ADMIN_NOTIFICATIONS_KEY = 'admin.notifications';

export const adminNotificationSettingsSchema = z.object({
  registrations: z.boolean().default(true),
  siteErrors: z.boolean().default(true),
  complaints: z.boolean().default(true),
});
export type AdminNotificationSettings = z.infer<typeof adminNotificationSettingsSchema>;

/** Stored value → settings; anything unreadable falls back to the defaults. */
export function readAdminNotificationSettings(value: unknown): AdminNotificationSettings {
  const parsed = adminNotificationSettingsSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : adminNotificationSettingsSchema.parse({});
}

export interface RegistrationNotification {
  userId: string;
  method: string;
  at: string;
  campaign: string | null;
}

export interface ComplaintNotification {
  complaintId: string;
  reportNumber: number;
  subjectName: string | null;
  taskId: string;
  taskNumber: number | null;
  reason: string;
  comment: string | null;
  at: string;
}

export interface SiteErrorNotification {
  method: string;
  route: string;
  status: number;
  /** Error class / code only — never the message, which can carry user data. */
  error: string;
  /** Same errors suppressed since the previous notification for this key. */
  suppressed: number;
  firstAt: string;
  at: string;
}

export type OutboxPayload =
  | { kind: 'registration'; data: RegistrationNotification }
  | { kind: 'complaint'; data: ComplaintNotification }
  | { kind: 'site_error'; data: SiteErrorNotification }
  | { kind: 'test'; data: { at: string } };

export type OutboxKind = OutboxPayload['kind'];

/** Which setting switches a kind off (`test` always goes out). */
export const outboxKindSetting: Record<OutboxKind, keyof AdminNotificationSettings | null> = {
  registration: 'registrations',
  complaint: 'complaints',
  site_error: 'siteErrors',
  test: null,
};

/**
 * What the worker reports about itself (app_settings, refreshed every
 * minute), so the admin panel can say why nothing is delivered without
 * anyone reading server logs. Booleans and counts only — never a token.
 */
export const WORKER_STATUS_KEY = 'worker.status';

export const workerStatusSchema = z.object({
  at: z.string(),
  botConfigured: z.boolean(),
  /** Reads bot updates (/start) — TELEGRAM_BOT_POLLING. */
  polling: z.boolean(),
  /** Probes the API's /health for outages — API_HEALTH_URL set. */
  healthCheck: z.boolean(),
  owners: z.number().int().min(0),
});
export type WorkerStatus = z.infer<typeof workerStatusSchema>;

/** A status older than this means the worker is not running (or not this version). */
export const WORKER_STATUS_STALE_MS = 3 * 60 * 1000;

export function readWorkerStatus(value: unknown, now = Date.now()) {
  const parsed = workerStatusSchema.safeParse(value);
  if (!parsed.success) return null;
  return { ...parsed.data, stale: now - Date.parse(parsed.data.at) > WORKER_STATUS_STALE_MS };
}
