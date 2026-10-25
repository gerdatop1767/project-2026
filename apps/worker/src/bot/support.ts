import { schema, type Database } from '@zybrilka/db';
import type { OutboxPayload } from '@zybrilka/shared';
import { and, eq, gt, sql } from 'drizzle-orm';
import type { TelegramMessage } from '../telegram/client.js';

/**
 * Support through the bot — the user's side (docs/SUPPORT.md).
 *
 * «💬 Поддержка» marks the chat as asking for support; the next plain
 * message (within a day) opens a thread, and everything the user sends
 * while it is open joins the same thread. Commands and the keyboard
 * buttons are never taken as support messages. A message is stored once:
 * Telegram may deliver an update twice, the unique (chat, message id)
 * index drops the repeat.
 */
export const CALLBACK_SUPPORT_CLOSE = 'support_close';
export const SUPPORT_REQUEST_TTL_MS = 24 * 60 * 60 * 1000;
const PREVIEW_MAX = 200;

type Thread = typeof schema.supportThreads.$inferSelect;
type SupportAttachment = schema.SupportAttachment;

export interface SupportContent {
  text: string;
  attachments: SupportAttachment[];
}

/**
 * What of a message support keeps: its text (or caption), its photo (the
 * largest size) or file. Null for kinds support does not take (voice,
 * stickers, video…) — the bot says so instead of silently dropping them.
 */
export function supportContentOf(message: TelegramMessage): SupportContent | null {
  const text = (message.text ?? message.caption ?? '').trim();
  const attachments: SupportAttachment[] = [];
  if (message.photo?.length) {
    const largest = message.photo[message.photo.length - 1]!;
    attachments.push({
      kind: 'photo',
      fileId: largest.file_id,
      ...(largest.file_size ? { size: largest.file_size } : {}),
    });
  }
  if (message.document) {
    attachments.push({
      kind: 'document',
      fileId: message.document.file_id,
      ...(message.document.file_name ? { fileName: message.document.file_name.slice(0, 200) } : {}),
      ...(message.document.mime_type ? { mimeType: message.document.mime_type.slice(0, 100) } : {}),
      ...(message.document.file_size ? { size: message.document.file_size } : {}),
    });
  }
  if (!text && attachments.length === 0) return null;
  return { text: text.slice(0, 4000), attachments };
}

export async function openThreadOf(db: Database, chatId: number): Promise<Thread | null> {
  const [thread] = await db
    .select()
    .from(schema.supportThreads)
    .where(and(eq(schema.supportThreads.chatId, chatId), eq(schema.supportThreads.status, 'open')));
  return thread ?? null;
}

/** «💬 Поддержка»: remembers the request (creating the chat row if this
 * chat never pressed /start). Returns whether a thread is already open. */
export async function requestSupport(
  db: Database,
  chatId: number,
  now = new Date(),
): Promise<{ open: boolean }> {
  await db
    .insert(schema.telegramBotChats)
    .values({ chatId, supportRequestedAt: now })
    .onConflictDoUpdate({
      target: schema.telegramBotChats.chatId,
      set: { supportRequestedAt: now, blockedAt: null },
    });
  return { open: (await openThreadOf(db, chatId)) !== null };
}

async function accountOf(db: Database, telegramUserId: number): Promise<string | null> {
  const [identity] = await db
    .select({ userId: schema.authIdentities.userId })
    .from(schema.authIdentities)
    .where(
      and(
        eq(schema.authIdentities.provider, 'telegram'),
        eq(schema.authIdentities.providerUserId, String(telegramUserId)),
      ),
    )
    .limit(1);
  return identity?.userId ?? null;
}

async function displayName(db: Database, userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const [user] = await db
    .select({
      displayName: schema.users.displayName,
      firstName: schema.users.firstName,
      lastName: schema.users.lastName,
    })
    .from(schema.users)
    .where(eq(schema.users.id, userId));
  if (!user) return null;
  return (
    user.displayName?.trim() ||
    [user.firstName, user.lastName].filter(Boolean).join(' ').trim() ||
    null
  );
}

export type ReceiveOutcome = 'opened' | 'appended' | 'duplicate' | 'not_support';

/**
 * A plain message from a private chat: joins the open thread, or opens one
 * if «💬 Поддержка» was pressed within the last day. Anything else is
 * `not_support` (the bot answers with its usual reply).
 */
export async function receiveSupportMessage(
  db: Database,
  chatId: number,
  telegramUserId: number,
  message: TelegramMessage,
  content: SupportContent,
  now = new Date(),
): Promise<{ outcome: ReceiveOutcome; threadId: string | null }> {
  let thread = await openThreadOf(db, chatId);
  if (!thread) {
    const [chat] = await db
      .select({ requestedAt: schema.telegramBotChats.supportRequestedAt })
      .from(schema.telegramBotChats)
      .where(
        and(
          eq(schema.telegramBotChats.chatId, chatId),
          gt(
            schema.telegramBotChats.supportRequestedAt,
            new Date(now.getTime() - SUPPORT_REQUEST_TTL_MS),
          ),
        ),
      );
    if (!chat) return { outcome: 'not_support', threadId: null };
  }

  const userId = thread?.userId ?? (await accountOf(db, telegramUserId));
  const result = await db.transaction(async (tx) => {
    let opened = false;
    if (!thread) {
      const [created] = await tx
        .insert(schema.supportThreads)
        .values({ chatId, userId, openedBy: 'user', createdAt: now, lastMessageAt: now })
        .onConflictDoNothing()
        .returning();
      if (created) {
        thread = created;
        opened = true;
      } else {
        // Another update opened it a moment ago.
        const [existing] = await tx
          .select()
          .from(schema.supportThreads)
          .where(
            and(eq(schema.supportThreads.chatId, chatId), eq(schema.supportThreads.status, 'open')),
          );
        thread = existing ?? null;
      }
    }
    const inserted = await tx
      .insert(schema.supportMessages)
      .values({
        threadId: thread!.id,
        chatId,
        direction: 'user',
        text: content.text,
        attachments: content.attachments,
        telegramMessageId: message.message_id,
        createdAt: now,
      })
      .onConflictDoNothing()
      .returning({ id: schema.supportMessages.id });
    if (inserted.length === 0) return { outcome: 'duplicate' as const, thread: thread! };
    await tx
      .update(schema.supportThreads)
      .set({
        lastMessageAt: now,
        lastUserMessageAt: now,
        ...(thread!.userId === null && userId ? { userId } : {}),
      })
      .where(eq(schema.supportThreads.id, thread!.id));
    await tx
      .update(schema.telegramBotChats)
      .set({ supportRequestedAt: null })
      .where(eq(schema.telegramBotChats.chatId, chatId));
    return { outcome: opened ? ('opened' as const) : ('appended' as const), thread: thread! };
  });

  if (result.outcome !== 'duplicate') {
    // One owner notification per unread stretch: the key changes only once
    // the admin has read the thread.
    const payload: OutboxPayload = {
      kind: 'support',
      data: {
        threadId: result.thread.id,
        name: await displayName(db, userId),
        preview: content.text.slice(0, PREVIEW_MAX),
        attachments: content.attachments.length,
        at: now.toISOString(),
      },
    };
    await db
      .insert(schema.telegramOutbox)
      .values({
        kind: payload.kind,
        payload: payload.data as unknown as Record<string, unknown>,
        dedupKey: `support:${result.thread.id}:${result.thread.adminReadAt?.toISOString() ?? 'new'}`,
      })
      .onConflictDoNothing();
  }
  return { outcome: result.outcome, threadId: result.thread.id };
}

/** «Завершить обращение» in the chat. */
export async function closeSupportByUser(
  db: Database,
  chatId: number,
  now = new Date(),
): Promise<boolean> {
  const closed = await db
    .update(schema.supportThreads)
    .set({ status: 'closed', closedAt: now })
    .where(and(eq(schema.supportThreads.chatId, chatId), eq(schema.supportThreads.status, 'open')))
    .returning({ id: schema.supportThreads.id });
  await db
    .update(schema.telegramBotChats)
    .set({ supportRequestedAt: null })
    .where(eq(schema.telegramBotChats.chatId, chatId));
  return closed.length > 0;
}

/** «Отключить напоминания» in the chat: for the account linked to this
 * Telegram user. False when no account is linked. */
export async function disableRemindersFor(db: Database, telegramUserId: number): Promise<boolean> {
  const userId = await accountOf(db, telegramUserId);
  if (!userId) return false;
  await db
    .update(schema.reminderSettings)
    .set({ enabled: false, updatedAt: sql`now()` })
    .where(eq(schema.reminderSettings.userId, userId));
  return true;
}
