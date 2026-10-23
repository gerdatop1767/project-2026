import { adminTelegramReadiness, schema } from '@zybrilka/db';
import type { Database } from '@zybrilka/db';
import {
  ADMIN_NOTIFICATIONS_KEY,
  adminNotificationSettingsSchema,
  readAdminNotificationSettings,
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
  return {
    settings: await loadNotificationSettings(db),
    delivery: { botConfigured, ...(await adminTelegramReadiness(db, ownerIds)) },
    queue: queue ?? { pending: 0, failed24h: 0, sent24h: 0, lastSentAt: null },
  };
}
