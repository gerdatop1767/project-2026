import { schema } from '@zybrilka/db';
import type { Database } from '@zybrilka/db';
import { parseTelegramHtml, planBroadcast, type BroadcastPart } from '@zybrilka/shared';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import {
  largestPhotoId,
  TelegramApiError,
  type PhotoInput,
  type TelegramClient,
} from '../telegram/client.js';

type Broadcast = typeof schema.broadcasts.$inferSelect;
interface Attachment {
  id: string;
  position: number;
  fileId: string | null;
  bytes: Uint8Array | null;
  filename: string;
}

export interface BroadcastSenderOptions {
  db: Database;
  telegram: TelegramClient;
  logger: Logger;
  /** Owner chats for «Отправить себе». */
  adminChats: () => Promise<number[]>;
  /** Messages per second, under Telegram's ~30/s bulk limit. */
  ratePerSecond?: number;
  batchSize?: number;
  sleep?: (ms: number) => Promise<void>;
}

const RATE_LIMIT_RETRIES = 3;

class ContentError extends Error {}

/**
 * Sends confirmed broadcasts (docs/TELEGRAM_BOT.md). Only `sending` ones —
 * a status the API sets solely on explicit confirmation.
 * - The audience is snapshotted with one INSERT … SELECT into
 *   broadcast_deliveries (never loaded into memory); the (broadcast, chat)
 *   primary key means nobody can get it twice.
 * - Deliveries are claimed in batches with SKIP LOCKED and marked
 *   `in_flight` before sending; on start-up, `in_flight` rows left by a
 *   crash are closed as `interrupted` — never resent (no duplicates).
 * - The broadcast's status is re-read before every message, so «Остановить»
 *   takes effect at once.
 * - 429 → wait `retry_after` and retry the same chat; a chat that blocked
 *   the bot → `blocked` (and marked in telegram_bot_chats); other errors →
 *   `failed` with a short code. Counters only count real outcomes.
 */
export class BroadcastSender {
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly pause: number;
  private readonly batchSize: number;
  private attachments = new Map<string, Attachment[]>();
  private stopping = false;

  /** Worker shutdown: finish the current message, start no new one. */
  stop() {
    this.stopping = true;
  }

  constructor(private readonly o: BroadcastSenderOptions) {
    this.sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.pause = Math.ceil(1000 / (o.ratePerSecond ?? 20));
    this.batchSize = o.batchSize ?? 25;
  }

  /** Once at start-up: whatever was mid-send when the worker stopped is not resent. */
  async recoverInterrupted(): Promise<number> {
    const rows = await this.o.db
      .update(schema.broadcastDeliveries)
      .set({ status: 'failed', errorCode: 'interrupted' })
      .where(eq(schema.broadcastDeliveries.status, 'in_flight'))
      .returning({ broadcastId: schema.broadcastDeliveries.broadcastId });
    for (const row of rows) {
      await this.o.db
        .update(schema.broadcasts)
        .set({ failedCount: sql`${schema.broadcasts.failedCount} + 1` })
        .where(eq(schema.broadcasts.id, row.broadcastId));
    }
    if (rows.length) this.o.logger.warn({ count: rows.length }, 'broadcast deliveries interrupted');
    return rows.length;
  }

  private async loadAttachments(broadcastId: string): Promise<Attachment[]> {
    let list = this.attachments.get(broadcastId);
    if (!list) {
      const rows = await this.o.db
        .select()
        .from(schema.broadcastAttachments)
        .where(eq(schema.broadcastAttachments.broadcastId, broadcastId))
        .orderBy(asc(schema.broadcastAttachments.position));
      list = rows.map((r) => ({
        id: r.id,
        position: r.position,
        fileId: r.telegramFileId,
        bytes: r.telegramFileId ? null : new Uint8Array(r.data),
        filename: `image-${r.position}.${r.contentType === 'image/png' ? 'png' : 'jpg'}`,
      }));
      this.attachments.set(broadcastId, list);
    }
    return list;
  }

  private photo(a: Attachment): PhotoInput {
    return a.fileId ? { fileId: a.fileId } : { bytes: a.bytes!, filename: a.filename };
  }

  private async remember(a: Attachment, fileId: string | null) {
    if (!fileId || a.fileId) return;
    a.fileId = fileId;
    a.bytes = null;
    await this.o.db
      .update(schema.broadcastAttachments)
      .set({ telegramFileId: fileId })
      .where(eq(schema.broadcastAttachments.id, a.id));
  }

  /** Sends the whole broadcast to one chat; `progress.sent` counts the
   * messages that went out (so a failure after the first is `partial`). */
  private async sendContent(chatId: number, b: Broadcast, progress: { sent: number }) {
    const parsed = parseTelegramHtml(b.text);
    if (!parsed.ok) throw new ContentError(parsed.error);
    const images = await this.loadAttachments(b.id);
    const plan = planBroadcast(parsed.visibleLength, images.length, b.mediaMode);
    if (!plan.ok) throw new ContentError(plan.error);
    for (const part of plan.parts as BroadcastPart[]) {
      if (part.kind === 'text') {
        await this.o.telegram.sendMessage(chatId, parsed.html, { parseMode: 'HTML' });
      } else if (part.kind === 'photo') {
        const message = await this.o.telegram.sendPhoto(
          chatId,
          this.photo(images[0]!),
          part.withCaption ? parsed.html : undefined,
          part.withCaption ? { parseMode: 'HTML' } : undefined,
        );
        await this.remember(images[0]!, largestPhotoId(message));
      } else {
        const messages = await this.o.telegram.sendMediaGroup(
          chatId,
          images.map((a, i) => ({
            photo: this.photo(a),
            ...(i === 0 && part.withCaption
              ? { caption: parsed.html, parseMode: 'HTML' as const }
              : {}),
          })),
        );
        for (const [i, m] of messages.entries()) {
          if (images[i]) await this.remember(images[i], largestPhotoId(m));
        }
      }
      progress.sent++;
    }
  }

  /** One chat, with 429 handling. */
  private async deliver(chatId: number, b: Broadcast) {
    const progress = { sent: 0 };
    for (let attempt = 0; ; attempt++) {
      try {
        await this.sendContent(chatId, b, progress);
        return { status: 'sent' as const, errorCode: null };
      } catch (error) {
        if (error instanceof ContentError)
          return { status: 'failed' as const, errorCode: 'content' };
        if (!(error instanceof TelegramApiError)) {
          return { status: 'failed' as const, errorCode: 'unexpected' };
        }
        // Something already arrived: retrying would duplicate it.
        if (progress.sent > 0) return { status: 'failed' as const, errorCode: 'partial' };
        if (error.kind === 'rate_limited' && attempt < RATE_LIMIT_RETRIES) {
          await this.sleep((error.retryAfter ?? 5) * 1000);
          continue;
        }
        if (error.kind === 'unreachable')
          return { status: 'blocked' as const, errorCode: 'blocked' };
        return { status: 'failed' as const, errorCode: error.kind };
      }
    }
  }

  private async currentStatus(id: string) {
    const [row] = await this.o.db
      .select({ status: schema.broadcasts.status })
      .from(schema.broadcasts)
      .where(eq(schema.broadcasts.id, id));
    return row?.status;
  }

  private async snapshotAudience(b: Broadcast): Promise<Broadcast> {
    await this.o.db.execute(sql`
      INSERT INTO broadcast_deliveries (broadcast_id, chat_id)
      SELECT ${b.id}, c.chat_id FROM telegram_bot_chats c WHERE c.blocked_at IS NULL
      ON CONFLICT DO NOTHING`);
    const [{ n }] = (await this.o.db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.broadcastDeliveries)
      .where(eq(schema.broadcastDeliveries.broadcastId, b.id))) as [{ n: number }];
    const [updated] = await this.o.db
      .update(schema.broadcasts)
      .set({ recipientsTotal: n, startedAt: new Date() })
      .where(and(eq(schema.broadcasts.id, b.id), isNull(schema.broadcasts.recipientsTotal)))
      .returning();
    return updated ?? b;
  }

  /** Sends what is due; returns how many chats were handled. */
  async processBroadcasts(): Promise<number> {
    const [next] = await this.o.db
      .select()
      .from(schema.broadcasts)
      .where(eq(schema.broadcasts.status, 'sending'))
      .orderBy(asc(schema.broadcasts.confirmedAt))
      .limit(1);
    if (!next) return 0;
    const b = next.recipientsTotal === null ? await this.snapshotAudience(next) : next;
    let handled = 0;
    for (;;) {
      if (this.stopping || (await this.currentStatus(b.id)) !== 'sending') break;
      const claimed = await this.o.db
        .update(schema.broadcastDeliveries)
        .set({ status: 'in_flight' })
        .where(
          and(
            eq(schema.broadcastDeliveries.broadcastId, b.id),
            inArray(
              schema.broadcastDeliveries.chatId,
              sql`(SELECT chat_id FROM broadcast_deliveries WHERE broadcast_id = ${b.id} AND status = 'pending'
                ORDER BY chat_id LIMIT ${this.batchSize} FOR UPDATE SKIP LOCKED)`,
            ),
          ),
        )
        .returning({ chatId: schema.broadcastDeliveries.chatId });
      if (claimed.length === 0) break;
      for (const [index, { chatId }] of claimed.entries()) {
        if (this.stopping || (index > 0 && (await this.currentStatus(b.id)) !== 'sending')) {
          // Stopped (by the admin or a shutdown): hand back what was
          // claimed but not sent — a restart picks it up, nothing is lost.
          await this.o.db
            .update(schema.broadcastDeliveries)
            .set({ status: 'pending' })
            .where(
              and(
                eq(schema.broadcastDeliveries.broadcastId, b.id),
                inArray(
                  schema.broadcastDeliveries.chatId,
                  claimed.slice(index).map((c) => c.chatId),
                ),
              ),
            );
          return handled;
        }
        const result = await this.deliver(chatId, b);
        await this.o.db
          .update(schema.broadcastDeliveries)
          .set({
            status: result.status,
            errorCode: result.errorCode,
            sentAt: result.status === 'sent' ? new Date() : null,
          })
          .where(
            and(
              eq(schema.broadcastDeliveries.broadcastId, b.id),
              eq(schema.broadcastDeliveries.chatId, chatId),
            ),
          );
        const counter =
          result.status === 'sent'
            ? { sentCount: sql`${schema.broadcasts.sentCount} + 1` }
            : result.status === 'blocked'
              ? { blockedCount: sql`${schema.broadcasts.blockedCount} + 1` }
              : { failedCount: sql`${schema.broadcasts.failedCount} + 1` };
        await this.o.db
          .update(schema.broadcasts)
          .set(counter)
          .where(eq(schema.broadcasts.id, b.id));
        if (result.status === 'blocked') {
          await this.o.db
            .update(schema.telegramBotChats)
            .set({ blockedAt: new Date() })
            .where(eq(schema.telegramBotChats.chatId, chatId));
        }
        handled++;
        await this.sleep(this.pause);
      }
    }
    await this.finishIfDone(b.id);
    return handled;
  }

  private async finishIfDone(id: string) {
    const [open] = await this.o.db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.broadcastDeliveries)
      .where(
        and(
          eq(schema.broadcastDeliveries.broadcastId, id),
          inArray(schema.broadcastDeliveries.status, ['pending', 'in_flight']),
        ),
      );
    if ((open?.n ?? 0) > 0) return;
    await this.o.db.execute(sql`
      UPDATE broadcasts SET
        status = CASE WHEN failed_count + blocked_count > 0 THEN 'completed_with_errors' ELSE 'completed' END,
        finished_at = now(), updated_at = now()
      WHERE id = ${id} AND status = 'sending'`);
  }

  /** «Отправить себе»: the content to the owners' chats only. */
  async processTests(): Promise<number> {
    const due = await this.o.db
      .select()
      .from(schema.broadcasts)
      .where(eq(schema.broadcasts.testStatus, 'pending'))
      .limit(5);
    for (const b of due) {
      const chats = await this.o.adminChats();
      let status: 'sent' | 'failed' | 'no_recipients' = chats.length ? 'failed' : 'no_recipients';
      for (const chatId of chats) {
        const result = await this.deliver(chatId, b);
        if (result.status === 'sent') status = 'sent';
      }
      await this.o.db
        .update(schema.broadcasts)
        .set({ testStatus: status })
        .where(eq(schema.broadcasts.id, b.id));
      // A draft may still change: don't keep its images cached.
      this.attachments.delete(b.id);
    }
    return due.length;
  }
}
