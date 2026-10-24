import { adminTelegramChats, schema } from '@zybrilka/db';
import type { Database } from '@zybrilka/db';
import {
  ADMIN_NOTIFICATIONS_KEY,
  outboxKindSetting,
  readAdminNotificationSettings,
  type AdminNotificationSettings,
  type OutboxPayload,
} from '@zybrilka/shared';
import { eq, inArray, sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import { TelegramApiError, type TelegramClient } from '../telegram/client.js';
import { renderNotification, type Rendered } from './format.js';

const RECIPIENTS_TTL_MS = 5 * 60 * 1000;
const SETTINGS_TTL_MS = 30 * 1000;
/** A claimed row not finished within this long (worker crashed) is retried. */
const LEASE = sql`interval '5 minutes'`;
const MAX_ATTEMPTS = 5;

export interface AdminNotifierOptions {
  db: Database;
  telegram: TelegramClient;
  ownerIds: readonly string[];
  siteUrl: string;
  logger: Logger;
  now?: () => number;
}

type Row = typeof schema.telegramOutbox.$inferSelect;

/**
 * Sends owner notifications (docs/TELEGRAM_BOT.md): the queued ones from
 * `telegram_outbox`, and direct ones (site down / recovered) that must go
 * out even when the database itself is what failed — hence the cached
 * recipient list and settings, refreshed while the database answers.
 */
export class AdminNotifier {
  private recipients: { chats: number[]; at: number } | null = null;
  private settingsCache: { value: AdminNotificationSettings; at: number } | null = null;
  private readonly now: () => number;

  constructor(private readonly o: AdminNotifierOptions) {
    this.now = o.now ?? Date.now;
  }

  async adminChats(): Promise<number[]> {
    if (this.recipients && this.now() - this.recipients.at < RECIPIENTS_TTL_MS) {
      return this.recipients.chats;
    }
    try {
      const chats = await adminTelegramChats(this.o.db, this.o.ownerIds);
      this.recipients = { chats, at: this.now() };
    } catch (err) {
      // Database down: keep using the last known list.
      this.o.logger.warn({ err }, 'admin recipients: using the cached list');
    }
    return this.recipients?.chats ?? [];
  }

  async settings(): Promise<AdminNotificationSettings> {
    if (this.settingsCache && this.now() - this.settingsCache.at < SETTINGS_TTL_MS) {
      return this.settingsCache.value;
    }
    try {
      const [row] = await this.o.db
        .select({ value: schema.appSettings.value })
        .from(schema.appSettings)
        .where(eq(schema.appSettings.key, ADMIN_NOTIFICATIONS_KEY));
      this.settingsCache = { value: readAdminNotificationSettings(row?.value), at: this.now() };
    } catch {
      // Database down: last known (or default) settings.
    }
    return this.settingsCache?.value ?? readAdminNotificationSettings(undefined);
  }

  /**
   * Sends one message to every admin chat. `sent` when at least one got it;
   * otherwise the most actionable failure (rate limit first, then network).
   */
  async deliver(
    rendered: Rendered,
  ): Promise<
    | { status: 'sent' }
    | { status: 'no_recipients' }
    | { status: 'failed'; error: TelegramApiError | Error }
  > {
    const chats = await this.adminChats();
    if (chats.length === 0) return { status: 'no_recipients' };
    let delivered = 0;
    let worst: TelegramApiError | Error | null = null;
    for (const chatId of chats) {
      try {
        await this.o.telegram.sendMessage(chatId, rendered.text, {
          parseMode: 'HTML',
          replyMarkup: rendered.keyboard,
          disablePreview: true,
        });
        delivered++;
      } catch (error) {
        // 403 here means the owner has not pressed Start in the bot (or
        // blocked it): nothing to mark — it works as soon as they do.
        if (!worst || (error instanceof TelegramApiError && error.kind === 'rate_limited')) {
          worst = error as Error;
        }
      }
    }
    return delivered > 0 ? { status: 'sent' } : { status: 'failed', error: worst! };
  }

  /** Direct message, outside the queue (site down / recovered). */
  async sendDirect(text: string, setting: keyof AdminNotificationSettings) {
    if (!(await this.settings())[setting]) return;
    const result = await this.deliver({ text });
    if (result.status !== 'sent') {
      this.o.logger.warn({ status: result.status }, 'direct admin notification not delivered');
    }
  }

  private async finish(id: string, set: Partial<Row>) {
    await this.o.db.update(schema.telegramOutbox).set(set).where(eq(schema.telegramOutbox.id, id));
  }

  /** One pass over the queue; returns how many rows were handled. */
  async processOutbox(limit = 20): Promise<number> {
    const { db } = this.o;
    // Rows claimed by a worker that died mid-send go back to the queue.
    await db
      .update(schema.telegramOutbox)
      .set({ status: 'pending' })
      .where(
        sql`${schema.telegramOutbox.status} = 'sending' AND ${schema.telegramOutbox.nextAttemptAt} < now()`,
      );
    const claimed = await db
      .update(schema.telegramOutbox)
      .set({
        status: 'sending',
        attempts: sql`${schema.telegramOutbox.attempts} + 1`,
        nextAttemptAt: sql`now() + ${LEASE}`,
      })
      .where(
        inArray(
          schema.telegramOutbox.id,
          sql`(SELECT id FROM telegram_outbox WHERE status = 'pending' AND next_attempt_at <= now()
            ORDER BY created_at LIMIT ${limit} FOR UPDATE SKIP LOCKED)`,
        ),
      )
      .returning();

    const settings = claimed.length ? await this.settings() : null;
    for (const row of claimed) {
      const payload = { kind: row.kind, data: row.payload } as OutboxPayload;
      const setting = outboxKindSetting[payload.kind];
      if (setting === undefined) {
        await this.finish(row.id, { status: 'failed', lastError: 'unknown_kind' });
        continue;
      }
      if (setting && !settings![setting]) {
        await this.finish(row.id, { status: 'skipped', lastError: 'disabled' });
        continue;
      }
      const result = await this.deliver(renderNotification(payload, this.o.siteUrl));
      if (result.status === 'sent') {
        await this.finish(row.id, { status: 'sent', sentAt: new Date(), lastError: null });
      } else if (result.status === 'no_recipients') {
        // Nobody to tell (no owner linked to Telegram, or bot not started).
        await this.finish(row.id, { status: 'skipped', lastError: 'no_recipients' });
      } else {
        const error = result.error;
        const kind = error instanceof TelegramApiError ? error.kind : 'network';
        const code = kind === 'unreachable' ? 'not_started' : kind;
        const retryable = kind === 'rate_limited' || kind === 'network';
        if (retryable && row.attempts < MAX_ATTEMPTS) {
          const waitSeconds =
            error instanceof TelegramApiError && error.retryAfter
              ? error.retryAfter
              : 30 * 2 ** row.attempts;
          await this.finish(row.id, {
            status: 'pending',
            lastError: kind,
            nextAttemptAt: new Date(this.now() + waitSeconds * 1000),
          });
        } else {
          await this.finish(row.id, { status: 'failed', lastError: code });
        }
        this.o.logger.warn(
          {
            kind,
            attempts: row.attempts,
            code: error instanceof TelegramApiError ? (error.network?.code ?? null) : null,
            timeout: error instanceof TelegramApiError ? (error.network?.timeout ?? false) : false,
          },
          'admin notification not delivered',
        );
      }
    }
    return claimed.length;
  }
}
