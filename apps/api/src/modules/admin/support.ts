import { schema, telegramReachability, type Database } from '@zybrilka/db';
import {
  supportReplyRequestSchema,
  supportStartRequestSchema,
  supportStatusRequestSchema,
  supportTexts,
  type SupportMessageDto,
  type SupportThreadDetail,
  type SupportThreadSummary,
  type SupportUnreachableReason,
  type SupportUserSearchItem,
} from '@zybrilka/shared';
import { and, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { writeAudit } from './audit.js';

export interface SupportRoutesOptions {
  db: Database;
  /** For reading attachments from Telegram; absent = files are not served. */
  botToken?: string;
  /** For tests: Telegram's API (default https://api.telegram.org). */
  telegramApiBase?: string;
  fetchImpl?: typeof fetch;
}

const idParams = z.object({ id: z.uuid() });
const fileParams = z.object({ id: z.uuid(), index: z.coerce.number().int().min(0).max(9) });
const listQuery = z.object({
  status: z.enum(['open', 'closed', 'all']).default('all'),
  q: z.string().trim().max(80).optional(),
});
const searchQuery = z.object({ q: z.string().trim().min(1).max(80) });

type Thread = typeof schema.supportThreads.$inferSelect;
type Message = typeof schema.supportMessages.$inferSelect;
type UserRow = Pick<typeof schema.users.$inferSelect, 'displayName' | 'firstName' | 'lastName'>;

/** The admin sees the account's name; a chat with no account stays anonymous. */
export function supportName(user: UserRow | null | undefined): string {
  if (!user) return 'Пользователь Telegram';
  const custom = user.displayName?.trim();
  if (custom) return custom;
  const full = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  return full || 'Пользователь без имени';
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function preview(message: Message | undefined): string {
  if (!message) return '';
  const text = message.text.replace(/\s+/g, ' ').trim();
  if (text) return text.length > 120 ? `${text.slice(0, 119)}…` : text;
  const files = message.attachments.length;
  return files > 0 ? (message.attachments[0]!.kind === 'photo' ? '📷 Фото' : '📎 Файл') : '';
}

function isUnread(thread: Thread): boolean {
  return (
    thread.lastUserMessageAt !== null &&
    (thread.adminReadAt === null || thread.adminReadAt < thread.lastUserMessageAt)
  );
}

function unreachableReason(reach: {
  telegramId: number | null;
  botStarted: boolean;
  blocked: boolean;
}): SupportUnreachableReason | null {
  if (reach.telegramId === null) return 'no_telegram';
  if (!reach.botStarted) return 'not_started';
  if (reach.blocked) return 'blocked';
  return null;
}

/**
 * /api/v1/admin/support/* — the support inbox (docs/SUPPORT.md). Registered
 * inside the admin scope, so `requireAdmin` (owner list, server side) runs
 * before every handler; writes also need the admin header. The API never
 * talks to Telegram to SEND: a reply is queued (`pending`) and the worker
 * delivers it with retries, so a Telegram outage cannot lose it. Telegram
 * ids are never returned to the browser.
 */
export const supportRoutes: FastifyPluginAsync<SupportRoutesOptions> = async (
  app,
  { db, botToken, telegramApiBase = 'https://api.telegram.org', fetchImpl = fetch },
) => {
  const actor = (request: FastifyRequest) => request.sessionUserId!;
  const audit = (request: FastifyRequest, action: string, id: string, details?: object) =>
    writeAudit(db, {
      actorUserId: actor(request),
      action,
      objectType: 'support_thread',
      objectId: id,
      result: 'ok',
      details: details as Record<string, unknown> | undefined,
    });
  const notFound = (reply: FastifyReply) => reply.code(404).send({ error: 'not_found' });

  async function summaries(threads: Thread[]): Promise<SupportThreadSummary[]> {
    if (threads.length === 0) return [];
    const ids = threads.map((t) => t.id);
    const userIds = [...new Set(threads.map((t) => t.userId).filter((u): u is string => !!u))];
    const users = userIds.length
      ? await db
          .select({
            id: schema.users.id,
            displayName: schema.users.displayName,
            firstName: schema.users.firstName,
            lastName: schema.users.lastName,
          })
          .from(schema.users)
          .where(inArray(schema.users.id, userIds))
      : [];
    const byUser = new Map(users.map((u) => [u.id, u]));
    const last = await db
      .selectDistinctOn([schema.supportMessages.threadId])
      .from(schema.supportMessages)
      .where(inArray(schema.supportMessages.threadId, ids))
      .orderBy(schema.supportMessages.threadId, desc(schema.supportMessages.createdAt));
    const lastByThread = new Map(last.map((m) => [m.threadId, m]));
    const counts = await db
      .select({ threadId: schema.supportMessages.threadId, n: sql<number>`count(*)::int` })
      .from(schema.supportMessages)
      .where(inArray(schema.supportMessages.threadId, ids))
      .groupBy(schema.supportMessages.threadId);
    const countByThread = new Map(counts.map((c) => [c.threadId, c.n]));
    return threads.map((t) => {
      const lastMessage = lastByThread.get(t.id);
      return {
        id: t.id,
        status: t.status,
        name: supportName(t.userId ? byUser.get(t.userId) : null),
        userId: t.userId,
        lastMessageAt: t.lastMessageAt.toISOString(),
        lastMessagePreview: preview(lastMessage),
        lastMessageFrom: lastMessage?.direction ?? null,
        unread: isUnread(t),
        messageCount: countByThread.get(t.id) ?? 0,
        openedBy: t.openedBy,
      };
    });
  }

  function messageDto(m: Message): SupportMessageDto {
    return {
      id: m.id,
      direction: m.direction,
      text: m.text,
      attachments: m.attachments.map((a, index) => ({
        kind: a.kind,
        fileName: a.fileName ?? null,
        url: `/api/v1/admin/support/messages/${m.id}/files/${index}`,
      })),
      createdAt: m.createdAt.toISOString(),
      delivery: m.direction === 'admin' ? (m.deliveryStatus ?? null) : null,
      deliveryError: m.direction === 'admin' && m.deliveryStatus === 'failed' ? m.lastError : null,
    };
  }

  async function detail(thread: Thread): Promise<SupportThreadDetail> {
    const [summary] = await summaries([thread]);
    const messages = await db
      .select()
      .from(schema.supportMessages)
      .where(eq(schema.supportMessages.threadId, thread.id))
      .orderBy(schema.supportMessages.createdAt);
    const [chat] = await db
      .select({ blockedAt: schema.telegramBotChats.blockedAt })
      .from(schema.telegramBotChats)
      .where(eq(schema.telegramBotChats.chatId, thread.chatId));
    return {
      thread: {
        ...summary!,
        createdAt: thread.createdAt.toISOString(),
        closedAt: thread.closedAt?.toISOString() ?? null,
        reachable: Boolean(chat) && !chat!.blockedAt,
      },
      messages: messages.map(messageDto),
    };
  }

  async function loadThread(request: FastifyRequest): Promise<Thread | null> {
    const parsed = idParams.safeParse(request.params);
    if (!parsed.success) return null;
    const [thread] = await db
      .select()
      .from(schema.supportThreads)
      .where(eq(schema.supportThreads.id, parsed.data.id));
    return thread ?? null;
  }

  /** Queues an admin message for the worker; touches the thread. */
  async function queueReply(thread: Thread, authorUserId: string, text: string) {
    const now = new Date();
    return db.transaction(async (tx) => {
      const [message] = await tx
        .insert(schema.supportMessages)
        .values({
          threadId: thread.id,
          chatId: thread.chatId,
          direction: 'admin',
          text,
          authorUserId,
          deliveryStatus: 'pending',
          nextAttemptAt: now,
          createdAt: now,
        })
        .returning();
      await tx
        .update(schema.supportThreads)
        .set({ lastMessageAt: now, adminReadAt: now })
        .where(eq(schema.supportThreads.id, thread.id));
      return message!;
    });
  }

  app.get('/admin/support/threads', async (request, reply) => {
    const query = listQuery.safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: 'invalid_query' });
    const conditions = [];
    if (query.data.status !== 'all') {
      conditions.push(eq(schema.supportThreads.status, query.data.status));
    }
    if (query.data.q) {
      const like = `%${query.data.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
      const matching = db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(
          or(
            ilike(schema.users.displayName, like),
            ilike(schema.users.firstName, like),
            ilike(schema.users.lastName, like),
          ),
        );
      conditions.push(inArray(schema.supportThreads.userId, matching));
    }
    const threads = await db
      .select()
      .from(schema.supportThreads)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(schema.supportThreads.lastMessageAt))
      .limit(200);
    const items = await summaries(threads);
    return { items, unread: items.filter((i) => i.unread).length };
  });

  app.get('/admin/support/threads/:id', async (request, reply) => {
    const thread = await loadThread(request);
    if (!thread) return notFound(reply);
    return detail(thread);
  });

  app.post('/admin/support/threads/:id/read', async (request, reply) => {
    const thread = await loadThread(request);
    if (!thread) return notFound(reply);
    await db
      .update(schema.supportThreads)
      .set({ adminReadAt: new Date() })
      .where(eq(schema.supportThreads.id, thread.id));
    return reply.code(204).send();
  });

  app.post(
    '/admin/support/threads/:id/messages',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const thread = await loadThread(request);
      if (!thread) return notFound(reply);
      const body = supportReplyRequestSchema.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: 'invalid_body' });
      if (thread.status !== 'open') return reply.code(409).send({ error: 'thread_closed' });
      const message = await queueReply(thread, actor(request), body.data.text);
      await audit(request, 'support.reply', thread.id, { messageId: message.id });
      return reply.code(201).send(messageDto(message));
    },
  );

  app.post('/admin/support/threads/:id/status', async (request, reply) => {
    const thread = await loadThread(request);
    if (!thread) return notFound(reply);
    const body = supportStatusRequestSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_body' });
    if (body.data.status === thread.status) return detail(thread);
    if (body.data.status === 'open') {
      // One open thread per chat: reopening is refused while another is open.
      const [other] = await db
        .select({ id: schema.supportThreads.id })
        .from(schema.supportThreads)
        .where(
          and(
            eq(schema.supportThreads.chatId, thread.chatId),
            eq(schema.supportThreads.status, 'open'),
          ),
        );
      if (other) return reply.code(409).send({ error: 'another_thread_open', threadId: other.id });
    }
    const now = new Date();
    const [updated] = await db
      .update(schema.supportThreads)
      .set(
        body.data.status === 'closed'
          ? { status: 'closed', closedAt: now }
          : { status: 'open', closedAt: null },
      )
      .where(eq(schema.supportThreads.id, thread.id))
      .returning();
    if (body.data.status === 'closed') {
      // The user learns it is closed — through the same queued delivery.
      await db.insert(schema.supportMessages).values({
        threadId: thread.id,
        chatId: thread.chatId,
        direction: 'admin',
        text: supportTexts.closedByAdmin,
        authorUserId: actor(request),
        deliveryStatus: 'pending',
        nextAttemptAt: now,
        createdAt: now,
      });
    }
    await audit(
      request,
      `support.${body.data.status === 'closed' ? 'close' : 'reopen'}`,
      thread.id,
    );
    return detail(updated!);
  });

  // Find someone to write to first: by name or by account id. One person at
  // a time — there is no «write to everyone» here (that is Рассылки).
  app.get('/admin/support/users', async (request, reply) => {
    const query = searchQuery.safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: 'invalid_query' });
    const q = query.data.q;
    const like = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    const users = await db
      .select({
        id: schema.users.id,
        displayName: schema.users.displayName,
        firstName: schema.users.firstName,
        lastName: schema.users.lastName,
      })
      .from(schema.users)
      .where(
        UUID_RE.test(q)
          ? eq(schema.users.id, q.toLowerCase())
          : or(
              ilike(schema.users.displayName, like),
              ilike(schema.users.firstName, like),
              ilike(schema.users.lastName, like),
            ),
      )
      .orderBy(desc(schema.users.lastSeenAt))
      .limit(20);
    const items: SupportUserSearchItem[] = [];
    for (const user of users) {
      const reach = await telegramReachability(db, user.id);
      const reason = unreachableReason(reach);
      const [open] =
        reach.telegramId !== null
          ? await db
              .select({ id: schema.supportThreads.id })
              .from(schema.supportThreads)
              .where(
                and(
                  eq(schema.supportThreads.chatId, reach.telegramId),
                  eq(schema.supportThreads.status, 'open'),
                ),
              )
          : [];
      items.push({
        userId: user.id,
        name: supportName(user),
        reachable: reason === null,
        reason,
        openThreadId: open?.id ?? null,
      });
    }
    return { items };
  });

  app.post(
    '/admin/support/start',
    { config: { rateLimit: { max: 20, timeWindow: '10 minutes' } } },
    async (request, reply) => {
      const body = supportStartRequestSchema.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: 'invalid_body' });
      const reach = await telegramReachability(db, body.data.userId);
      const reason = unreachableReason(reach);
      if (reason) return reply.code(409).send({ error: 'unreachable', reason });
      const chatId = reach.telegramId!;
      const now = new Date();
      // Reuse the chat's open thread, or open one (the partial unique index
      // settles a race: the loser reads the winner's thread).
      let [thread] = await db
        .select()
        .from(schema.supportThreads)
        .where(
          and(eq(schema.supportThreads.chatId, chatId), eq(schema.supportThreads.status, 'open')),
        );
      if (!thread) {
        [thread] = await db
          .insert(schema.supportThreads)
          .values({
            chatId,
            userId: body.data.userId,
            openedBy: 'admin',
            createdAt: now,
            lastMessageAt: now,
            adminReadAt: now,
          })
          .onConflictDoNothing()
          .returning();
        thread ??= (
          await db
            .select()
            .from(schema.supportThreads)
            .where(
              and(
                eq(schema.supportThreads.chatId, chatId),
                eq(schema.supportThreads.status, 'open'),
              ),
            )
        )[0];
      }
      const message = await queueReply(thread!, actor(request), body.data.text);
      await audit(request, 'support.start', thread!.id, { messageId: message.id });
      return reply.code(201).send({ threadId: thread!.id });
    },
  );

  // An attachment the user sent: streamed from Telegram (the bot token
  // stays on the server; the URL with it is never logged or returned).
  app.get('/admin/support/messages/:id/files/:index', async (request, reply) => {
    const params = fileParams.safeParse(request.params);
    if (!params.success) return notFound(reply);
    const [message] = await db
      .select()
      .from(schema.supportMessages)
      .where(eq(schema.supportMessages.id, params.data.id));
    const attachment = message?.attachments[params.data.index];
    if (!attachment) return notFound(reply);
    if (!botToken) return reply.code(503).send({ error: 'telegram_not_configured' });
    try {
      const info = await fetchImpl(
        `${telegramApiBase}/bot${botToken}/getFile?file_id=${encodeURIComponent(attachment.fileId)}`,
        { signal: AbortSignal.timeout(15_000) },
      );
      const json = (await info.json()) as { ok?: boolean; result?: { file_path?: string } };
      const path = json.ok ? json.result?.file_path : undefined;
      if (!path) return reply.code(502).send({ error: 'file_unavailable' });
      const file = await fetchImpl(`${telegramApiBase}/file/bot${botToken}/${path}`, {
        signal: AbortSignal.timeout(30_000),
      });
      if (!file.ok || !file.body) return reply.code(502).send({ error: 'file_unavailable' });
      const bytes = Buffer.from(await file.arrayBuffer());
      const isImage =
        attachment.kind === 'photo' ||
        /^image\/(png|jpeg|webp|gif)$/.test(attachment.mimeType ?? '');
      const type = isImage
        ? attachment.kind === 'photo'
          ? 'image/jpeg'
          : attachment.mimeType!
        : 'application/octet-stream';
      const name = (attachment.fileName ?? `file-${params.data.index}`).replace(
        /[^\w.\-() ]+/g,
        '_',
      );
      return reply
        .header('content-type', type)
        .header('x-content-type-options', 'nosniff')
        .header('content-security-policy', "default-src 'none'; sandbox")
        .header('cache-control', 'private, no-store')
        .header('content-disposition', `${isImage ? 'inline' : 'attachment'}; filename="${name}"`)
        .send(bytes);
    } catch (error) {
      // Never the URL (it carries the token) — only what went wrong.
      request.log.warn(
        { kind: error instanceof Error ? error.name : 'unknown' },
        'support attachment fetch failed',
      );
      return reply.code(502).send({ error: 'file_unavailable' });
    }
  });
};
