import { schema, type Database } from '@zybrilka/db';
import { supportTexts } from '@zybrilka/shared';
import { and, asc, eq, isNull, lte, or, sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import { persistentKeyboard } from '../bot/messages.js';
import { TelegramApiError, type TelegramClient } from '../telegram/client.js';
import { errorSummary } from '../errorSummary.js';

export interface SupportSenderOptions {
  db: Database;
  telegram: TelegramClient;
  logger: Logger;
  now?: () => Date;
  /** Max messages per run. */
  batch?: number;
}

/** A network failure that provably never reached Telegram is retried this
 * many times (with growing pauses) before the message is marked failed. */
export const SUPPORT_MAX_ATTEMPTS = 12;

export function supportRetryDelayMs(attempt: number): number {
  return Math.min(10 * 60_000, 5_000 * 2 ** Math.max(0, attempt - 1));
}

/** The text the user sees: the admin's reply with a header; the closing
 * notice as it is. Plain text — nothing typed by the admin is parsed. */
export function supportOutgoingText(text: string): string {
  if (text === supportTexts.closedByAdmin) return text;
  return `${supportTexts.replyPrefix}\n\n${text}`;
}

/**
 * Delivers the admin's support replies (docs/SUPPORT.md). The API only
 * queues them; here each one is claimed (`pending` → `sending`, one
 * conditional update, so two workers never send the same message), sent,
 * and finished:
 * - sent → `sent`;
 * - never reached Telegram (network) / rate limit → back to `pending`
 *   with a pause, up to SUPPORT_MAX_ATTEMPTS;
 * - may have been shown (timeout after sending) → `uncertain`, never resent;
 * - blocked / chat gone → `failed: blocked` (the chat is marked blocked);
 * - bad token → back to `pending` with a long pause (nothing is lost).
 */
export class SupportSender {
  constructor(private readonly o: SupportSenderOptions) {}

  private now() {
    return this.o.now?.() ?? new Date();
  }

  /** After a crash mid-send it is unknown whether Telegram showed it. */
  async recoverInterrupted(): Promise<number> {
    const rows = await this.o.db
      .update(schema.supportMessages)
      .set({ deliveryStatus: 'uncertain', lastError: 'interrupted' })
      .where(eq(schema.supportMessages.deliveryStatus, 'sending'))
      .returning({ id: schema.supportMessages.id });
    if (rows.length) this.o.logger.warn({ count: rows.length }, 'support replies interrupted');
    return rows.length;
  }

  async process(): Promise<number> {
    const now = this.now();
    const due = await this.o.db
      .select({ id: schema.supportMessages.id })
      .from(schema.supportMessages)
      .where(
        and(
          eq(schema.supportMessages.direction, 'admin'),
          eq(schema.supportMessages.deliveryStatus, 'pending'),
          or(
            isNull(schema.supportMessages.nextAttemptAt),
            lte(schema.supportMessages.nextAttemptAt, now),
          ),
        ),
      )
      .orderBy(asc(schema.supportMessages.createdAt))
      .limit(this.o.batch ?? 20);
    let sent = 0;
    for (const { id } of due) {
      if (await this.deliver(id)) sent++;
    }
    return sent;
  }

  private async deliver(id: string): Promise<boolean> {
    const [message] = await this.o.db
      .update(schema.supportMessages)
      .set({
        deliveryStatus: 'sending',
        attempts: sql`${schema.supportMessages.attempts} + 1`,
      })
      .where(
        and(
          eq(schema.supportMessages.id, id),
          eq(schema.supportMessages.deliveryStatus, 'pending'),
        ),
      )
      .returning();
    if (!message) return false; // someone else took it
    const finish = (set: Partial<typeof schema.supportMessages.$inferInsert>) =>
      this.o.db.update(schema.supportMessages).set(set).where(eq(schema.supportMessages.id, id));
    try {
      await this.o.telegram.sendMessage(message.chatId, supportOutgoingText(message.text), {
        replyMarkup: persistentKeyboard,
        disablePreview: true,
      });
      await finish({ deliveryStatus: 'sent', sentAt: this.now(), lastError: null });
      return true;
    } catch (error) {
      const now = this.now();
      if (!(error instanceof TelegramApiError)) {
        await finish({ deliveryStatus: 'uncertain', lastError: 'unknown' });
        this.o.logger.error(errorSummary(error), 'support reply: unexpected error');
        return false;
      }
      const retry = (code: string, delayMs: number) =>
        message.attempts >= SUPPORT_MAX_ATTEMPTS
          ? finish({ deliveryStatus: 'failed', lastError: code })
          : finish({
              deliveryStatus: 'pending',
              lastError: code,
              nextAttemptAt: new Date(now.getTime() + delayMs),
            });
      switch (error.kind) {
        case 'network':
          if (error.network?.maybeDelivered === false) {
            await retry('network', supportRetryDelayMs(message.attempts));
          } else {
            await finish({ deliveryStatus: 'uncertain', lastError: 'network_unknown' });
          }
          break;
        case 'rate_limited':
          await retry('rate_limited', (error.retryAfter ?? 5) * 1000);
          break;
        case 'unreachable':
          await finish({ deliveryStatus: 'failed', lastError: 'blocked' });
          await this.o.db
            .update(schema.telegramBotChats)
            .set({ blockedAt: now })
            .where(eq(schema.telegramBotChats.chatId, message.chatId));
          break;
        case 'unauthorized':
          // The token is wrong: keep the message until it is fixed.
          await finish({
            deliveryStatus: 'pending',
            lastError: 'unauthorized',
            nextAttemptAt: new Date(now.getTime() + 10 * 60_000),
          });
          break;
        default:
          await finish({ deliveryStatus: 'failed', lastError: error.kind });
      }
      // Kind and status only — never the text or the chat.
      this.o.logger.warn(
        { kind: error.kind, status: error.status, attempt: message.attempts },
        'support reply not delivered',
      );
      return false;
    }
  }
}
