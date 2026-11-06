import type { BroadcastAudience } from '@zybrilka/shared';
import { sql, type SQL } from 'drizzle-orm';

/**
 * «Возврат пользователей»: one SQL for both the admin preview (API) and the
 * worker's snapshot, so the number the owner confirms is computed exactly
 * like the list that is sent (docs/TELEGRAM_BOT.md §Рассылки по аудитории).
 *
 * Rows: every registered user matching the filters, with `state`:
 * - `ok` — will receive it (has a linked, unblocked bot chat);
 * - `excluded` — removed by hand;
 * - `no_bot_chat` — no linked chat, or it blocked the bot: the bot can't write;
 * - `notifications_off` — saved notification settings with notifications off;
 * - `stage_sent` — already got a broadcast of this stage (unless `allowRepeat`).
 *
 * «Last activity» = the latest of: an answer (tasks or mini-games), a sign-in
 * (session created) or an analytics event (recorded only with consent).
 * Signed-in visits are not logged otherwise, so a visit without any of these
 * is not seen — the admin page says so.
 */
export function audienceRowsSql(
  a: BroadcastAudience,
  options: { now: Date; broadcastId: string | null },
): SQL {
  const now = options.now.toISOString();
  const day = 86_400_000;
  const ago = (days: number) => new Date(options.now.getTime() - days * day).toISOString();
  const today = sql`((${now}::timestamptz) AT TIME ZONE 'Europe/Moscow')::date`;
  const where: SQL[] = [sql`EXISTS (SELECT 1 FROM auth_identities ai WHERE ai.user_id = u.id)`];

  if (a.registeredFrom) {
    where.push(sql`(u.created_at AT TIME ZONE 'Europe/Moscow')::date >= ${a.registeredFrom}::date`);
  }
  if (a.registeredTo) {
    where.push(sql`(u.created_at AT TIME ZONE 'Europe/Moscow')::date <= ${a.registeredTo}::date`);
  }
  // Age in full days: age >= min ⇔ created <= now − min; age <= max ⇔ created > now − (max + 1).
  if (a.accountAgeMinDays !== undefined) {
    where.push(sql`u.created_at <= ${ago(a.accountAgeMinDays)}::timestamptz`);
  }
  if (a.accountAgeMaxDays !== undefined) {
    where.push(sql`u.created_at > ${ago(a.accountAgeMaxDays + 1)}::timestamptz`);
  }
  if (a.inactiveMinDays !== undefined) {
    where.push(
      sql`(f.last_active IS NULL OR f.last_active <= ${ago(a.inactiveMinDays)}::timestamptz)`,
    );
  }
  if (a.activeWithinDays !== undefined) {
    where.push(sql`f.last_active > ${ago(a.activeWithinDays)}::timestamptz`);
  }
  if (a.activeDaysMin !== undefined) where.push(sql`f.active_days >= ${a.activeDaysMin}`);
  if (a.activeDaysMax !== undefined) where.push(sql`f.active_days <= ${a.activeDaysMax}`);
  if (a.solvedMin !== undefined) where.push(sql`f.solved >= ${a.solvedMin}`);
  if (a.solvedMax !== undefined) where.push(sql`f.solved <= ${a.solvedMax}`);
  if (a.subjects.length > 0) {
    where.push(
      sql`EXISTS (SELECT 1 FROM user_subject_profiles p WHERE p.user_id = u.id AND p.subject_id IN ${a.subjects})`,
    );
  }
  if (a.miniGames !== 'any') {
    const played = sql`EXISTS (SELECT 1 FROM mini_game_answers g WHERE g.user_id = u.id)`;
    where.push(a.miniGames === 'played' ? played : sql`NOT ${played}`);
  }

  const excluded = a.excludeUserIds.length > 0 ? sql`u.id IN ${a.excludeUserIds}` : sql`false`;
  const stageSent =
    a.stage && !a.allowRepeat
      ? sql`EXISTS (
          SELECT 1 FROM broadcast_deliveries d JOIN broadcasts b ON b.id = d.broadcast_id
          WHERE d.user_id = u.id AND b.stage = ${a.stage}
            AND d.status IN ('pending', 'in_flight', 'sent')
            ${options.broadcastId ? sql`AND b.id <> ${options.broadcastId}` : sql``})`
      : sql`false`;

  return sql`
    WITH chat AS (
      SELECT DISTINCT ON (c.user_id) c.user_id, c.chat_id
      FROM telegram_bot_chats c
      WHERE c.user_id IS NOT NULL AND c.blocked_at IS NULL
      ORDER BY c.user_id, c.last_started_at DESC
    )
    SELECT u.id AS user_id,
      ch.chat_id,
      coalesce(nullif(u.display_name, ''), nullif(trim(concat_ws(' ', u.first_name, u.last_name)), '')) AS name,
      u.created_at::text AS registered_at,
      f.last_active::text AS last_active,
      f.solved::int AS solved,
      CASE
        WHEN ${excluded} THEN 'excluded'
        WHEN ch.chat_id IS NULL THEN 'no_bot_chat'
        WHEN EXISTS (SELECT 1 FROM reminder_settings r WHERE r.user_id = u.id AND NOT r.enabled) THEN 'notifications_off'
        WHEN ${stageSent} THEN 'stage_sent'
        ELSE 'ok'
      END AS state
    FROM users u
    CROSS JOIN LATERAL (
      SELECT
        greatest(
          (SELECT max(t.created_at) FROM attempts t WHERE t.user_id = u.id),
          (SELECT max(g.created_at) FROM mini_game_answers g WHERE g.user_id = u.id),
          (SELECT max(s.created_at) FROM auth_sessions s WHERE s.user_id = u.id),
          (SELECT max(e.occurred_at) FROM analytics_events e WHERE e.user_id = u.id)
        ) AS last_active,
        (SELECT count(*) FROM user_daily_activity x
          WHERE x.user_id = u.id AND x.activity_date::date > ${today} - ${a.activityWindowDays}::int) AS active_days,
        (SELECT count(DISTINCT t.task_id) FROM attempts t WHERE t.user_id = u.id AND t.is_correct) AS solved
    ) f
    LEFT JOIN chat ch ON ch.user_id = u.id
    WHERE ${sql.join(where, sql` AND `)}`;
}

export type AudienceState = 'ok' | 'excluded' | 'no_bot_chat' | 'notifications_off' | 'stage_sent';

export interface AudienceRow {
  user_id: string;
  chat_id: number | string | null;
  name: string | null;
  registered_at: string;
  last_active: string | null;
  solved: number;
  state: AudienceState;
}
