import { randomBytes } from 'node:crypto';
import {
  applyPendingArticleRevision,
  approveArticleManually,
  articleGate,
  enqueueSeoTask,
  encryptSecret,
  ensureSeoDefaults,
  loadSeoSettings,
  gateReasonText,
  publishSeoArticle,
  saveArticleRevision,
  saveSeoSettings,
  scheduleSeoArticle,
  schema,
  uniqueArticleSlug,
  unpublishSeoArticle,
  writeSeoLog,
  type Database,
  type GateDecision,
} from '@zybrilka/db';
import {
  articleQualityIssues,
  normalizeQuery,
  queryOverlap,
  renderMarkdown,
  SEO_ARTICLE_STATUSES,
  SEO_INTEGRATIONS,
  SEO_ISSUE_STATUSES,
  SEO_EXTERNAL_POST_STATUSES,
  SEO_TASK_KINDS,
  SEO_AGENTS,
  seoArticlePatchSchema,
  seoSettingsPatchSchema,
  seoSlug,
  type SeoIntegrationKind,
} from '@zybrilka/shared';
import { and, asc, desc, eq, ilike, inArray, sql, type SQL } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { writeAudit } from '../admin/audit.js';
import { rows } from '../admin/sql.js';
import { agentStatusReport, articleMetrics, overviewReport } from './reports.js';

export interface SeoAdminRoutesOptions {
  db: Database;
  /** Parsed SEO_SECRETS_KEY (32 bytes) or null when not configured. */
  secretsKey: Buffer | null;
  origin: string;
}

const idParams = z.object({ id: z.uuid() });
const pageQuery = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(5).max(200).default(30),
});
const confirmBody = z.object({ confirm: z.literal(true) });

/** What each integration needs (shown in the UI; secrets are write-only). */
const integrationConfigSchemas: Record<SeoIntegrationKind, z.ZodType<Record<string, unknown>>> = {
  anthropic: z.object({}).strict(),
  yandex_webmaster: z.object({ hostUrl: z.url().optional() }).strict(),
  yandex_metrika: z
    .object({
      counterId: z.coerce.number().int().positive(),
      registrationGoalId: z.coerce.number().int().positive().optional(),
    })
    .strict(),
  google_search_console: z.object({ siteUrl: z.string().min(5).max(200) }).strict(),
  indexnow: z.object({}).strict(),
  telegram_channel: z
    .object({ channelId: z.string().regex(/^(@[A-Za-z0-9_]{5,64}|-100\d{5,20})$/) })
    .strict(),
  vk: z.object({ groupId: z.coerce.number().int().positive() }).strict(),
};

/**
 * /api/v1/admin/seo/* — AI SEO Center. Registered inside the admin scope,
 * so `requireAdmin`, the cross-site guard and the rate limit already ran.
 * Changes that affect the public site (publish/unpublish, emergency stop,
 * mode) need `confirm: true`; every write goes to the admin audit log and
 * to the agent's own log.
 */
export const seoAdminRoutes: FastifyPluginAsync<SeoAdminRoutesOptions> = async (
  app,
  { db, secretsKey, origin },
) => {
  await ensureSeoDefaults(db);

  const bad = (reply: FastifyReply, code = 'invalid_body') => reply.code(400).send({ error: code });
  const notFound = (reply: FastifyReply) => reply.code(404).send({ error: 'not_found' });
  const actor = (r: FastifyRequest) => r.sessionUserId!;
  const audit = (
    r: FastifyRequest,
    action: string,
    objectId: string,
    details?: Record<string, unknown>,
  ) =>
    writeAudit(db, {
      actorUserId: actor(r),
      action,
      objectType: 'seo',
      objectId,
      result: 'ok',
      details,
    });

  /** 409 from the Publication Safety Gate: why, and whether a manual approval could help. */
  async function gateBlocked(
    r: FastifyRequest,
    reply: FastifyReply,
    articleId: string,
    gate: GateDecision,
  ) {
    await writeAudit(db, {
      actorUserId: actor(r),
      action: 'seo.article.publish_blocked',
      objectType: 'seo',
      objectId: articleId,
      result: 'denied',
      details: { reasons: gate.reasons },
    });
    return reply.code(409).send({
      error: 'fact_check',
      reasons: gate.reasons,
      message: gateReasonText(gate.reasons),
      manualAllowed: gate.manualAllowed,
      criticalContradictions: gate.criticalContradictions,
      unverifiedCritical: gate.unverifiedCritical,
    });
  }

  function parse<T extends z.ZodType>(s: T, v: unknown): z.infer<T> | null {
    const r = s.safeParse(v);
    return r.success ? r.data : null;
  }

  // ── Обзор ───────────────────────────────────────────────────────────
  app.get('/admin/seo/overview', async (request, reply) => {
    const q = parse(
      z.object({
        days: z.coerce
          .number()
          .int()
          .refine((d) => [7, 30, 90].includes(d))
          .default(30),
      }),
      request.query,
    );
    if (!q) return bad(reply, 'invalid_query');
    return overviewReport(db, q.days);
  });

  // ── Агент ───────────────────────────────────────────────────────────
  app.get('/admin/seo/agent', async () => {
    const [settings, status] = await Promise.all([loadSeoSettings(db), agentStatusReport(db)]);
    const recent = await db
      .select()
      .from(schema.seoTasks)
      .orderBy(desc(schema.seoTasks.createdAt))
      .limit(30);
    return {
      settings,
      status,
      recentTasks: recent.map((t) => ({ ...t, payload: undefined })),
      anthropicConfigured: await integrationConfigured('anthropic'),
    };
  });

  async function integrationConfigured(kind: string) {
    const [row] = await db
      .select()
      .from(schema.seoIntegrations)
      .where(eq(schema.seoIntegrations.kind, kind));
    return row?.status === 'connected' || row?.status === 'configured';
  }

  app.put('/admin/seo/settings', async (request, reply) => {
    const body = request.body as Record<string, unknown> | undefined;
    const patch = parse(seoSettingsPatchSchema, body?.settings);
    if (!patch) return bad(reply);
    const before = await loadSeoSettings(db);
    // Turning on autonomous publishing or lifting the emergency stop changes
    // the public site: explicit confirmation.
    const risky =
      (patch.mode === 'auto' && before.mode !== 'auto') ||
      (patch.emergencyStop === false && before.emergencyStop);
    if (risky && body?.confirm !== true)
      return reply.code(400).send({ error: 'confirmation_required' });
    const next = { ...before, ...patch };
    await saveSeoSettings(db, next, actor(request));
    await audit(request, 'seo.settings.updated', 'settings', { patch });
    await writeSeoLog(db, {
      agent: 'system',
      action: 'settings.updated',
      message: `Настройки агента изменены: ${Object.keys(patch).join(', ')}`,
      actorUserId: actor(request),
      details: { patch },
    });
    return { settings: next };
  });

  app.post('/admin/seo/agent/stop', async (request, reply) => {
    const before = await loadSeoSettings(db);
    await saveSeoSettings(db, { ...before, emergencyStop: true }, actor(request));
    const cancelled = await db
      .update(schema.seoTasks)
      .set({ status: 'cancelled', finishedAt: new Date(), error: 'emergency_stop' })
      .where(eq(schema.seoTasks.status, 'queued'))
      .returning({ id: schema.seoTasks.id });
    await audit(request, 'seo.emergency_stop', 'agent', { cancelled: cancelled.length });
    await writeSeoLog(db, {
      agent: 'system',
      level: 'warn',
      action: 'agent.emergency_stop',
      message: `Аварийная остановка. Отменено задач в очереди: ${cancelled.length}`,
      actorUserId: actor(request),
    });
    return reply.send({ stopped: true, cancelled: cancelled.length });
  });

  app.post('/admin/seo/agent/run', async (request, reply) => {
    const body = parse(
      z.object({
        kind: z
          .enum(['daily', 'weekly', 'research', 'sync_metrics', 'technical_audit'])
          .default('daily'),
      }),
      request.body ?? {},
    );
    if (!body) return bad(reply);
    const settings = await loadSeoSettings(db);
    if (settings.emergencyStop) return reply.code(409).send({ error: 'emergency_stop' });
    const key = `manual:${body.kind}:${Date.now()}`;
    const kind = body.kind === 'daily' || body.kind === 'weekly' ? `cycle_${body.kind}` : body.kind;
    await enqueueSeoTask(db, {
      kind,
      agent: kind.startsWith('cycle')
        ? 'system'
        : SEO_TASK_KINDS[kind as keyof typeof SEO_TASK_KINDS],
      idempotencyKey: key,
      payload: { manual: true },
      priority: 90,
    });
    await audit(request, 'seo.agent.run', kind);
    await writeSeoLog(db, {
      agent: 'system',
      action: 'agent.manual_run',
      message: `Внеплановый запуск: ${kind}`,
      actorUserId: actor(request),
    });
    return reply.code(202).send({ queued: true });
  });

  // ── Журнал и задачи ────────────────────────────────────────────────
  app.get('/admin/seo/log', async (request, reply) => {
    const q = parse(
      pageQuery.extend({
        agent: z.enum(SEO_AGENTS).optional(),
        level: z.enum(['info', 'warn', 'error']).optional(),
        articleId: z.uuid().optional(),
      }),
      request.query,
    );
    if (!q) return bad(reply, 'invalid_query');
    const where: SQL[] = [];
    if (q.agent) where.push(eq(schema.seoAgentLog.agent, q.agent));
    if (q.level) where.push(eq(schema.seoAgentLog.level, q.level));
    if (q.articleId) where.push(eq(schema.seoAgentLog.articleId, q.articleId));
    const items = await db
      .select()
      .from(schema.seoAgentLog)
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(schema.seoAgentLog.at))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize);
    return { items, page: q.page, pageSize: q.pageSize };
  });

  app.get('/admin/seo/tasks', async (request, reply) => {
    const q = parse(pageQuery.extend({ status: z.string().max(20).optional() }), request.query);
    if (!q) return bad(reply, 'invalid_query');
    const items = await db
      .select()
      .from(schema.seoTasks)
      .where(q.status ? eq(schema.seoTasks.status, q.status) : undefined)
      .orderBy(desc(schema.seoTasks.createdAt))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize);
    return { items, page: q.page };
  });

  app.post('/admin/seo/tasks/:id/cancel', async (request, reply) => {
    const p = parse(idParams, request.params);
    if (!p) return notFound(reply);
    const [row] = await db
      .update(schema.seoTasks)
      .set({ status: 'cancelled', finishedAt: new Date(), error: 'cancelled_by_admin' })
      .where(
        and(
          eq(schema.seoTasks.id, p.id),
          inArray(schema.seoTasks.status, ['queued', 'failed', 'blocked']),
        ),
      )
      .returning();
    if (!row) return reply.code(409).send({ error: 'not_cancellable' });
    await audit(request, 'seo.task.cancel', p.id);
    return { task: row };
  });

  app.post('/admin/seo/tasks/:id/retry', async (request, reply) => {
    const p = parse(idParams, request.params);
    if (!p) return notFound(reply);
    const [row] = await db
      .update(schema.seoTasks)
      .set({ status: 'queued', attempts: 0, error: null, runAfter: new Date(), lockedUntil: null })
      .where(
        and(
          eq(schema.seoTasks.id, p.id),
          inArray(schema.seoTasks.status, ['failed', 'blocked', 'cancelled']),
        ),
      )
      .returning();
    if (!row) return reply.code(409).send({ error: 'not_retryable' });
    await audit(request, 'seo.task.retry', p.id);
    return { task: row };
  });

  app.get('/admin/seo/usage', async (request, reply) => {
    const q = parse(
      z.object({ days: z.coerce.number().int().min(1).max(366).default(30) }),
      request.query,
    );
    if (!q) return bad(reply, 'invalid_query');
    const byDay = await rows<{
      date: string;
      cost: number;
      calls: number;
      inputTokens: number;
      outputTokens: number;
    }>(
      db,
      sql`SELECT (at AT TIME ZONE 'Europe/Moscow')::date::text AS date, sum((cost_usd)::text::numeric)::float8 AS cost,
                 count(*)::int AS calls, sum(input_tokens + cache_read_tokens + cache_write_tokens)::int AS "inputTokens",
                 sum(output_tokens)::int AS "outputTokens"
          FROM seo_ai_usage WHERE at >= now() - make_interval(days => ${q.days}) GROUP BY 1 ORDER BY 1`,
    );
    const byAgent = await rows<{
      agent: string;
      model: string;
      cost: number;
      calls: number;
      webSearches: number;
    }>(
      db,
      sql`SELECT agent, model, sum((cost_usd)::text::numeric)::float8 AS cost, count(*)::int AS calls, sum(web_searches)::int AS "webSearches"
          FROM seo_ai_usage WHERE at >= now() - make_interval(days => ${q.days}) GROUP BY agent, model ORDER BY cost DESC`,
    );
    return { byDay, byAgent };
  });

  // ── Статьи ─────────────────────────────────────────────────────────
  app.get('/admin/seo/articles', async (request, reply) => {
    const q = parse(
      pageQuery.extend({
        status: z.enum(SEO_ARTICLE_STATUSES).optional(),
        q: z.string().max(100).optional(),
        sort: z.enum(['created', 'published', 'priority', 'score']).default('created'),
      }),
      request.query,
    );
    if (!q) return bad(reply, 'invalid_query');
    const where: SQL[] = [];
    if (q.status) where.push(eq(schema.seoArticles.status, q.status));
    if (q.q) where.push(ilike(schema.seoArticles.title, `%${q.q.replace(/[%_\\]/g, '\\$&')}%`));
    const all = await db
      .select({
        id: schema.seoArticles.id,
        title: schema.seoArticles.title,
        slug: schema.seoArticles.slug,
        status: schema.seoArticles.status,
        format: schema.seoArticles.format,
        subjectId: schema.seoArticles.subjectId,
        primaryKeyword: schema.seoArticles.primaryKeyword,
        secondaryKeywords: schema.seoArticles.secondaryKeywords,
        priority: schema.seoArticles.priority,
        createdAt: schema.seoArticles.createdAt,
        publishedAt: schema.seoArticles.publishedAt,
        scheduledFor: schema.seoArticles.scheduledFor,
        wordCount: schema.seoArticles.wordCount,
      })
      .from(schema.seoArticles)
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(schema.seoArticles.createdAt))
      .limit(2000);
    const metrics = await articleMetrics(db);
    let items = all.map((a) => ({
      ...a,
      url: `${origin}/blog/${a.slug}`,
      metrics: metrics.get(a.id) ?? null,
    }));
    if (q.sort === 'published')
      items.sort((a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0));
    if (q.sort === 'priority') items.sort((a, b) => (b.priority ?? -1) - (a.priority ?? -1));
    if (q.sort === 'score')
      items.sort((a, b) => (b.metrics?.seoScore ?? -1) - (a.metrics?.seoScore ?? -1));
    const total = items.length;
    items = items.slice((q.page - 1) * q.pageSize, q.page * q.pageSize);
    const counts = await rows<{ status: string; n: number }>(
      db,
      sql`SELECT status, count(*)::int AS n FROM seo_articles GROUP BY status`,
    );
    return {
      items,
      total,
      page: q.page,
      pageSize: q.pageSize,
      counts: Object.fromEntries(counts.map((c) => [c.status, c.n])),
    };
  });

  app.post('/admin/seo/articles', async (request, reply) => {
    const body = parse(
      z.object({
        title: z.string().trim().min(5).max(200),
        primaryKeyword: z.string().trim().min(2).max(200).optional(),
        subjectId: z
          .string()
          .regex(/^[a-z_]{1,32}$/)
          .nullable()
          .optional(),
        generate: z.boolean().default(false),
      }),
      request.body,
    );
    if (!body) return bad(reply);
    const slug = await uniqueArticleSlug(db, seoSlug(body.title));
    const [row] = await db
      .insert(schema.seoArticles)
      .values({
        title: body.title,
        slug,
        primaryKeyword: body.primaryKeyword ?? null,
        subjectId: body.subjectId ?? null,
        status: 'idea',
      })
      .returning();
    if (body.generate) {
      await enqueueSeoTask(db, {
        kind: 'write_article',
        agent: 'content',
        idempotencyKey: `write_article:${row!.id}:v1`,
        articleId: row!.id,
        payload: { articleId: row!.id },
        priority: 70,
      });
    }
    await audit(request, 'seo.article.create', row!.id);
    await writeSeoLog(db, {
      agent: 'system',
      action: 'article.created',
      message: `Создана статья-идея «${row!.title}»`,
      articleId: row!.id,
      actorUserId: actor(request),
    });
    return reply.code(201).send({ article: row });
  });

  app.get('/admin/seo/articles/:id', async (request, reply) => {
    const p = parse(idParams, request.params);
    if (!p) return notFound(reply);
    const [a] = await db.select().from(schema.seoArticles).where(eq(schema.seoArticles.id, p.id));
    if (!a) return notFound(reply);
    const [revisions, media, posts, log, metrics, keywords] = await Promise.all([
      db
        .select({
          id: schema.seoArticleRevisions.id,
          version: schema.seoArticleRevisions.version,
          reason: schema.seoArticleRevisions.reason,
          actor: schema.seoArticleRevisions.actor,
          createdAt: schema.seoArticleRevisions.createdAt,
        })
        .from(schema.seoArticleRevisions)
        .where(eq(schema.seoArticleRevisions.articleId, a.id))
        .orderBy(desc(schema.seoArticleRevisions.version)),
      db
        .select({
          id: schema.seoMedia.id,
          fileName: schema.seoMedia.fileName,
          alt: schema.seoMedia.alt,
          kind: schema.seoMedia.kind,
          width: schema.seoMedia.width,
          height: schema.seoMedia.height,
          sizeBytes: schema.seoMedia.sizeBytes,
          description: schema.seoMedia.description,
          origin: schema.seoMedia.origin,
          license: schema.seoMedia.license,
        })
        .from(schema.seoMedia)
        .where(eq(schema.seoMedia.articleId, a.id)),
      db
        .select({
          post: schema.seoExternalPosts,
          platform: schema.seoPlatforms.name,
          platformSlug: schema.seoPlatforms.slug,
          mode: schema.seoPlatforms.mode,
        })
        .from(schema.seoExternalPosts)
        .innerJoin(
          schema.seoPlatforms,
          eq(schema.seoPlatforms.id, schema.seoExternalPosts.platformId),
        )
        .where(eq(schema.seoExternalPosts.articleId, a.id)),
      db
        .select()
        .from(schema.seoAgentLog)
        .where(eq(schema.seoAgentLog.articleId, a.id))
        .orderBy(desc(schema.seoAgentLog.at))
        .limit(50),
      articleMetrics(db),
      db.select().from(schema.seoKeywords).where(eq(schema.seoKeywords.articleId, a.id)),
    ]);
    const mediaMap = new Map(media.map((m) => [m.id, m]));
    const preview = renderMarkdown(a.bodyMd, {
      siteHost: new URL(origin).host,
      resolveImage: (id) => {
        const m = mediaMap.get(id);
        return m
          ? { src: `/blog/media/${m.fileName}`, alt: m.alt, width: m.width, height: m.height }
          : null;
      },
    });
    const internalLinks = preview.links.filter(
      (l) => l.startsWith('/') || l.startsWith(origin),
    ).length;
    const issues = articleQualityIssues(
      {
        bodyMd: a.bodyMd,
        faq: a.faq,
        seoTitle: a.seoTitle ?? '',
        metaDescription: a.metaDescription ?? '',
        primaryKeyword: a.primaryKeyword ?? '',
      },
      {
        wordCount: preview.wordCount,
        h2Count: preview.headings.filter((h) => h.level === 2).length,
        internalLinks,
      },
    );
    return {
      article: a,
      url: `${origin}/blog/${a.slug}`,
      previewHtml: preview.html,
      headings: preview.headings,
      qualityIssues: issues,
      revisions,
      media,
      posts: posts.map((x) => ({
        ...x.post,
        platform: x.platform,
        platformSlug: x.platformSlug,
        mode: x.mode,
      })),
      log,
      keywords,
      metrics: metrics.get(a.id) ?? null,
      publicationGate: articleGate(a, 'publish'),
    };
  });

  app.patch('/admin/seo/articles/:id', async (request, reply) => {
    const p = parse(idParams, request.params);
    if (!p) return notFound(reply);
    // `version` = the version the owner opened in the editor (optional for
    // older clients). A different current version → 409: someone saved meanwhile.
    const { version: expectedVersion, ...rawPatch } = (request.body ?? {}) as Record<
      string,
      unknown
    >;
    const patch = parse(seoArticlePatchSchema, rawPatch);
    if (!patch) return bad(reply);
    const [a] = await db.select().from(schema.seoArticles).where(eq(schema.seoArticles.id, p.id));
    if (!a) return notFound(reply);
    if (['generating'].includes(a.status)) return reply.code(409).send({ error: 'article_busy' });
    if (patch.slug && patch.slug !== a.slug) {
      if (a.status === 'published') return reply.code(409).send({ error: 'slug_locked' });
      const free = await uniqueArticleSlug(db, patch.slug, a.id);
      if (free !== patch.slug) return reply.code(409).send({ error: 'slug_taken' });
    }
    if (expectedVersion !== undefined) {
      if (typeof expectedVersion !== 'number' || !Number.isInteger(expectedVersion))
        return bad(reply);
      if (expectedVersion !== a.version) return reply.code(409).send({ error: 'article_changed' });
    }
    const wordCount = patch.bodyMd ? renderMarkdown(patch.bodyMd).wordCount : a.wordCount;
    // Optimistic concurrency: the edit applies only to the version the owner
    // opened. If the agent (or another tab) saved meanwhile → 409, nothing lost.
    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(schema.seoArticles)
        .set({
          ...patch,
          wordCount,
          version: a.version + 1,
          updatedAt: new Date(),
          status: a.status === 'idea' && patch.bodyMd ? 'draft' : a.status,
        })
        .where(and(eq(schema.seoArticles.id, a.id), eq(schema.seoArticles.version, a.version)))
        .returning();
      if (row) await saveArticleRevision(tx, a, 'manual_edit', `admin:${actor(request)}`);
      return row;
    });
    if (!updated) return reply.code(409).send({ error: 'article_changed' });
    await audit(request, 'seo.article.edit', a.id, { fields: Object.keys(patch) });
    await writeSeoLog(db, {
      agent: 'system',
      action: 'article.edited',
      message: `Статья отредактирована вручную (${Object.keys(patch).join(', ')})`,
      articleId: a.id,
      actorUserId: actor(request),
    });
    return { article: updated };
  });

  app.post('/admin/seo/articles/:id/publish', async (request, reply) => {
    const p = parse(idParams, request.params);
    if (!p || !parse(confirmBody, request.body)) return bad(reply, 'confirmation_required');
    const out = await publishSeoArticle(db, p.id, { kind: 'admin', userId: actor(request) });
    if (!out.ok && out.reason === 'fact_check') return gateBlocked(request, reply, p.id, out.gate);
    if (!out.ok)
      return reply.code(out.reason === 'not_found' ? 404 : 409).send({ error: out.reason });
    await audit(request, 'seo.article.publish', p.id, { basis: out.gate.basis });
    return { article: out.article };
  });

  app.post('/admin/seo/articles/:id/schedule', async (request, reply) => {
    const p = parse(idParams, request.params);
    const body = parse(
      z.object({ at: z.iso.datetime({ offset: true }), confirm: z.literal(true) }),
      request.body,
    );
    if (!p || !body) return bad(reply);
    const out = await scheduleSeoArticle(db, p.id, new Date(body.at));
    if (!out.ok && out.reason === 'fact_check') return gateBlocked(request, reply, p.id, out.gate);
    if (!out.ok)
      return reply
        .code(out.reason === 'not_found' ? 404 : 409)
        .send({ error: out.reason === 'not_found' ? 'not_found' : 'not_schedulable' });
    const row = out.article;
    await audit(request, 'seo.article.schedule', p.id, { at: body.at });
    await writeSeoLog(db, {
      agent: 'system',
      action: 'article.scheduled',
      message: `Публикация запланирована на ${body.at}`,
      articleId: p.id,
      actorUserId: actor(request),
    });
    return { article: row };
  });

  /**
   * The owner's manual fact-check approval of this article's current text
   * (or of a pending update's text). Recorded with who/when/why, bound to the
   * exact text, never shown as «verified»; refused on a critical contradiction.
   */
  app.post('/admin/seo/articles/:id/fact-check/approve', async (request, reply) => {
    const p = parse(idParams, request.params);
    const body = parse(
      z.object({
        reason: z.string().trim().min(10).max(1000),
        revisionId: z.uuid().optional(),
        confirm: z.literal(true),
      }),
      request.body,
    );
    if (!p || !body) return bad(reply);
    const out = await approveArticleManually(db, {
      articleId: p.id,
      adminId: actor(request),
      reason: body.reason,
      revisionId: body.revisionId ?? null,
      now: new Date(),
    });
    if (!out.ok) {
      return reply.code(out.reason === 'not_found' ? 404 : 409).send({ error: out.reason });
    }
    await audit(request, 'seo.article.fact_check_manual', p.id, {
      reason: body.reason,
      revisionId: body.revisionId ?? null,
      contentHash: out.contentHash,
    });
    return { article: out.article };
  });

  app.post('/admin/seo/articles/:id/unpublish', async (request, reply) => {
    const p = parse(idParams, request.params);
    if (!p || !parse(confirmBody, request.body)) return bad(reply, 'confirmation_required');
    const row = await unpublishSeoArticle(db, p.id, actor(request));
    if (!row) return reply.code(409).send({ error: 'not_published' });
    await audit(request, 'seo.article.unpublish', p.id);
    return { article: row };
  });

  app.post('/admin/seo/articles/:id/generate', async (request, reply) => {
    const p = parse(idParams, request.params);
    const body = parse(
      z.object({
        mode: z.enum(['write', 'update', 'visuals', 'review', 'distribute']),
        instructions: z.string().max(2000).optional(),
      }),
      request.body,
    );
    if (!p || !body) return bad(reply);
    const [a] = await db.select().from(schema.seoArticles).where(eq(schema.seoArticles.id, p.id));
    if (!a) return notFound(reply);
    const kind = {
      write: 'write_article',
      update: 'update_article',
      visuals: 'visuals',
      review: 'review_article',
      distribute: 'distribute',
    }[body.mode];
    const queued = await enqueueSeoTask(db, {
      kind,
      agent: SEO_TASK_KINDS[kind as keyof typeof SEO_TASK_KINDS],
      idempotencyKey: `${kind}:${a.id}:manual:${Date.now()}`,
      articleId: a.id,
      payload: { articleId: a.id, instructions: body.instructions ?? null, manual: true },
      priority: 85,
    });
    await audit(request, `seo.article.${body.mode}`, a.id);
    return reply.code(202).send({ queued });
  });

  /** Applies a pending update (written by the agent for a live article) after the owner reviewed it. */
  app.post('/admin/seo/articles/:id/revisions/:rev/apply', async (request, reply) => {
    const p = parse(z.object({ id: z.uuid(), rev: z.uuid() }), request.params);
    if (!p || !parse(confirmBody, request.body)) return bad(reply, 'confirmation_required');
    const [a] = await db.select().from(schema.seoArticles).where(eq(schema.seoArticles.id, p.id));
    const [rev] = await db
      .select()
      .from(schema.seoArticleRevisions)
      .where(
        and(
          eq(schema.seoArticleRevisions.id, p.rev),
          eq(schema.seoArticleRevisions.articleId, p.id),
        ),
      );
    if (!a || !rev) return notFound(reply);
    if (rev.reason !== 'pending_update') return reply.code(409).send({ error: 'not_pending' });
    // Claimed atomically: a worker (or a second click) applying it at the same moment gets nothing.
    const out = await applyPendingArticleRevision(db, {
      articleId: a.id,
      revisionId: rev.id,
      actor: `admin:${actor(request)}`,
      now: new Date(),
    });
    if (!out.ok && out.reason === 'fact_check') return gateBlocked(request, reply, a.id, out.gate);
    if (!out.ok) return reply.code(409).send({ error: 'not_pending' });
    const updated = out.article;
    await audit(request, 'seo.article.apply_update', a.id, { revision: rev.id });
    await writeSeoLog(db, {
      agent: 'system',
      action: 'article.update_applied',
      message: `Обновление статьи «${a.title}» применено`,
      articleId: a.id,
      actorUserId: actor(request),
    });
    return { article: updated };
  });

  app.get('/admin/seo/articles/:id/revisions/:rev', async (request, reply) => {
    const p = parse(z.object({ id: z.uuid(), rev: z.uuid() }), request.params);
    if (!p) return notFound(reply);
    const [r] = await db
      .select()
      .from(schema.seoArticleRevisions)
      .where(
        and(
          eq(schema.seoArticleRevisions.id, p.rev),
          eq(schema.seoArticleRevisions.articleId, p.id),
        ),
      );
    return r ? { revision: r } : notFound(reply);
  });

  // Media upload (PNG/JPEG/WebP only — SVG uploads are refused: they can carry script).
  app.addContentTypeParser(
    ['image/png', 'image/jpeg', 'image/webp'],
    { parseAs: 'buffer', bodyLimit: 3 * 1024 * 1024 },
    (_r, body, done) => done(null, body),
  );
  app.post('/admin/seo/articles/:id/media', async (request, reply) => {
    const p = parse(idParams, request.params);
    const q = parse(
      z.object({
        alt: z.string().trim().min(3).max(200),
        license: z.string().trim().min(3).max(300),
        description: z.string().max(300).optional(),
      }),
      request.query,
    );
    if (!p || !q || !Buffer.isBuffer(request.body)) return bad(reply);
    const bytes = request.body;
    const size = imageSize(bytes);
    if (!size) return reply.code(415).send({ error: 'unsupported_media_type' });
    const [a] = await db
      .select({ id: schema.seoArticles.id, slug: schema.seoArticles.slug })
      .from(schema.seoArticles)
      .where(eq(schema.seoArticles.id, p.id));
    if (!a) return notFound(reply);
    const fileName = `${a.slug.slice(0, 60)}-${randomBytes(4).toString('hex')}.${size.ext}`;
    const [m] = await db
      .insert(schema.seoMedia)
      .values({
        articleId: a.id,
        kind: 'upload',
        fileName,
        mimeType: size.mime,
        bytes,
        sizeBytes: bytes.length,
        width: size.width,
        height: size.height,
        alt: q.alt,
        description: q.description ?? null,
        origin: 'uploaded_by_admin',
        license: q.license,
      })
      .returning({ id: schema.seoMedia.id, fileName: schema.seoMedia.fileName });
    await audit(request, 'seo.media.upload', m!.id, { article: a.id, bytes: bytes.length });
    return reply.code(201).send({ media: m, markdown: `![${q.alt}](media:${m!.id})` });
  });

  // ── Темы ───────────────────────────────────────────────────────────
  app.get('/admin/seo/topics', async (request, reply) => {
    const q = parse(pageQuery.extend({ status: z.string().max(20).optional() }), request.query);
    if (!q) return bad(reply, 'invalid_query');
    const items = await db
      .select()
      .from(schema.seoTopics)
      .where(q.status ? eq(schema.seoTopics.status, q.status) : undefined)
      .orderBy(
        sql`(${schema.seoTopics.priority})::text::float8 DESC NULLS LAST`,
        desc(schema.seoTopics.createdAt),
      )
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize);
    return { items, page: q.page };
  });

  app.patch('/admin/seo/topics/:id', async (request, reply) => {
    const p = parse(idParams, request.params);
    const body = parse(z.object({ action: z.enum(['approve', 'reject', 'reset']) }), request.body);
    if (!p || !body) return bad(reply);
    const [t] = await db.select().from(schema.seoTopics).where(eq(schema.seoTopics.id, p.id));
    if (!t) return notFound(reply);
    if (body.action === 'reject' || body.action === 'reset') {
      await db
        .update(schema.seoTopics)
        .set({ status: body.action === 'reject' ? 'rejected' : 'new', updatedAt: new Date() })
        .where(eq(schema.seoTopics.id, t.id));
    } else {
      if (t.articleId) return reply.code(409).send({ error: 'already_has_article' });
      await db
        .update(schema.seoTopics)
        .set({ status: 'approved', updatedAt: new Date() })
        .where(eq(schema.seoTopics.id, t.id));
      await enqueueSeoTask(db, {
        kind: 'write_article',
        agent: 'content',
        idempotencyKey: `write_topic:${t.id}`,
        payload: { topicId: t.id },
        priority: 75,
      });
    }
    await audit(request, `seo.topic.${body.action}`, t.id);
    return { ok: true };
  });

  // ── Семантика ──────────────────────────────────────────────────────
  app.get('/admin/seo/keywords', async (request, reply) => {
    const q = parse(
      pageQuery.extend({
        filter: z.enum(['all', 'uncovered', 'covered']).default('all'),
        q: z.string().max(100).optional(),
      }),
      request.query,
    );
    if (!q) return bad(reply, 'invalid_query');
    const where: SQL[] = [];
    if (q.filter === 'uncovered') where.push(sql`${schema.seoKeywords.articleId} IS NULL`);
    if (q.filter === 'covered') where.push(sql`${schema.seoKeywords.articleId} IS NOT NULL`);
    if (q.q) where.push(ilike(schema.seoKeywords.query, `%${q.q.replace(/[%_\\]/g, '\\$&')}%`));
    const items = await db
      .select({
        kw: schema.seoKeywords,
        cluster: schema.seoKeywordClusters.name,
        article: schema.seoArticles.title,
      })
      .from(schema.seoKeywords)
      .leftJoin(
        schema.seoKeywordClusters,
        eq(schema.seoKeywordClusters.id, schema.seoKeywords.clusterId),
      )
      .leftJoin(schema.seoArticles, eq(schema.seoArticles.id, schema.seoKeywords.articleId))
      .where(where.length ? and(...where) : undefined)
      .orderBy(sql`${schema.seoKeywords.frequency} DESC NULLS LAST`, asc(schema.seoKeywords.query))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize);
    const [counts] = await rows<{ total: number; covered: number; clusters: number }>(
      db,
      sql`SELECT count(*)::int AS total, count(article_id)::int AS covered, (SELECT count(*)::int FROM seo_keyword_clusters) AS clusters FROM seo_keywords`,
    );
    return {
      items: items.map((i) => ({ ...i.kw, cluster: i.cluster, article: i.article })),
      counts,
      page: q.page,
    };
  });

  /** Two articles competing for the same query (from real search data, then by keyword overlap). */
  app.get('/admin/seo/keywords/cannibalization', async () => {
    const fromSearch = await rows<{ query: string; engine: string; pages: string[] }>(
      db,
      sql`SELECT query, engine, array_agg(DISTINCT page) AS pages FROM seo_search_metrics
          WHERE page LIKE '/blog/%' AND query <> '' AND date >= current_date - 28
          GROUP BY query, engine HAVING count(DISTINCT page) > 1 ORDER BY sum(impressions) DESC LIMIT 100`,
    );
    const articles = await db
      .select({
        id: schema.seoArticles.id,
        title: schema.seoArticles.title,
        kw: schema.seoArticles.primaryKeyword,
      })
      .from(schema.seoArticles)
      .where(
        sql`${schema.seoArticles.status} <> 'error' AND ${schema.seoArticles.primaryKeyword} IS NOT NULL`,
      );
    const pairs: { a: string; b: string; keywordA: string; keywordB: string; overlap: number }[] =
      [];
    for (let i = 0; i < articles.length; i++) {
      for (let j = i + 1; j < articles.length; j++) {
        const o = queryOverlap(articles[i]!.kw!, articles[j]!.kw!);
        if (o >= 0.75)
          pairs.push({
            a: articles[i]!.title,
            b: articles[j]!.title,
            keywordA: articles[i]!.kw!,
            keywordB: articles[j]!.kw!,
            overlap: o,
          });
      }
    }
    return { fromSearch, byKeyword: pairs.slice(0, 100) };
  });

  /** CSV import: query;frequency;cluster;intent (header optional, `;` or `,`). */
  app.post('/admin/seo/keywords/import', async (request, reply) => {
    const body = parse(z.object({ csv: z.string().min(3).max(2_000_000) }), request.body);
    if (!body) return bad(reply);
    const lines = body.csv
      .replace(/\r/g, '')
      .split('\n')
      .filter((l) => l.trim());
    const sep = (lines[0] ?? '').includes(';') ? ';' : ',';
    let added = 0;
    let updated = 0;
    let skipped = 0;
    for (const [i, line] of lines.entries()) {
      const cells = line.split(sep).map((c) => c.trim().replace(/^"|"$/g, ''));
      const query = cells[0] ?? '';
      if (i === 0 && /запрос|query|keyword|фраза/i.test(query)) continue;
      const normalized = normalizeQuery(query);
      if (normalized.length < 2 || normalized.length > 200) {
        skipped++;
        continue;
      }
      const freq = cells[1] ? Number.parseInt(cells[1].replace(/\s/g, ''), 10) : NaN;
      let clusterId: string | null = null;
      if (cells[2]) {
        const name = cells[2].slice(0, 120);
        const [c] = await db
          .insert(schema.seoKeywordClusters)
          .values({ name })
          .onConflictDoUpdate({ target: schema.seoKeywordClusters.name, set: { name } })
          .returning({ id: schema.seoKeywordClusters.id });
        clusterId = c!.id;
      }
      const intent = ['informational', 'navigational', 'transactional', 'commercial'].includes(
        cells[3] ?? '',
      )
        ? cells[3]!
        : null;
      const values = {
        query: query.slice(0, 200),
        normalized,
        frequency: Number.isFinite(freq) && freq >= 0 ? freq : null,
        frequencySource: Number.isFinite(freq) ? 'csv' : null,
        clusterId,
        intent,
        source: 'csv',
      };
      const [existing] = await db
        .select({ id: schema.seoKeywords.id })
        .from(schema.seoKeywords)
        .where(eq(schema.seoKeywords.normalized, normalized));
      if (existing) {
        await db
          .update(schema.seoKeywords)
          .set({
            frequency: values.frequency ?? undefined,
            frequencySource: values.frequencySource ?? undefined,
            clusterId: clusterId ?? undefined,
            intent: intent ?? undefined,
          })
          .where(eq(schema.seoKeywords.id, existing.id));
        updated++;
      } else {
        await db.insert(schema.seoKeywords).values(values);
        added++;
      }
    }
    await audit(request, 'seo.keywords.import', 'csv', { added, updated, skipped });
    await writeSeoLog(db, {
      agent: 'system',
      action: 'keywords.imported',
      message: `Импорт CSV: добавлено ${added}, обновлено ${updated}, пропущено ${skipped}`,
      actorUserId: actor(request),
    });
    return { added, updated, skipped };
  });

  // ── Внешние площадки ───────────────────────────────────────────────
  app.get('/admin/seo/external', async () => {
    const platforms = await db
      .select()
      .from(schema.seoPlatforms)
      .orderBy(asc(schema.seoPlatforms.name));
    const posts = await db
      .select({
        post: schema.seoExternalPosts,
        article: schema.seoArticles.title,
        platform: schema.seoPlatforms.name,
        mode: schema.seoPlatforms.mode,
        clicks: sql<number>`(SELECT count(*)::int FROM analytics_events e WHERE e.type = 'campaign_click' AND e.campaign_id = ${schema.seoExternalPosts.campaignId})`,
        registrations: sql<number>`(SELECT count(*)::int FROM user_attributions ua WHERE ua.campaign_id = ${schema.seoExternalPosts.campaignId})`,
      })
      .from(schema.seoExternalPosts)
      .innerJoin(
        schema.seoPlatforms,
        eq(schema.seoPlatforms.id, schema.seoExternalPosts.platformId),
      )
      .leftJoin(schema.seoArticles, eq(schema.seoArticles.id, schema.seoExternalPosts.articleId))
      .orderBy(desc(schema.seoExternalPosts.createdAt))
      .limit(300);
    return {
      platforms,
      posts: posts.map((p) => ({
        ...p.post,
        article: p.article,
        platform: p.platform,
        mode: p.mode,
        clicks: p.clicks,
        registrations: p.registrations,
      })),
    };
  });

  app.patch('/admin/seo/external/:id', async (request, reply) => {
    const p = parse(idParams, request.params);
    const body = parse(
      z
        .object({
          status: z.enum(SEO_EXTERNAL_POST_STATUSES).optional(),
          externalUrl: z.url().max(1000).nullable().optional(),
          body: z.string().min(20).max(40_000).optional(),
          title: z.string().max(300).nullable().optional(),
        })
        .strict(),
      request.body,
    );
    if (!p || !body) return bad(reply);
    const [row] = await db
      .update(schema.seoExternalPosts)
      .set({
        ...body,
        publishedAt: body.status === 'published' ? new Date() : undefined,
        updatedAt: new Date(),
      })
      .where(eq(schema.seoExternalPosts.id, p.id))
      .returning();
    if (!row) return notFound(reply);
    await audit(request, 'seo.external.update', p.id, { status: body.status });
    await writeSeoLog(db, {
      agent: 'distribution',
      action: 'external.updated',
      message: `Внешняя публикация: ${body.status ?? 'изменена'}${body.externalUrl ? ` (${body.externalUrl})` : ''}`,
      articleId: row.articleId,
      actorUserId: actor(request),
    });
    return { post: row };
  });

  app.post('/admin/seo/external/:id/publish', async (request, reply) => {
    const p = parse(idParams, request.params);
    if (!p || !parse(confirmBody, request.body)) return bad(reply, 'confirmation_required');
    const [row] = await db
      .select({ post: schema.seoExternalPosts, mode: schema.seoPlatforms.mode })
      .from(schema.seoExternalPosts)
      .innerJoin(
        schema.seoPlatforms,
        eq(schema.seoPlatforms.id, schema.seoExternalPosts.platformId),
      )
      .where(eq(schema.seoExternalPosts.id, p.id));
    if (!row) return notFound(reply);
    if (row.mode !== 'api') return reply.code(409).send({ error: 'manual_platform' });
    if (row.post.status === 'published')
      return reply.code(409).send({ error: 'already_published' });
    await enqueueSeoTask(db, {
      kind: 'publish_external',
      agent: 'distribution',
      idempotencyKey: `publish_external:${p.id}:manual:${Date.now()}`,
      payload: { postId: p.id, manual: true },
      priority: 80,
      maxAttempts: 1,
    });
    await audit(request, 'seo.external.publish', p.id);
    return reply.code(202).send({ queued: true });
  });

  app.patch('/admin/seo/platforms/:id', async (request, reply) => {
    const p = parse(idParams, request.params);
    const body = parse(
      z
        .object({
          isActive: z.boolean().optional(),
          rules: z.string().max(4000).optional(),
          format: z.string().max(2000).optional(),
          audience: z.string().max(2000).nullable().optional(),
        })
        .strict(),
      request.body,
    );
    if (!p || !body) return bad(reply);
    const [row] = await db
      .update(schema.seoPlatforms)
      .set(body)
      .where(eq(schema.seoPlatforms.id, p.id))
      .returning();
    if (!row) return notFound(reply);
    await audit(request, 'seo.platform.update', p.id);
    return { platform: row };
  });

  // ── Конкуренты ─────────────────────────────────────────────────────
  app.get('/admin/seo/competitors', async () => ({
    items: await db.select().from(schema.seoCompetitors).orderBy(asc(schema.seoCompetitors.name)),
  }));
  app.post('/admin/seo/competitors', async (request, reply) => {
    const body = parse(
      z.object({
        name: z.string().trim().min(2).max(100),
        domain: z
          .string()
          .trim()
          .toLowerCase()
          .regex(/^[a-z0-9.-]+\.[a-z]{2,}$/),
        notes: z.string().max(1000).optional(),
      }),
      request.body,
    );
    if (!body) return bad(reply);
    const [row] = await db
      .insert(schema.seoCompetitors)
      .values(body)
      .onConflictDoNothing()
      .returning();
    if (!row) return reply.code(409).send({ error: 'exists' });
    await audit(request, 'seo.competitor.add', row.id);
    return reply.code(201).send({ competitor: row });
  });
  app.patch('/admin/seo/competitors/:id', async (request, reply) => {
    const p = parse(idParams, request.params);
    const body = parse(
      z
        .object({
          isActive: z.boolean().optional(),
          notes: z.string().max(1000).nullable().optional(),
        })
        .strict(),
      request.body,
    );
    if (!p || !body) return bad(reply);
    const [row] = await db
      .update(schema.seoCompetitors)
      .set(body)
      .where(eq(schema.seoCompetitors.id, p.id))
      .returning();
    return row ? { competitor: row } : notFound(reply);
  });

  // ── Технический аудит ─────────────────────────────────────────────
  app.get('/admin/seo/audit', async (request, reply) => {
    const q = parse(z.object({ status: z.enum(SEO_ISSUE_STATUSES).optional() }), request.query);
    if (!q) return bad(reply, 'invalid_query');
    const [lastRun] = await db
      .select()
      .from(schema.seoAuditRuns)
      .orderBy(desc(schema.seoAuditRuns.startedAt))
      .limit(1);
    const issues = await db
      .select()
      .from(schema.seoAuditIssues)
      .where(q.status ? eq(schema.seoAuditIssues.status, q.status) : undefined)
      .orderBy(
        sql`CASE ${schema.seoAuditIssues.severity} WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END`,
        desc(schema.seoAuditIssues.lastSeenAt),
      )
      .limit(500);
    return { lastRun: lastRun ?? null, issues };
  });
  app.patch('/admin/seo/audit/issues/:id', async (request, reply) => {
    const p = parse(idParams, request.params);
    const body = parse(z.object({ status: z.enum(['fixed', 'ignored', 'open']) }), request.body);
    if (!p || !body) return bad(reply);
    const [row] = await db
      .update(schema.seoAuditIssues)
      .set({ status: body.status, resolvedAt: body.status === 'open' ? null : new Date() })
      .where(eq(schema.seoAuditIssues.id, p.id))
      .returning();
    if (!row) return notFound(reply);
    await audit(request, 'seo.audit.issue', p.id, { status: body.status });
    return { issue: row };
  });

  // ── Обучение и база знаний ────────────────────────────────────────
  app.get('/admin/seo/learning', async (request, reply) => {
    const q = parse(pageQuery, request.query);
    if (!q) return bad(reply, 'invalid_query');
    const items = await db
      .select()
      .from(schema.seoLearningLog)
      .orderBy(desc(schema.seoLearningLog.at))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize);
    const insights = await db
      .select()
      .from(schema.seoInsights)
      .orderBy(asc(schema.seoInsights.dimension), desc(schema.seoInsights.sampleSize));
    return { items, insights, page: q.page };
  });

  // ── Интеграции ─────────────────────────────────────────────────────
  app.get('/admin/seo/integrations', async () => {
    const stored = await db.select().from(schema.seoIntegrations);
    const byKind = new Map(stored.map((s) => [s.kind, s]));
    return {
      secretsKeyConfigured: secretsKey !== null,
      items: SEO_INTEGRATIONS.map((kind) => {
        const s = byKind.get(kind);
        return {
          kind,
          status: s?.status ?? 'not_configured',
          config: s?.config ?? {},
          hasSecret: Boolean(s?.secretEnc),
          lastCheckAt: s?.lastCheckAt ?? null,
          lastSyncAt: s?.lastSyncAt ?? null,
          lastError: s?.lastError ?? null,
        };
      }),
    };
  });

  app.put('/admin/seo/integrations/:kind', async (request, reply) => {
    const p = parse(z.object({ kind: z.enum(SEO_INTEGRATIONS) }), request.params);
    const body = parse(
      z
        .object({
          config: z.record(z.string(), z.unknown()).default({}),
          secret: z.string().min(1).max(20_000).optional(),
        })
        .strict(),
      request.body,
    );
    if (!p || !body) return bad(reply);
    const config = parse(integrationConfigSchemas[p.kind], body.config);
    if (!config) return bad(reply, 'invalid_config');
    if (p.kind === 'indexnow') {
      // The key is ours to generate; it is not secret (it is published in a file).
      const [row] = await db
        .select()
        .from(schema.seoIntegrations)
        .where(eq(schema.seoIntegrations.kind, 'indexnow'));
      (config as Record<string, unknown>).key =
        typeof row?.config.key === 'string' ? row.config.key : randomBytes(16).toString('hex');
    }
    let secretEnc: string | undefined;
    if (body.secret !== undefined) {
      if (!secretsKey) return reply.code(409).send({ error: 'secrets_key_missing' });
      if (p.kind === 'google_search_console') {
        try {
          const sa = JSON.parse(body.secret) as { client_email?: string; private_key?: string };
          if (!sa.client_email || !sa.private_key) throw new Error();
        } catch {
          return bad(reply, 'invalid_service_account');
        }
      }
      secretEnc = encryptSecret(secretsKey, body.secret);
    }
    const values = {
      config,
      ...(secretEnc ? { secretEnc } : {}),
      status: 'configured',
      lastError: null,
      updatedAt: new Date(),
    };
    await db
      .insert(schema.seoIntegrations)
      .values({ kind: p.kind, ...values })
      .onConflictDoUpdate({ target: schema.seoIntegrations.kind, set: values });
    await enqueueSeoTask(db, {
      kind: 'check_integration',
      agent: 'analytics',
      idempotencyKey: `check_integration:${p.kind}:${Date.now()}`,
      payload: { kind: p.kind },
      priority: 95,
      maxAttempts: 1,
    });
    // Never log the secret, only that one was set.
    await audit(request, 'seo.integration.update', p.kind, { secretChanged: Boolean(secretEnc) });
    await writeSeoLog(db, {
      agent: 'system',
      action: 'integration.updated',
      message: `Интеграция ${p.kind} сохранена, идёт проверка`,
      actorUserId: actor(request),
    });
    return { ok: true };
  });

  app.post('/admin/seo/integrations/:kind/check', async (request, reply) => {
    const p = parse(z.object({ kind: z.enum(SEO_INTEGRATIONS) }), request.params);
    if (!p) return notFound(reply);
    await enqueueSeoTask(db, {
      kind: 'check_integration',
      agent: 'analytics',
      idempotencyKey: `check_integration:${p.kind}:${Date.now()}`,
      payload: { kind: p.kind },
      priority: 95,
      maxAttempts: 1,
    });
    return reply.code(202).send({ queued: true });
  });

  app.delete('/admin/seo/integrations/:kind', async (request, reply) => {
    const p = parse(z.object({ kind: z.enum(SEO_INTEGRATIONS) }), request.params);
    if (!p) return notFound(reply);
    await db.delete(schema.seoIntegrations).where(eq(schema.seoIntegrations.kind, p.kind));
    await audit(request, 'seo.integration.delete', p.kind);
    return { ok: true };
  });
};

/** Reads PNG/JPEG/WebP dimensions from the header; null for anything else. */
export function imageSize(
  b: Buffer,
): { width: number; height: number; mime: string; ext: string } | null {
  if (b.length > 24 && b.readUInt32BE(0) === 0x89504e47) {
    return { width: b.readUInt32BE(16), height: b.readUInt32BE(20), mime: 'image/png', ext: 'png' };
  }
  if (
    b.length > 30 &&
    b.toString('ascii', 0, 4) === 'RIFF' &&
    b.toString('ascii', 8, 12) === 'WEBP'
  ) {
    const chunk = b.toString('ascii', 12, 16);
    if (chunk === 'VP8X')
      return {
        width: 1 + b.readUIntLE(24, 3),
        height: 1 + b.readUIntLE(27, 3),
        mime: 'image/webp',
        ext: 'webp',
      };
    if (chunk === 'VP8 ')
      return {
        width: b.readUInt16LE(26) & 0x3fff,
        height: b.readUInt16LE(28) & 0x3fff,
        mime: 'image/webp',
        ext: 'webp',
      };
    if (chunk === 'VP8L') {
      const bits = b.readUInt32LE(21);
      return {
        width: (bits & 0x3fff) + 1,
        height: ((bits >> 14) & 0x3fff) + 1,
        mime: 'image/webp',
        ext: 'webp',
      };
    }
    return null;
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1]!;
      const len = b.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return {
          height: b.readUInt16BE(i + 5),
          width: b.readUInt16BE(i + 7),
          mime: 'image/jpeg',
          ext: 'jpg',
        };
      }
      i += 2 + len;
    }
  }
  return null;
}
