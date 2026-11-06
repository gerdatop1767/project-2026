import { audienceRowsSql, schema, type AudienceRow } from '@zybrilka/db';
import type { Database } from '@zybrilka/db';
import {
  BROADCAST_IMAGE_MAX_BYTES,
  BROADCAST_IMAGE_TYPES,
  BROADCAST_BUTTON_TEXT_MAX,
  BROADCAST_MAX_IMAGES,
  broadcastAudienceSchema,
  broadcastButtonFits,
  parseTelegramHtml,
  planBroadcast,
  type BroadcastAudience,
  type BroadcastAudiencePreview,
} from '@zybrilka/shared';
import { and, asc, count, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { readImageHeader } from '../profile/image.js';
import { writeAudit } from './audit.js';
import { loadWorkerStatus } from './reports/notifications.js';
import { rows as sqlRows } from './sql.js';

export interface BroadcastRoutesOptions {
  db: Database;
}

const idParams = z.object({ id: z.uuid() });
const attachmentParams = z.object({ id: z.uuid(), attachmentId: z.uuid() });
const draftSchema = z
  .object({
    text: z.string().max(20_000),
    mediaMode: z.enum(schema.broadcastMediaModes),
    /** «Возврат пользователей»; null → every chat that started the bot. */
    audience: broadcastAudienceSchema.nullable(),
    trackClicks: z.boolean(),
    buttonText: z.string().trim().max(BROADCAST_BUTTON_TEXT_MAX).nullable(),
  })
  .partial()
  .strict();

/** The stored draft fields, with the stage copied out for the repeat guard. */
function draftValues(data: z.infer<typeof draftSchema>) {
  const { audience, ...rest } = data;
  return {
    ...rest,
    ...(audience !== undefined
      ? { audience: audience as Record<string, unknown> | null, stage: audience?.stage ?? null }
      : {}),
  };
}

function storedAudience(b: Pick<Broadcast, 'audience'>): BroadcastAudience | null {
  if (!b.audience) return null;
  const parsed = broadcastAudienceSchema.safeParse(b.audience);
  return parsed.success ? parsed.data : null;
}

/**
 * Who would get it if confirmed now — the same SQL the worker snapshots
 * with (@zybrilka/db audienceRowsSql). The sample lists users without
 * contacts: name, registration, last activity, tasks solved.
 */
export async function previewAudience(
  db: Database,
  audience: BroadcastAudience,
  broadcastId: string | null,
  now = new Date(),
): Promise<BroadcastAudiencePreview & { excluded: BroadcastAudiencePreview['sample'] }> {
  const list = await sqlRows<AudienceRow>(
    db,
    sql`SELECT * FROM (${audienceRowsSql(audience, { now, broadcastId })}) a
      ORDER BY a.registered_at DESC, a.user_id`,
  );
  const by = (state: AudienceRow['state']) => list.filter((r) => r.state === state);
  const user = (r: AudienceRow) => ({
    id: r.user_id,
    name: r.name,
    registeredAt: r.registered_at,
    lastActiveAt: r.last_active,
    solved: Number(r.solved),
  });
  return {
    count: by('ok').length,
    leftOut: {
      noBotChat: by('no_bot_chat').length,
      notificationsOff: by('notifications_off').length,
      stageAlreadySent: by('stage_sent').length,
      excludedByHand: by('excluded').length,
    },
    sample: by('ok').slice(0, 200).map(user),
    excluded: by('excluded').slice(0, 200).map(user),
  };
}

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
function validate(
  b: Pick<Broadcast, 'text' | 'mediaMode' | 'trackClicks' | 'audience'>,
  images: number,
) {
  const parsed = parseTelegramHtml(b.text);
  if (!parsed.ok) return { ok: false as const, error: parsed.error };
  const plan = planBroadcast(parsed.visibleLength, images, b.mediaMode);
  if (!plan.ok) return { ok: false as const, error: plan.error };
  if (b.trackClicks && !broadcastButtonFits(plan.parts)) {
    return {
      ok: false as const,
      error:
        'Кнопку со ссылкой нельзя прикрепить к альбому: выберите «Картинки, затем текст» — кнопка будет под текстом.',
    };
  }
  if (b.audience && !storedAudience(b)) {
    return { ok: false as const, error: 'Фильтры аудитории заданы неверно — сохраните их заново.' };
  }
  return { ok: true as const, parts: plan.parts, visibleLength: parsed.visibleLength };
}

/**
 * Reaction to a broadcast, per recipient with an account, within 7 days of
 * the delivery (docs/TELEGRAM_BOT.md §Реакция):
 * - delivered: Telegram accepted the message. Telegram does not say whether
 *   it was read, so «прочитано» is never shown;
 * - clicked: the recipient's own button link was opened (tracked broadcasts);
 * - returned: a click, a sign-in, an answer (tasks or mini-games) or a
 *   consented analytics event after the delivery;
 * - activity: answers and distinct tasks solved after the delivery.
 */
export async function broadcastReactions(db: Database, ids: readonly string[]) {
  if (ids.length === 0) return new Map<string, Reaction>();
  const list = await sqlRows<Reaction & { broadcastId: string }>(
    db,
    sql`SELECT d.broadcast_id::text AS "broadcastId",
        count(*) FILTER (WHERE d.status = 'sent')::int AS delivered,
        count(*) FILTER (WHERE d.status = 'sent' AND d.user_id IS NOT NULL)::int AS "deliveredToUsers",
        count(*) FILTER (WHERE d.clicked_at IS NOT NULL)::int AS clicked,
        count(*) FILTER (WHERE r.returned)::int AS returned,
        count(*) FILTER (WHERE r.returned_1d)::int AS "returned1d",
        count(*) FILTER (WHERE r.answers > 0)::int AS "activeAfter",
        coalesce(sum(r.answers), 0)::int AS "answersAfter",
        coalesce(sum(r.solved), 0)::int AS "solvedAfter"
      FROM broadcast_deliveries d
      CROSS JOIN LATERAL (
        SELECT
          d.status = 'sent' AND d.user_id IS NOT NULL AND (
            d.clicked_at IS NOT NULL
            OR EXISTS (SELECT 1 FROM attempts t WHERE t.user_id = d.user_id AND t.created_at > d.sent_at AND t.created_at <= d.sent_at + interval '7 days')
            OR EXISTS (SELECT 1 FROM mini_game_answers g WHERE g.user_id = d.user_id AND g.created_at > d.sent_at AND g.created_at <= d.sent_at + interval '7 days')
            OR EXISTS (SELECT 1 FROM auth_sessions s WHERE s.user_id = d.user_id AND s.created_at > d.sent_at AND s.created_at <= d.sent_at + interval '7 days')
            OR EXISTS (SELECT 1 FROM analytics_events e WHERE e.user_id = d.user_id AND e.occurred_at > d.sent_at AND e.occurred_at <= d.sent_at + interval '7 days')
          ) AS returned,
          d.status = 'sent' AND d.user_id IS NOT NULL AND (
            d.clicked_at <= d.sent_at + interval '1 day'
            OR EXISTS (SELECT 1 FROM attempts t WHERE t.user_id = d.user_id AND t.created_at > d.sent_at AND t.created_at <= d.sent_at + interval '1 day')
            OR EXISTS (SELECT 1 FROM mini_game_answers g WHERE g.user_id = d.user_id AND g.created_at > d.sent_at AND g.created_at <= d.sent_at + interval '1 day')
            OR EXISTS (SELECT 1 FROM auth_sessions s WHERE s.user_id = d.user_id AND s.created_at > d.sent_at AND s.created_at <= d.sent_at + interval '1 day')
            OR EXISTS (SELECT 1 FROM analytics_events e WHERE e.user_id = d.user_id AND e.occurred_at > d.sent_at AND e.occurred_at <= d.sent_at + interval '1 day')
          ) AS returned_1d,
          CASE WHEN d.status = 'sent' AND d.user_id IS NOT NULL THEN
            (SELECT count(*) FROM attempts t WHERE t.user_id = d.user_id AND t.created_at > d.sent_at AND t.created_at <= d.sent_at + interval '7 days')
            + (SELECT count(*) FROM mini_game_answers g WHERE g.user_id = d.user_id AND g.created_at > d.sent_at AND g.created_at <= d.sent_at + interval '7 days')
          ELSE 0 END AS answers,
          CASE WHEN d.status = 'sent' AND d.user_id IS NOT NULL THEN
            (SELECT count(DISTINCT t.task_id) FROM attempts t WHERE t.user_id = d.user_id AND t.is_correct AND t.created_at > d.sent_at AND t.created_at <= d.sent_at + interval '7 days')
          ELSE 0 END AS solved
      ) r
      WHERE d.broadcast_id IN ${ids}
      GROUP BY d.broadcast_id`,
  );
  return new Map(
    list.map(({ broadcastId, ...r }) => [
      broadcastId,
      {
        ...r,
        conversionPercent:
          r.deliveredToUsers > 0 ? Math.round((r.returned / r.deliveredToUsers) * 1000) / 10 : null,
      },
    ]),
  );
}

export interface Reaction {
  delivered: number;
  deliveredToUsers: number;
  clicked: number;
  returned: number;
  returned1d: number;
  activeAfter: number;
  answersAfter: number;
  solvedAfter: number;
  conversionPercent?: number | null;
}

async function detail(db: Database, b: Broadcast) {
  const attachments = await attachmentsOf(db, b.id);
  const deliveries = await db
    .select({
      status: schema.broadcastDeliveries.status,
      errorCode: schema.broadcastDeliveries.errorCode,
      // A code like ECONNRESET / TIMEOUT / HTTP_502 — never error text.
      errorDetail: schema.broadcastDeliveries.errorDetail,
      n: count(),
    })
    .from(schema.broadcastDeliveries)
    .where(eq(schema.broadcastDeliveries.broadcastId, b.id))
    .groupBy(
      schema.broadcastDeliveries.status,
      schema.broadcastDeliveries.errorCode,
      schema.broadcastDeliveries.errorDetail,
    );
  const audience = storedAudience(b);
  const audiencePreview =
    audience && b.recipientsTotal === null ? await previewAudience(db, audience, b.id) : null;
  return {
    broadcast: b,
    attachments,
    validation: validate(b, attachments.length),
    recipientsEstimate: audiencePreview ? audiencePreview.count : await estimateRecipients(db),
    audiencePreview,
    reaction:
      b.recipientsTotal === null
        ? null
        : ((await broadcastReactions(db, [b.id])).get(b.id) ?? null),
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
        stage: schema.broadcasts.stage,
        targeted: sql<boolean>`${schema.broadcasts.audience} IS NOT NULL`,
        trackClicks: schema.broadcasts.trackClicks,
        authorName: sql<
          string | null
        >`(SELECT coalesce(nullif(u.display_name, ''), nullif(trim(concat_ws(' ', u.first_name, u.last_name)), '')) FROM users u WHERE u.id = ${schema.broadcasts.authorUserId})`,
      })
      .from(schema.broadcasts)
      .orderBy(desc(schema.broadcasts.createdAt))
      .limit(100);
    const reactions = await broadcastReactions(
      db,
      items.filter((i) => i.recipientsTotal !== null).map((i) => i.id),
    );
    const withReaction = items.map((i) => ({ ...i, reaction: reactions.get(i.id) ?? null }));
    const totals = [...reactions.values()].reduce(
      (t, r) => ({
        delivered: t.delivered + r.delivered,
        deliveredToUsers: t.deliveredToUsers + r.deliveredToUsers,
        clicked: t.clicked + r.clicked,
        returned: t.returned + r.returned,
        activeAfter: t.activeAfter + r.activeAfter,
        solvedAfter: t.solvedAfter + r.solvedAfter,
      }),
      {
        delivered: 0,
        deliveredToUsers: 0,
        clicked: 0,
        returned: 0,
        activeAfter: 0,
        solvedAfter: 0,
      },
    );
    return {
      items: withReaction,
      totals: {
        ...totals,
        conversionPercent:
          totals.deliveredToUsers > 0
            ? Math.round((totals.returned / totals.deliveredToUsers) * 1000) / 10
            : null,
      },
      recipientsEstimate: await estimateRecipients(db),
      worker: await loadWorkerStatus(db),
    };
  });

  app.post('/admin/broadcasts', async (request, reply) => {
    const body = draftSchema.safeParse(request.body ?? {});
    if (!body.success) return reply.code(400).send({ error: 'invalid_body' });
    const [created] = await db
      .insert(schema.broadcasts)
      .values({ authorUserId: actor(request), ...draftValues(body.data) })
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
    const updated = await transition(id, ['draft'], draftValues(body.data));
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
  // «Возврат пользователей»: count, reasons and a list for the filters as
  // they are on screen (not yet saved). Reads only.
  app.post('/admin/broadcasts/audience/preview', async (request, reply) => {
    const body = z
      .object({ audience: broadcastAudienceSchema, broadcastId: z.uuid().nullable().default(null) })
      .strict()
      .safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_body' });
    return previewAudience(db, body.data.audience, body.data.broadcastId);
  });

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
    const audience = storedAudience(moved);
    await audit(request, 'broadcast.confirmed', id, {
      recipientsEstimate: audience
        ? (await previewAudience(db, audience, id)).count
        : await estimateRecipients(db),
      ...(audience ? { stage: audience.stage, allowRepeat: audience.allowRepeat } : {}),
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
