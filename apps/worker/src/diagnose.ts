import { adminTelegramChats, createDb, schema, type Database } from '@zybrilka/db';
import { readWorkerStatus, WORKER_STATUS_KEY } from '@zybrilka/shared';
import { eq, sql } from 'drizzle-orm';
import type { Config } from './config.js';
import { createTelegramClient, TelegramApiError } from './telegram/client.js';

/**
 * Read-only diagnostics for the Telegram bot, owner notifications and
 * broadcasts, safe to run on the server:
 *
 *   docker compose -f infra/docker-compose.yml exec worker node dist/diagnoseMain.js
 * (entry point: diagnoseMain.ts)
 *
 * Prints booleans, counts and Telegram's own safe fields only — never the
 * token, never a full webhook URL (its path can be a secret), no user data.
 * Calls only getMe and getWebhookInfo: it sends nothing, changes nothing.
 */
export async function diagnose(
  config: Config,
  deps: { fetch?: typeof fetch; db?: Database } = {},
): Promise<Record<string, unknown>> {
  const report: Record<string, unknown> = {
    config: {
      botTokenSet: Boolean(config.TELEGRAM_BOT_TOKEN),
      polling: config.TELEGRAM_BOT_POLLING,
      healthCheckUrlSet: Boolean(config.API_HEALTH_URL),
      site: new URL(config.WEB_BASE_URL).host,
      owners: config.ADMIN_OWNER_USER_IDS.length,
      databaseUrlSet: Boolean(config.DATABASE_URL),
    },
  };

  if (config.TELEGRAM_BOT_TOKEN) {
    const telegram = createTelegramClient({
      token: config.TELEGRAM_BOT_TOKEN,
      timeoutMs: 10_000,
      ...(deps.fetch ? { fetch: deps.fetch } : {}),
    });
    try {
      const me = await telegram.getMe();
      report.bot = { username: me.username ?? null };
    } catch (error) {
      report.bot = { error: error instanceof TelegramApiError ? error.kind : 'unexpected' };
    }
    try {
      const info = await telegram.getWebhookInfo();
      let host: string | null = null;
      try {
        host = info.url ? new URL(info.url).host : null;
      } catch {
        host = 'unparseable';
      }
      report.webhook = {
        set: Boolean(info.url),
        host,
        pendingUpdateCount: info.pending_update_count,
        lastErrorMessage: info.last_error_message ?? null,
        lastErrorAt: info.last_error_date
          ? new Date(info.last_error_date * 1000).toISOString()
          : null,
        allowedUpdates: info.allowed_updates ?? null,
      };
    } catch (error) {
      report.webhook = { error: error instanceof TelegramApiError ? error.kind : 'unexpected' };
    }
  }

  const database = deps.db ? null : config.DATABASE_URL ? createDb(config.DATABASE_URL) : null;
  const db = deps.db ?? database?.db;
  if (db) {
    try {
      const [chats] = await db
        .select({
          total: sql<number>`count(*)::int`,
          blocked: sql<number>`count(*) FILTER (WHERE blocked_at IS NOT NULL)::int`,
        })
        .from(schema.telegramBotChats);
      const outbox = await db
        .select({
          kind: schema.telegramOutbox.kind,
          status: schema.telegramOutbox.status,
          lastError: schema.telegramOutbox.lastError,
          n: sql<number>`count(*)::int`,
        })
        .from(schema.telegramOutbox)
        .where(sql`${schema.telegramOutbox.createdAt} > now() - interval '7 days'`)
        .groupBy(
          schema.telegramOutbox.kind,
          schema.telegramOutbox.status,
          schema.telegramOutbox.lastError,
        );
      const [status] = await db
        .select({ value: schema.appSettings.value })
        .from(schema.appSettings)
        .where(eq(schema.appSettings.key, WORKER_STATUS_KEY));
      const broadcasts = await db
        .select({ status: schema.broadcasts.status, n: sql<number>`count(*)::int` })
        .from(schema.broadcasts)
        .groupBy(schema.broadcasts.status);
      report.database = {
        botChats: chats,
        ownersWithTelegram: (await adminTelegramChats(db, config.ADMIN_OWNER_USER_IDS)).length,
        outboxLast7Days: outbox,
        broadcasts,
        workerStatus: status ? readWorkerStatus(status.value) : null,
      };
    } catch (error) {
      report.database = { error: (error as { code?: string }).code ?? 'query_failed' };
    } finally {
      await database?.close();
    }
  }
  return report;
}
