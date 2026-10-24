import { schema } from '@zybrilka/db';
import type { Database } from '@zybrilka/db';
import {
  BROADCAST_IMAGE_MAX_BYTES,
  BROADCAST_IMAGE_TYPES,
  BROADCAST_MAX_IMAGES,
  parseTelegramHtml,
  planBroadcast,
} from '@zybrilka/shared';
import { and, asc, count, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { readImageHeader } from '../profile/image.js';
import { writeAudit } from './audit.js';
import { loadWorkerStatus } from './reports/notifications.js';

export interface BroadcastRoutesOptions {
  db: Database;
}

const idParams = z.object({ id: z.uuid() });
const attachmentParams = z.object({ id: z.uuid(), attachmentId: z.uuid() });
const draftSchema = z
  .object({
    text: z.string().max(20_000),
    mediaMode: z.enum(schema.broadcastMediaModes),
  })
  .partial()
  .strict();

type Broadcast = typeof schema.broadcasts.$inferSelect;

/** Who can be reached: chats that started the bot and did not block it. */
export async function estimateRecipients(db: Database): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(schema.telegramBotChats)
    .where(isNull(schema.telegramBotChats.blockedAt));
  return row?.n ?? 0;
}

async function attachmentsOf(db: Database, broadcastId: string) {
  return db
    .select({
      id: schema.broadcastAttachments.id,
      position: schema.broadcastAttachments.position,
      contentType: schema.broadcastAttachments.contentType,
      sizeBytes: schema.broadcastAttachments.sizeBytes,
      width: schema.broadcastAttachments.width,
      height: schema.broadcastAttachments.height,
    })
    .from(schema.broadcastAttachments)
    .where(eq(schema.broadcastAttachments.broadcastId, broadcastId))
    .orderBy(asc(schema.broadcastAttachments.position));
}

/** Whether the content can be sent as it is, and how (or why not). */
function validate(b: Pick<Broadcast, 'text' | 'mediaMode'>, images: number) {
  const parsed = parseTelegramHtml(b.text);
  if (!parsed.ok) return { ok: false as const, error: parsed.error };
  const plan = planBroadcast(parsed.visibleLength, images, b.mediaMode);
  if (!plan.ok) return { ok: false as const, error: plan.error };
  return { ok: true as const, parts: plan.parts, visibleLength: parsed.visibleLength };
}

async function detail(db: Database, b: Broadcast) {
  const attachments = await attachmentsOf(db, b.id);
  const deliveries = await db
    .select({
      status: schema.broadcastDeliveries.status,
      errorCode: schema.broadcastDeliveries.errorCode,
      n: count(),
    })
    .from(schema.broadcastDeliveries)
    .where(eq(schema.broadcastDeliveries.broadcastId, b.id))
    .groupBy(schema.broadcastDeliveries.status, schema.broadcastDeliveries.errorCode);
  return {
    broadcast: b,
    attachments,
    validation: validate(b, attachments.length),
    recipientsEstimate: await estimateRecipients(db),
    deliveries,
    worker: await loadWorkerStatus(db),
  };
}

/**
 * «Рассылки» — admin API (owner-only: registered inside the admin scope,
 * so the owner check, the write header, the rate limit and the error
 * handler all apply). Nothing here sends anything: sending is done by the
 * worker, and only for a broadcast whose status became `sending` through
 * POST …/confirm. Every state change is one conditional UPDATE on the
 * expected current status — a double click or two tabs can't start the
 * same broadcast twice — and is written to the audit log.
 */
export const broadcastRoutes: FastifyPluginAsync<BroadcastRoutesOptions> = async (app, { db }) => {
  app.addContentTypeParser(
    [...BROADCAST_IMAGE_TYPES],
    { parseAs: 'buffer', bodyLimit: BROADCAST_IMAGE_MAX_BYTES + 1 },
    (_request, body, done) => done(null, body),
  );

  const actor = (request: FastifyRequest) => request.sessionUserId!;
  const audit = (request: FastifyRequest, action: string, id: string, details?: object) =>
    writeAudit(db, {
      actorUserId: actor(request),
      action,
      objectType: 'broadcast',
      objectId: id,
      result: 'ok',
      details: details as Record<string, unknown> | undefined,
    });
  const load = async (id: string) =>
    (await db.select().from(schema.broadcasts).where(eq(schema.broadcasts.id, id)))[0];
  const params = (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = idParams.safeParse(request.params);
    if (!parsed.success) {
      void reply.code(400).send({ error: 'invalid_id' });
      return null;
    }
    return parsed.data.id;
  };
  /** Moves a broadcast from one of `from` to `to` — or reports why not. */
  const transition = async (
    id: string,
    from: readonly (typeof schema.broadcastStatuses)[number][],
    set: Partial<Broadcast>,
  ) =>
    (
      await db
        .update(schema.broadcasts)
        .set({ ...set, updatedAt: new Date() })
        .where(and(eq(schema.broadcasts.id, id), inArray(schema.broadcasts.status, [...from])))
        .returning()
    )[0];

  app.get('/admin/broadcasts', async () => {
    const items = await db
      .select({
        id: schema.broadcasts.id,
        status: schema.broadcasts.status,
        text: sql<string>`left(${schema.broadcasts.text}, 160)`,
        createdAt: schema.broadcasts.createdAt,
        finishedAt: schema.broadcasts.finishedAt,
        recipientsTotal: schema.broadcasts.recipientsTotal,
        sentCount: schema.broadcasts.sentCount,
        failedCount: schema.broadcasts.failedCount,
        blockedCount: schema.broadcasts.blockedCount,
        attachments: sql<number>`(SELECT count(*)::int FROM broadcast_attachments a WHERE a.broadcast_id = ${schema.broadcasts.id})`,
      })
      .from(schema.broadcasts)
      .orderBy(desc(schema.broadcasts.createdAt))
      .limit(100);
    return {
      items,
      recipientsEstimate: await estimateRecipients(db),
      worker: await loadWorkerStatus(db),
    };
  });

  app.post('/admin/broadcasts', async (request, reply) => {
    const body = draftSchema.safeParse(request.body ?? {});
    if (!body.success) return reply.code(400).send({ error: 'invalid_body' });
    const [created] = await db
      .insert(schema.broadcasts)
      .values({ authorUserId: actor(request), ...body.data })
      .returning();
    await audit(request, 'broadcast.created', created!.id);
    return reply.code(201).send(await detail(db, created!));
  });

  app.get('/admin/broadcasts/:id', async (request, reply) => {
    const id = params(request, reply);
    if (!id) return reply;
    const b = await load(id);
    return b ? detail(db, b) : reply.code(404).send({ error: 'not_found' });
  });

  // Content can change only while it is a draft.
  app.patch('/admin/broadcasts/:id', async (request, reply) => {
    const id = params(request, reply);
    if (!id) return reply;
    const body = draftSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_body' });
    const updated = await transition(id, ['draft'], body.data);
    if (!updated) return reply.code(409).send({ error: 'not_a_draft' });
    return detail(db, updated);
  });

  app.post(
    '/admin/broadcasts/:id/attachments',
    { bodyLimit: BROADCAST_IMAGE_MAX_BYTES + 1 },
    async (request, reply) => {
      const id = params(request, reply);
      if (!id) return reply;
      if (!Buffer.isBuffer(request.body)) {
        return reply.code(415).send({ error: 'unsupported_media_type' });
      }
      const bytes = request.body;
      if (bytes.length > BROADCAST_IMAGE_MAX_BYTES)
        return reply.code(413).send({ error: 'too_large' });
      const image = readImageHeader(bytes);
      if (
        'problem' in image ||
        !(BROADCAST_IMAGE_TYPES as readonly string[]).includes(image.contentType)
      ) {
        return reply.code(400).send({ error: 'invalid_image' });
      }
      // Telegram's own photo limits.
      const ratio =
        Math.max(image.width, image.height) / Math.max(1, Math.min(image.width, image.height));
      if (
        image.width + image.height > 10_000 ||
        ratio > 20 ||
        image.width < 10 ||
        image.height < 10
      ) {
        return reply.code(400).send({ error: 'bad_dimensions' });
      }
      const b = await load(id);
      if (!b) return reply.code(404).send({ error: 'not_found' });
      if (b.status !== 'draft') return reply.code(409).send({ error: 'not_a_draft' });
      const existing = await attachmentsOf(db, id);
      if (existing.length >= BROADCAST_MAX_IMAGES) {
        return reply.code(409).send({ error: 'too_many_images' });
      }
      const position = (existing.at(-1)?.position ?? 0) + 1;
      await db.insert(schema.broadcastAttachments).values({
        broadcastId: id,
        position,
        contentType: image.contentType,
        data: bytes,
        sizeBytes: bytes.length,
        width: image.width,
        height: image.height,
      });
      await audit(request, 'broadcast.attachment_added', id, { position });
      return reply.code(201).send(await detail(db, (await load(id))!));
    },
  );

  app.delete('/admin/broadcasts/:id/attachments/:attachmentId', async (request, reply) => {
    const p = attachmentParams.safeParse(request.params);
    if (!p.success) return reply.code(400).send({ error: 'invalid_id' });
    const b = await load(p.data.id);
    if (!b) return reply.code(404).send({ error: 'not_found' });
    if (b.status !== 'draft') return reply.code(409).send({ error: 'not_a_draft' });
    const removed = await db
      .delete(schema.broadcastAttachments)
      .where(
        and(
          eq(schema.broadcastAttachments.id, p.data.attachmentId),
          eq(schema.broadcastAttachments.broadcastId, p.data.id),
        ),
      )
      .returning({ id: schema.broadcastAttachments.id });
    if (removed.length === 0) return reply.code(404).send({ error: 'not_found' });
    await audit(request, 'broadcast.attachment_removed', p.data.id);
    return detail(db, b);
  });

  // The stored image, for the preview. Served inert (no sniffing, no scripts).
  app.get('/admin/broadcasts/:id/attachments/:attachmentId', async (request, reply) => {
    const p = attachmentParams.safeParse(request.params);
    if (!p.success) return reply.code(400).send({ error: 'invalid_id' });
    const [a] = await db
      .select({
        data: schema.broadcastAttachments.data,
        contentType: schema.broadcastAttachments.contentType,
      })
      .from(schema.broadcastAttachments)
      .where(
        and(
          eq(schema.broadcastAttachments.id, p.data.attachmentId),
          eq(schema.broadcastAttachments.broadcastId, p.data.id),
        ),
      );
    if (!a) return reply.code(404).send({ error: 'not_found' });
    return reply
      .header('content-type', a.contentType)
      .header('x-content-type-options', 'nosniff')
      .header('content-security-policy', "default-src 'none'; sandbox")
      .header('cache-control', 'private, no-store')
      .send(a.data);
  });

  // Draft → «ожидает подтверждения»: the content is frozen for review.
  app.post('/admin/broadcasts/:id/prepare', async (request, reply) => {
    const id = params(request, reply);
    if (!id) return reply;
    const b = await load(id);
    if (!b) return reply.code(404).send({ error: 'not_found' });
    const check = validate(b, (await attachmentsOf(db, id)).length);
    if (!check.ok) return reply.code(400).send({ error: 'invalid_content', message: check.error });
    const moved = await transition(id, ['draft'], { status: 'awaiting_confirmation' });
    if (!moved) return reply.code(409).send({ error: 'not_a_draft' });
    await audit(request, 'broadcast.prepared', id);
    return detail(db, moved);
  });

  app.post('/admin/broadcasts/:id/edit', async (request, reply) => {
    const id = params(request, reply);
    if (!id) return reply;
    const moved = await transition(id, ['awaiting_confirmation'], { status: 'draft' });
    if (!moved) return reply.code(409).send({ error: 'not_awaiting_confirmation' });
    await audit(request, 'broadcast.back_to_draft', id);
    return detail(db, moved);
  });

  /**
   * The ONLY way a broadcast starts. Needs `{ confirm: true }` and the
   * `awaiting_confirmation` status; the single conditional UPDATE means a
   * second click (or tab) gets 409 instead of a second broadcast.
   */
  app.post('/admin/broadcasts/:id/confirm', async (request, reply) => {
    const id = params(request, reply);
    if (!id) return reply;
    const body = z
      .object({ confirm: z.literal(true) })
      .strict()
      .safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'confirmation_required' });
    const b = await load(id);
    if (!b) return reply.code(404).send({ error: 'not_found' });
    const check = validate(b, (await attachmentsOf(db, id)).length);
    if (!check.ok) return reply.code(400).send({ error: 'invalid_content', message: check.error });
    const moved = await transition(id, ['awaiting_confirmation'], {
      status: 'sending',
      confirmedAt: new Date(),
      confirmedByUserId: actor(request),
    });
    if (!moved) return reply.code(409).send({ error: 'not_awaiting_confirmation' });
    await audit(request, 'broadcast.confirmed', id, {
      recipientsEstimate: await estimateRecipients(db),
    });
    return detail(db, moved);
  });

  // Cancels a draft / a pending confirmation, or stops a running broadcast:
  // the worker sends nothing more once it sees `cancelled`.
  app.post('/admin/broadcasts/:id/cancel', async (request, reply) => {
    const id = params(request, reply);
    if (!id) return reply;
    const moved = await transition(id, ['draft', 'awaiting_confirmation', 'sending'], {
      status: 'cancelled',
      finishedAt: new Date(),
    });
    if (!moved) return reply.code(409).send({ error: 'already_finished' });
    await audit(request, 'broadcast.cancelled', id);
    return detail(db, moved);
  });

  // «Отправить себе»: the worker sends the content to the owners only.
  app.post(
    '/admin/broadcasts/:id/test',
    { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } },
    async (request, reply) => {
      const id = params(request, reply);
      if (!id) return reply;
      const b = await load(id);
      if (!b) return reply.code(404).send({ error: 'not_found' });
      const check = validate(b, (await attachmentsOf(db, id)).length);
      if (!check.ok)
        return reply.code(400).send({ error: 'invalid_content', message: check.error });
      const moved = await transition(id, ['draft', 'awaiting_confirmation'], {
        testRequestedAt: new Date(),
        testStatus: 'pending',
      });
      if (!moved) return reply.code(409).send({ error: 'not_editable' });
      await audit(request, 'broadcast.test_requested', id);
      return reply.code(202).send(await detail(db, moved));
    },
  );
};
