import { lastActiveSql, schema, type Database } from '@zybrilka/db';
import {
  EXAM_TIMEZONE,
  INACTIVITY_REMINDER_DAYS,
  examCountdown,
  inactivityReminderText,
  localClock,
} from '@zybrilka/shared';
import { and, eq, gt, lte, sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import { reminderKeyboard } from '../bot/messages.js';
import { TelegramApiError, type TelegramClient } from '../telegram/client.js';

export interface InactivityReminderOptions {
  db: Database;
  telegram: TelegramClient;
  logger: Logger;
  siteUrl: string;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  /** Sends per run (the worker runs it every few minutes). */
  batchSize?: number;
  /** Pause between two sends. */
  pauseMs?: number;
}

const DAY_MS = 86_400_000;
const MAX_ATTEMPTS = 5;
/** A reminder not delivered within this time is dropped (`failed`). */
const RETRY_GIVE_UP_MS = 12 * 60 * 60_000;
/** Moscow-time window when nudges are sent: not at night, not at 7 a.m. */
export const INACTIVITY_SEND_WINDOW = { fromMinute: 10 * 60, toMinute: 20 * 60 } as const;

export interface InactivityRunResult {
  /** Accounts that could get one at all: Telegram linked, bot started and not blocked, notifications not opted out. */
  checked: number;
  /** Of them, inactive long enough and not reminded recently (this run's batch). */
  due: number;
  sent: number;
  failed: number;
  /** Retries dropped because the student came back. */
  skipped: number;
  /** Why nothing ran: outside the send window, or the exam period is on. */
  paused?: 'night' | 'exam_period';
}

type Row = Record<string, unknown>;
const rowsOf = (result: unknown): Row[] =>
  Array.isArray(result) ? (result as Row[]) : ((result as { rows?: Row[] }).rows ?? []);

/** Last activity, never earlier than registration (a new account is not «away»). */
async function lastActiveOf(db: Database, userId: string): Promise<Date | null> {
  const [row] = rowsOf(
    await db.execute(sql`
      SELECT greatest(${lastActiveSql(sql`u.id`)}, u.created_at) AS last_active
      FROM users u WHERE u.id = ${userId}`),
  );
  return row?.last_active ? new Date(String(row.last_active)) : null;
}

/**
 * «Давно не виделись» (docs/REMINDERS.md § Напоминания неактивным). Runs in
 * the worker's existing job loop — no separate scheduler. For accounts:
 * - with a linked Telegram whose bot chat is started and not blocked;
 * - with no saved reminder settings: `enabled = false` is an opt-out of
 *   everything (as for broadcasts), `enabled = true` already gets a daily
 *   reminder — a second nudge would be spam;
 * - whose last activity (`lastActiveSql`: answer, mini-game, sign-in or
 *   event — the same definition as the admin «Возврат пользователей») is
 *   more than INACTIVITY_REMINDER_DAYS ago;
 * - with no reminder row in the last INACTIVITY_REMINDER_DAYS.
 * Each send is claimed first (advisory lock per account + re-check + row
 * insert), so repeated runs, restarts and parallel workers never send twice.
 * A student who comes back is never sent the pending retry, and the next
 * reminder needs a new full stretch of inactivity.
 */
export class InactivityReminderScheduler {
  private readonly batchSize: number;
  private readonly pauseMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly o: InactivityReminderOptions) {
    this.batchSize = o.batchSize ?? 30;
    this.pauseMs = o.pauseMs ?? 100;
    this.sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  private now() {
    return this.o.now?.() ?? new Date();
  }

  async recoverInterrupted(): Promise<number> {
    const rows = await this.o.db
      .update(schema.inactivityReminders)
      .set({ status: 'uncertain', lastError: 'interrupted' })
      .where(eq(schema.inactivityReminders.status, 'sending'))
      .returning({ id: schema.inactivityReminders.id });
    if (rows.length) this.o.logger.warn({ count: rows.length }, 'inactivity reminders interrupted');
    return rows.length;
  }

  async run(): Promise<InactivityRunResult> {
    const now = this.now();
    const result: InactivityRunResult = { checked: 0, due: 0, sent: 0, failed: 0, skipped: 0 };
    const clock = localClock(now, EXAM_TIMEZONE);
    if (
      clock.minutes < INACTIVITY_SEND_WINDOW.fromMinute ||
      clock.minutes >= INACTIVITY_SEND_WINDOW.toMinute
    ) {
      return { ...result, paused: 'night' };
    }
    const countdown = examCountdown(now);
    const text = inactivityReminderText(now, countdown);
    if (text === null) return { ...result, paused: 'exam_period' };
    const daysToExam = countdown.kind === 'before' ? countdown.days : null;
    const cutoff = new Date(now.getTime() - INACTIVITY_REMINDER_DAYS * DAY_MS);

    let budget = this.batchSize;
    // 1. Due retries of earlier claims.
    const retries = await this.o.db
      .select()
      .from(schema.inactivityReminders)
      .where(
        and(
          eq(schema.inactivityReminders.status, 'retry'),
          lte(schema.inactivityReminders.nextAttemptAt, now),
        ),
      )
      .limit(budget);
    for (const r of retries) {
      if (r.createdAt.getTime() < now.getTime() - RETRY_GIVE_UP_MS) {
        await this.finish(r.id, { status: 'failed', lastError: 'gave_up' });
        result.failed++;
        continue;
      }
      const lastActive = await lastActiveOf(this.o.db, r.userId);
      if (!lastActive || lastActive >= cutoff || (r.lastActiveAt && lastActive > r.lastActiveAt)) {
        await this.finish(r.id, { status: 'skipped', lastError: 'came_back' });
        result.skipped++;
        continue;
      }
      const [claimed] = await this.o.db
        .update(schema.inactivityReminders)
        .set({ status: 'sending', attempts: sql`${schema.inactivityReminders.attempts} + 1` })
        .where(
          and(
            eq(schema.inactivityReminders.id, r.id),
            eq(schema.inactivityReminders.status, 'retry'),
          ),
        )
        .returning({
          id: schema.inactivityReminders.id,
          attempts: schema.inactivityReminders.attempts,
        });
      if (!claimed) continue;
      budget--;
      const outcome = await this.send(claimed, r.chatId, text, now);
      if (outcome === 'sent') result.sent++;
      else result.failed++;
      if (outcome === 'stop') return result;
      await this.sleep(this.pauseMs);
    }

    // 2. New reminders.
    const eligible = sql`
      FROM users u
      JOIN auth_identities ai ON ai.user_id = u.id AND ai.provider = 'telegram'
      JOIN telegram_bot_chats c ON c.chat_id::text = ai.provider_user_id AND c.blocked_at IS NULL
      WHERE NOT EXISTS (SELECT 1 FROM reminder_settings r WHERE r.user_id = u.id)`;
    const [count] = rowsOf(await this.o.db.execute(sql`SELECT count(*)::int AS n ${eligible}`));
    result.checked = Number(count?.n ?? 0);
    if (budget <= 0 || result.checked === 0) return result;

    const candidates = rowsOf(
      await this.o.db.execute(sql`
        SELECT * FROM (
          SELECT u.id AS user_id, c.chat_id,
            greatest(${lastActiveSql(sql`u.id`)}, u.created_at) AS last_active
          ${eligible}
        ) x
        WHERE x.last_active < ${cutoff.toISOString()}::timestamptz
          AND NOT EXISTS (
            SELECT 1 FROM inactivity_reminders d
            WHERE d.user_id = x.user_id AND d.created_at > ${cutoff.toISOString()}::timestamptz)
        ORDER BY x.last_active, x.user_id
        LIMIT ${budget}`),
    );
    result.due = candidates.length;

    for (const c of candidates) {
      const userId = String(c.user_id);
      const chatId = Number(c.chat_id);
      const claimed = await this.claim(userId, chatId, cutoff, now, daysToExam);
      if (!claimed) continue;
      const outcome = await this.send(claimed, chatId, text, now);
      if (outcome === 'sent') result.sent++;
      else result.failed++;
      if (outcome === 'stop') break;
      await this.sleep(this.pauseMs);
    }
    return result;
  }

  /**
   * Inserts the reminder row, under a per-account advisory lock, only after
   * re-checking inside the lock that the student is still away and nobody
   * reminded them in the last interval — the guard against a second worker
   * or an overlapping run.
   */
  private async claim(
    userId: string,
    chatId: number,
    cutoff: Date,
    now: Date,
    daysToExam: number | null,
  ): Promise<{ id: string; attempts: number } | null> {
    return this.o.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`inactivity:${userId}`}))`);
      const [recent] = await tx
        .select({ id: schema.inactivityReminders.id })
        .from(schema.inactivityReminders)
        .where(
          and(
            eq(schema.inactivityReminders.userId, userId),
            gt(schema.inactivityReminders.createdAt, cutoff),
          ),
        )
        .limit(1);
      if (recent) return null;
      const lastActive = await lastActiveOf(tx, userId);
      if (!lastActive || lastActive >= cutoff) return null;
      const [row] = await tx
        .insert(schema.inactivityReminders)
        .values({
          userId,
          chatId,
          localDate: localClock(now, EXAM_TIMEZONE).date,
          status: 'sending',
          attempts: 1,
          lastActiveAt: lastActive,
          daysToExam,
          createdAt: now,
        })
        .onConflictDoNothing()
        .returning({
          id: schema.inactivityReminders.id,
          attempts: schema.inactivityReminders.attempts,
        });
      return row ?? null;
    });
  }

  private finish(id: string, set: Partial<typeof schema.inactivityReminders.$inferInsert>) {
    return this.o.db
      .update(schema.inactivityReminders)
      .set(set)
      .where(eq(schema.inactivityReminders.id, id));
  }

  /** 'stop' = the bot or Telegram is unavailable right now: end this run. */
  private async send(
    row: { id: string; attempts: number },
    chatId: number,
    text: string,
    now: Date,
  ): Promise<'sent' | 'failed' | 'stop'> {
    try {
      await this.o.telegram.sendMessage(chatId, text, {
        replyMarkup: reminderKeyboard(this.o.siteUrl),
      });
      await this.finish(row.id, { status: 'sent', sentAt: this.now(), lastError: null });
      return 'sent';
    } catch (error) {
      const kind = error instanceof TelegramApiError ? error.kind : 'unknown';
      const retryIn = (ms: number, code: string) =>
        row.attempts >= MAX_ATTEMPTS
          ? this.finish(row.id, { status: 'failed', lastError: code })
          : this.finish(row.id, {
              status: 'retry',
              lastError: code,
              nextAttemptAt: new Date(now.getTime() + ms),
            });
      let stop = false;
      if (error instanceof TelegramApiError && kind === 'network') {
        stop = true;
        if (error.network?.maybeDelivered === false)
          await retryIn(5 * 60_000 * row.attempts, 'network');
        else await this.finish(row.id, { status: 'uncertain', lastError: 'network_unknown' });
      } else if (error instanceof TelegramApiError && kind === 'rate_limited') {
        stop = true;
        await retryIn(Math.max(error.retryAfter ?? 5, 60) * 1000, 'rate_limited');
      } else if (kind === 'unreachable') {
        await this.finish(row.id, { status: 'unreachable', lastError: 'blocked' });
        await this.o.db
          .update(schema.telegramBotChats)
          .set({ blockedAt: now })
          .where(eq(schema.telegramBotChats.chatId, chatId));
      } else if (kind === 'unauthorized') {
        stop = true;
        await retryIn(30 * 60_000, 'unauthorized');
      } else {
        await this.finish(row.id, {
          status: kind === 'unknown' ? 'uncertain' : 'failed',
          lastError: kind,
        });
      }
      this.o.logger.warn({ kind, attempt: row.attempts }, 'inactivity reminder not delivered');
      return stop ? 'stop' : 'failed';
    }
  }
}
