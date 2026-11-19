import { randomBytes } from 'node:crypto';
import { and, eq, inArray, notInArray, sql } from 'drizzle-orm';
import type { Database } from './client.js';
import * as schema from './schema.js';
import { writeSeoLog } from './seo.js';

type Article = typeof schema.seoArticles.$inferSelect;

/** Fields a revision snapshot keeps (content, not bookkeeping). */
const SNAPSHOT_FIELDS = [
  'title',
  'seoTitle',
  'metaDescription',
  'h1',
  'slug',
  'format',
  'subjectId',
  'bodyMd',
  'faq',
  'sources',
  'ogTitle',
  'ogDescription',
  'primaryKeyword',
  'secondaryKeywords',
  'ctaPath',
  'coverMediaId',
] as const;

export function articleSnapshot(a: Article): Record<string, unknown> {
  return Object.fromEntries(SNAPSHOT_FIELDS.map((k) => [k, a[k]]));
}

export async function saveArticleRevision(
  db: Pick<Database, 'insert'>,
  a: Article,
  reason: string,
  actor: string,
) {
  await db.insert(schema.seoArticleRevisions).values({
    articleId: a.id,
    version: a.version,
    snapshot: articleSnapshot(a),
    reason,
    actor,
  });
}

/** Campaign slugs: the same shape as the admin's (apps/api campaignLinks.ts). */
function campaignSlug() {
  return randomBytes(8).toString('base64url').slice(0, 10);
}

/**
 * A tracked link (existing campaigns table) — clicks and registrations
 * from an article or an external post land in the normal attribution.
 */
export async function createSeoCampaign(
  db: Pick<Database, 'insert'>,
  input: { name: string; source: string; channel: string; creative?: string; targetPath: string },
) {
  for (let i = 0; i < 5; i++) {
    const [row] = await db
      .insert(schema.campaigns)
      .values({
        slug: campaignSlug(),
        name: input.name.slice(0, 120),
        source: input.source.toLowerCase().slice(0, 60),
        channel: input.channel.toLowerCase().slice(0, 60),
        creative: input.creative?.slice(0, 120) ?? null,
        targetPath: input.targetPath,
      })
      .onConflictDoNothing({ target: schema.campaigns.slug })
      .returning();
    if (row) return row;
  }
  throw new Error('could not allocate a campaign slug');
}

export type PublishOutcome =
  | { ok: true; article: Article }
  | { ok: false; reason: 'not_found' | 'already_published' | 'not_publishable' | 'quality' };

/** Statuses an article can be published from. */
export const PUBLISHABLE_STATUSES = ['draft', 'review', 'scheduled', 'needs_update'] as const;

/**
 * Publishes once. The status change is a single UPDATE … WHERE status IN
 * (publishable) — two concurrent calls (worker + admin, two workers)
 * can't both succeed, so an article is never published twice.
 */
export async function publishSeoArticle(
  db: Database,
  id: string,
  actor: { kind: 'agent' } | { kind: 'admin'; userId: string },
): Promise<PublishOutcome> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(schema.seoArticles)
      .where(eq(schema.seoArticles.id, id));
    if (!current) return { ok: false, reason: 'not_found' } as const;
    if (current.status === 'published') return { ok: false, reason: 'already_published' } as const;
    if (!(PUBLISHABLE_STATUSES as readonly string[]).includes(current.status)) {
      return { ok: false, reason: 'not_publishable' } as const;
    }
    if (!current.seoTitle || !current.metaDescription || current.bodyMd.length < 200) {
      return { ok: false, reason: 'quality' } as const;
    }
    let campaignId = current.campaignId;
    if (!campaignId) {
      const c = await createSeoCampaign(tx, {
        name: `SEO: ${current.title}`,
        source: 'seo',
        channel: 'blog',
        creative: current.slug,
        targetPath: current.ctaPath,
      });
      campaignId = c.id;
    }
    const firstPublish = current.publishedAt === null;
    const [updated] = await tx
      .update(schema.seoArticles)
      .set({
        status: 'published',
        campaignId,
        publishedAt: current.publishedAt ?? new Date(),
        scheduledFor: null,
        error: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.seoArticles.id, id),
          inArray(schema.seoArticles.status, [...PUBLISHABLE_STATUSES]),
        ),
      )
      .returning();
    if (!updated) return { ok: false, reason: 'already_published' } as const;
    if (current.topicId) {
      await tx
        .update(schema.seoTopics)
        .set({ status: 'published', updatedAt: new Date() })
        .where(eq(schema.seoTopics.id, current.topicId));
    }
    await writeSeoLog(tx, {
      agent: actor.kind === 'agent' ? 'content' : 'system',
      action: firstPublish ? 'article.published' : 'article.republished',
      message: `Опубликована статья «${updated.title}» — /blog/${updated.slug}`,
      articleId: id,
      actorUserId: actor.kind === 'admin' ? actor.userId : null,
    });
    // Post-publish: IndexNow ping, availability and canonical check (worker).
    await tx
      .insert(schema.seoTasks)
      .values({
        kind: 'post_publish_check',
        agent: 'technical',
        idempotencyKey: `post_publish_check:${id}:v${updated.version}`,
        payload: { articleId: id },
        articleId: id,
        priority: 80,
      })
      .onConflictDoNothing();
    return { ok: true, article: updated } as const;
  });
}

export async function unpublishSeoArticle(db: Database, id: string, userId: string) {
  const [row] = await db
    .update(schema.seoArticles)
    .set({ status: 'draft', updatedAt: new Date() })
    .where(and(eq(schema.seoArticles.id, id), eq(schema.seoArticles.status, 'published')))
    .returning();
  if (row) {
    await writeSeoLog(db, {
      agent: 'system',
      action: 'article.unpublished',
      message: `Статья «${row.title}» снята с публикации`,
      articleId: id,
      actorUserId: userId,
    });
  }
  return row ?? null;
}

/** Makes `slug` unique among articles (adds -2, -3 …). */
export async function uniqueArticleSlug(
  db: Pick<Database, 'select'>,
  slug: string,
  exceptId?: string,
): Promise<string> {
  for (let n = 1; n < 100; n++) {
    const candidate = n === 1 ? slug : `${slug.slice(0, 84)}-${n}`;
    const where = exceptId
      ? and(eq(schema.seoArticles.slug, candidate), notInArray(schema.seoArticles.id, [exceptId]))
      : eq(schema.seoArticles.slug, candidate);
    const [hit] = await db
      .select({ id: schema.seoArticles.id })
      .from(schema.seoArticles)
      .where(where);
    if (!hit) return candidate;
  }
  return `${slug.slice(0, 70)}-${Date.now().toString(36)}`;
}

/** Enqueue a queue task idempotently; returns true if it was new. */
export async function enqueueSeoTask(
  db: Pick<Database, 'insert'>,
  t: {
    kind: string;
    agent: string;
    idempotencyKey: string;
    payload?: Record<string, unknown>;
    articleId?: string | null;
    priority?: number;
    runAfter?: Date;
    parentId?: string | null;
    maxAttempts?: number;
  },
): Promise<boolean> {
  const rows = await db
    .insert(schema.seoTasks)
    .values({
      kind: t.kind,
      agent: t.agent,
      idempotencyKey: t.idempotencyKey,
      payload: t.payload ?? {},
      articleId: t.articleId ?? null,
      priority: t.priority ?? 50,
      runAfter: t.runAfter ?? new Date(),
      parentId: t.parentId ?? null,
      maxAttempts: t.maxAttempts ?? 3,
    })
    .onConflictDoNothing()
    .returning({ id: schema.seoTasks.id });
  return rows.length > 0;
}

/** Count of articles currently in a status (used by limits). */
export async function countArticlesSince(
  db: Pick<Database, 'select'>,
  since: Date,
): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.seoArticles)
    .where(
      sql`${schema.seoArticles.createdAt} >= ${since.toISOString()} and ${schema.seoArticles.generatedBy} is not null`,
    );
  return row?.n ?? 0;
}
