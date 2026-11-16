import type { Database } from '@zybrilka/db';
import { schema } from '@zybrilka/db';
import { DEFAULT_NOTIFICATION_PREFERENCES, type NotificationPreferences } from '@zybrilka/shared';
import { eq } from 'drizzle-orm';

/**
 * Progress notification settings (docs/learning/PERSONAL-PLANS.md §
 * Уведомления). No row: the defaults — unless the student switched
 * notifications off in the daily-reminder settings (`enabled = false`), which
 * has always meant «no notifications» for broadcasts too; then everything
 * is off until they choose otherwise here.
 */
export async function getPreferences(
  db: Database,
  userId: string,
): Promise<NotificationPreferences & { explicit: boolean }> {
  const [row] = await db
    .select()
    .from(schema.notificationPreferences)
    .where(eq(schema.notificationPreferences.userId, userId));
  if (row) {
    return {
      progressEnabled: row.progressEnabled,
      planRemindersEnabled: row.planRemindersEnabled,
      frequency: row.frequency,
      explicit: true,
    };
  }
  const [daily] = await db
    .select({ enabled: schema.reminderSettings.enabled })
    .from(schema.reminderSettings)
    .where(eq(schema.reminderSettings.userId, userId));
  if (daily && !daily.enabled) {
    return {
      progressEnabled: false,
      planRemindersEnabled: false,
      frequency: 'normal',
      explicit: false,
    };
  }
  return { ...DEFAULT_NOTIFICATION_PREFERENCES, explicit: false };
}

export async function savePreferences(
  db: Database,
  userId: string,
  prefs: NotificationPreferences,
): Promise<NotificationPreferences & { explicit: boolean }> {
  await db
    .insert(schema.notificationPreferences)
    .values({ userId, ...prefs, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: schema.notificationPreferences.userId,
      set: { ...prefs, updatedAt: new Date() },
    });
  return { ...prefs, explicit: true };
}
