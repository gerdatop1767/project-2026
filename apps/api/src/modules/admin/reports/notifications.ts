import { adminTelegramReadiness, schema } from '@zybrilka/db';
import type { Database } from '@zybrilka/db';
import {
  ADMIN_NOTIFICATIONS_KEY,
  adminNotificationSettingsSchema,
  readAdminNotificationSettings,
  readWorkerStatus,
  WORKER_STATUS_KEY,
  type AdminNotificationSettings,
} from '@zybrilka/shared';
import { eq, sql } from 'drizzle-orm';
import { rows } from './common.js';

export { adminNotificationSettingsSchema };

export async function loadNotificationSettings(db: Database): Promise<AdminNotificationSettings> {
  const [row] = await db
    .select({ value: schema.appSettings.value })
    .from(schema.appSettings)
    .where(eq(schema.appSettings.key, ADMIN_NOTIFICATIONS_KEY));
  return readAdminNotificationSettings(row?.value);
}

/** The worker's own report (null: never ran this version / no database row). */
export async function loadWorkerStatus(db: Database) {
  const [row] = await db
    .select({ value: schema.appSettings.value })
    .from(schema.appSettings)
    .where(eq(schema.appSettings.key, WORKER_STATUS_KEY));
  return row ? readWorkerStatus(row.value) : null;
}

export async function saveNotificationSettings(db: Database, settings: AdminNotificationSettings) {
  await db
    .insert(schema.appSettings)
    .values({ key: ADMIN_NOTIFICATIONS_KEY, value: settings, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: schema.appSettings.key,
      set: { value: settings, updatedAt: new Date() },
    });
}

/** Everything the «Уведомления» page shows: the switches, whether delivery
 * can work at all (token, owner linked to Telegram, bot started) and the
 * queue's recent health. */
export async function notificationsReport(
  db: Database,
  ownerIds: readonly string[],
  botConfigured: boolean,
) {
  const [queue] = await rows<{
    pending: number;
    failed24h: number;
    sent24h: number;
    lastSentAt: string | null;
  }>(
    db,
    sql`SELECT
      count(*) FILTER (WHERE status IN ('pending', 'sending'))::int AS pending,
      count(*) FILTER (WHERE status = 'failed' AND created_at > now() - interval '24 hours')::int AS "failed24h",
      count(*) FILTER (WHERE status = 'sent' AND sent_at > now() - interval '24 hours')::int AS "sent24h",
      max(sent_at)::text AS "lastSentAt"
      FROM telegram_outbox`,
  );
  // The latest finished attempt — says in one word why nothing arrives
  // (`not_started`: the owner has not pressed Start; `no_recipients`: no
  // owner with Telegram; `disabled`: switched off).
  const [last] = await rows<{ status: string; lastError: string | null; at: string }>(
    db,
    sql`SELECT status, last_error AS "lastError", coalesce(sent_at, created_at)::text AS at
      FROM telegram_outbox WHERE status IN ('sent', 'failed', 'skipped')
      ORDER BY coalesce(sent_at, created_at) DESC LIMIT 1`,
  );
  return {
    settings: await loadNotificationSettings(db),
    delivery: { botConfigured, ...(await adminTelegramReadiness(db, ownerIds)) },
    worker: await loadWorkerStatus(db),
    lastResult: last ?? null,
    queue: queue ?? { pending: 0, failed24h: 0, sent24h: 0, lastSentAt: null },
  };
}
