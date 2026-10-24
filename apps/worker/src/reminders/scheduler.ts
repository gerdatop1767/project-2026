import { schema, type Database } from '@zybrilka/db';
import { reminderDue, reminderText } from '@zybrilka/shared';
import { and, eq, inArray, isNull, lte, sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import { reminderKeyboard } from '../bot/messages.js';
import { TelegramApiError, type TelegramClient } from '../telegram/client.js';

export interface ReminderSchedulerOptions {
  db: Database;
  telegram: TelegramClient;
  logger: Logger;
  siteUrl: string;
  now?: () => Date;
}

const MAX_ATTEMPTS = 5;

/**
 * Daily Telegram reminders (docs/REMINDERS.md), run every minute by the
 * worker's existing job loop. For every account with reminders on whose
 * local time has come (and is not more than two hours past):
 * - the bot may write only to a linked Telegram that pressed Start and has
 *   not blocked the bot — nobody else gets anything;
 * - (user, local date) is claimed in `reminder_deliveries` BEFORE sending:
 *   a restart, a repeated run or a second worker finds the row and sends
 *   nothing — at most one reminder a day;
 * - a send that provably never reached Telegram is retried within the
 *   window; one that may have been shown is never repeated (`uncertain`);
 *   a blocked bot marks the chat and stops.
 */
export class ReminderScheduler {
  constructor(private readonly o: ReminderSchedulerOptions) {}

  private now() {
    return this.o.now?.() ?? new Date();
  }

  async recoverInterrupted(): Promise<number> {
    const rows = await this.o.db
      .update(schema.reminderDeliveries)
      .set({ status: 'uncertain', lastError: 'interrupted' })
      .where(eq(schema.reminderDeliveries.status, 'sending'))
      .returning({ id: schema.reminderDeliveries.id });
    if (rows.length) this.o.logger.warn({ count: rows.length }, 'reminders interrupted');
    return rows.length;
  }

  async run(): Promise<{ sent: number; skipped: number }> {
    const now = this.now();
    const candidates = await this.o.db
      .select({
        userId: schema.reminderSettings.userId,
        minuteOfDay: schema.reminderSettings.minuteOfDay,
        timezone: schema.reminderSettings.timezone,
        telegramId: schema.authIdentities.providerUserId,
      })
      .from(schema.reminderSettings)
      .innerJoin(
        schema.authIdentities,
        and(
          eq(schema.authIdentities.userId, schema.reminderSettings.userId),
          eq(schema.authIdentities.provider, 'telegram'),
        ),
      )
      .where(eq(schema.reminderSettings.enabled, true));
    if (candidates.length === 0) return { sent: 0, skipped: 0 };

    const chatIds = candidates
      .map((c) => Number(c.telegramId))
      .filter((id) => Number.isSafeInteger(id) && id > 0);
    const reachable = new Set(
      chatIds.length
        ? (
            await this.o.db
              .select({ chatId: schema.telegramBotChats.chatId })
              .from(schema.telegramBotChats)
              .where(
                and(
                  inArray(schema.telegramBotChats.chatId, chatIds),
                  isNull(schema.telegramBotChats.blockedAt),
                ),
              )
          ).map((r) => r.chatId)
        : [],
    );

    let sent = 0;
    let skipped = 0;
    for (const c of candidates) {
      const chatId = Number(c.telegramId);
      if (!reachable.has(chatId)) {
        skipped++;
        continue;
      }
      let due: { due: boolean; date: string };
      try {
        due = reminderDue(now, c.timezone, c.minuteOfDay);
      } catch {
        skipped++; // a timezone the runtime no longer knows
        continue;
      }
      if (!due.due) continue;
      if (await this.deliver(c.userId, chatId, due.date, now)) sent++;
    }
    return { sent, skipped };
  }

  /** Claims today's row (or a due retry of it) and sends. */
  private async deliver(userId: string, chatId: number, date: string, now: Date) {
    const [claimed] = await this.o.db
      .insert(schema.reminderDeliveries)
      .values({ userId, localDate: date, chatId, status: 'sending', attempts: 1 })
      .onConflictDoNothing()
      .returning({
        id: schema.reminderDeliveries.id,
        attempts: schema.reminderDeliveries.attempts,
      });
    let row = claimed;
    if (!row) {
      // Already handled today — unless it is a retry that is due now.
      const [retry] = await this.o.db
        .update(schema.reminderDeliveries)
        .set({ status: 'sending', attempts: sql`${schema.reminderDeliveries.attempts} + 1` })
        .where(
          and(
            eq(schema.reminderDeliveries.userId, userId),
            eq(schema.reminderDeliveries.localDate, date),
            eq(schema.reminderDeliveries.status, 'retry'),
            lte(schema.reminderDeliveries.nextAttemptAt, now),
          ),
        )
        .returning({
          id: schema.reminderDeliveries.id,
          attempts: schema.reminderDeliveries.attempts,
        });
      if (!retry) return false;
      row = retry;
    }
    const finish = (set: Partial<typeof schema.reminderDeliveries.$inferInsert>) =>
      this.o.db
        .update(schema.reminderDeliveries)
        .set(set)
        .where(eq(schema.reminderDeliveries.id, row.id));
    try {
      await this.o.telegram.sendMessage(chatId, reminderText, {
        replyMarkup: reminderKeyboard(this.o.siteUrl),
      });
      await finish({ status: 'sent', sentAt: this.now(), lastError: null });
      return true;
    } catch (error) {
      const kind = error instanceof TelegramApiError ? error.kind : 'unknown';
      const retryIn = (ms: number, code: string) =>
        row.attempts >= MAX_ATTEMPTS
          ? finish({ status: 'failed', lastError: code })
          : finish({
              status: 'retry',
              lastError: code,
              nextAttemptAt: new Date(now.getTime() + ms),
            });
      if (error instanceof TelegramApiError && kind === 'network') {
        if (error.network?.maybeDelivered === false)
          await retryIn(60_000 * row.attempts, 'network');
        else await finish({ status: 'uncertain', lastError: 'network_unknown' });
      } else if (error instanceof TelegramApiError && kind === 'rate_limited') {
        await retryIn((error.retryAfter ?? 5) * 1000, 'rate_limited');
      } else if (kind === 'unreachable') {
        await finish({ status: 'unreachable', lastError: 'blocked' });
        await this.o.db
          .update(schema.telegramBotChats)
          .set({ blockedAt: now })
          .where(eq(schema.telegramBotChats.chatId, chatId));
      } else if (kind === 'unauthorized') {
        await retryIn(10 * 60_000, 'unauthorized');
      } else {
        await finish({ status: kind === 'unknown' ? 'uncertain' : 'failed', lastError: kind });
      }
      this.o.logger.warn({ kind, attempt: row.attempts }, 'reminder not delivered');
      return false;
    }
  }
}
