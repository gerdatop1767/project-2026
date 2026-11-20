import { randomBytes } from 'node:crypto';
import { isAllowedCampaignTarget } from '@zybrilka/shared';
import { and, eq, inArray, notInArray, sql } from 'drizzle-orm';
import type { Database } from './client.js';
import * as schema from './schema.js';
import {
  articleContentHash,
  evaluatePublicationGate,
  gateReasonText,
  readFactCheckRecord,
  type GateDecision,
  type GateTarget,
} from './publicationGate.js';
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
/** Where an article's call to action goes when its stored path is not an allowed target. */
export const FALLBACK_CTA_PATH = '/training';

export async function createSeoCampaign(
  db: Pick<Database, 'insert'>,
  input: { name: string; source: string; channel: string; creative?: string; targetPath: string },
) {
  // The /go redirect refuses any other target (it would land on the home page).
  if (!isAllowedCampaignTarget(input.targetPath)) {
    throw new Error(`campaign target not allowed: ${input.targetPath}`);
  }
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
  | { ok: true; article: Article; gate: GateDecision }
  | { ok: false; reason: 'not_found' | 'already_published' | 'not_publishable' | 'quality' }
  | { ok: false; reason: 'fact_check'; gate: GateDecision };

/** The Publication Safety Gate for an article row as it is now. */
export function articleGate(a: Article, target: GateTarget): GateDecision {
  return evaluatePublicationGate({
    target,
    status: a.status,
    content: a,
    reviewNotes: a.reviewNotes,
  });
}

/** Statuses an article can be published from. */
export const PUBLISHABLE_STATUSES = ['draft', 'review', 'scheduled', 'needs_update'] as const;

/**
 * Publishes once. The status change is a single UPDATE … WHERE status IN
 * (publishable) — two concurrent calls (worker + admin, two workers)
 * can't both succeed, so an article is never published twice. The row is
 * locked for the whole transaction, so the text the Publication Safety Gate
 * approved is exactly the text that goes live (a concurrent edit waits).
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
      .where(eq(schema.seoArticles.id, id))
      .for('update');
    if (!current) return { ok: false, reason: 'not_found' } as const;
    if (current.status === 'published') return { ok: false, reason: 'already_published' } as const;
    if (!(PUBLISHABLE_STATUSES as readonly string[]).includes(current.status)) {
      return { ok: false, reason: 'not_publishable' } as const;
    }
    if (!current.seoTitle || !current.metaDescription || current.bodyMd.length < 200) {
      return { ok: false, reason: 'quality' } as const;
    }
    const gate = articleGate(current, 'publish');
    if (!gate.allowed) return { ok: false, reason: 'fact_check', gate } as const;
    let campaignId = current.campaignId;
    if (!campaignId) {
      const c = await createSeoCampaign(tx, {
        name: `SEO: ${current.title}`,
        source: 'seo',
        channel: 'blog',
        creative: current.slug,
        targetPath: isAllowedCampaignTarget(current.ctaPath) ? current.ctaPath : FALLBACK_CTA_PATH,
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
      details: { gate: { basis: gate.basis, contentHash: gate.contentHash } },
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
    return { ok: true, article: updated, gate } as const;
  });
}

export type ScheduleOutcome =
  | { ok: true; article: Article }
  | { ok: false; reason: 'not_found' | 'not_schedulable' }
  | { ok: false; reason: 'fact_check'; gate: GateDecision };

/**
 * Schedules a publication (admin «Запланировать», auto mode). The gate runs
 * now on the locked row; publishing at the due time runs it again — an edit
 * in between makes the check stale and the article goes back to review.
 */
export async function scheduleSeoArticle(
  db: Database,
  id: string,
  at: Date,
  opts: { expectedVersion?: number; tx?: Tx } = {},
): Promise<ScheduleOutcome> {
  const run = async (tx: Tx): Promise<ScheduleOutcome> => {
    const [current] = await tx
      .select()
      .from(schema.seoArticles)
      .where(eq(schema.seoArticles.id, id))
      .for('update');
    if (!current) return { ok: false, reason: 'not_found' };
    if (opts.expectedVersion !== undefined && current.version !== opts.expectedVersion) {
      return { ok: false, reason: 'not_schedulable' };
    }
    const gate = articleGate(current, 'schedule');
    if (gate.reasons.includes('status_not_allowed'))
      return { ok: false, reason: 'not_schedulable' };
    if (!gate.allowed) return { ok: false, reason: 'fact_check', gate };
    const [row] = await tx
      .update(schema.seoArticles)
      .set({ status: 'scheduled', scheduledFor: at, updatedAt: new Date() })
      .where(
        and(
          eq(schema.seoArticles.id, id),
          eq(schema.seoArticles.version, current.version),
          inArray(schema.seoArticles.status, ['draft', 'review', 'needs_update', 'scheduled']),
        ),
      )
      .returning();
    return row ? { ok: true, article: row } : { ok: false, reason: 'not_schedulable' };
  };
  return opts.tx ? run(opts.tx) : db.transaction(run);
}

export async function unpublishSeoArticle(db: Database, id: string, userId: string) {
  const [row] = await db
    .update(schema.seoArticles)
    .set({ status: 'draft', updatedAt: new Date() })
    .where(
      and(
        eq(schema.seoArticles.id, id),
        inArray(schema.seoArticles.status, ['published', 'needs_update']),
      ),
    )
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

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

export type ApplyRevisionOutcome =
  | { ok: true; article: Article; gate: GateDecision | null }
  | { ok: false; reason: 'not_pending' }
  | { ok: false; reason: 'fact_check'; gate: GateDecision };

/**
 * Applies a pending article update (written by the SEO agent for a live
 * article) exactly once. The article row is locked and the revision is
 * claimed by a conditional UPDATE (pending_update → applied_update), in one
 * transaction: a second caller — another worker, or the owner clicking at
 * the same moment — finds nothing to claim. An article taken off the site
 * meanwhile stays off (the owner decides).
 *
 * For a live article the new text passes the Publication Safety Gate first:
 * `reviewNotes` (the worker's fresh check of this revision) or, if not given,
 * the notes stored on the article (a check or the owner's approval of this
 * revision's text). Blocked → nothing is claimed or changed.
 */
export async function applyPendingArticleRevision(
  db: Database,
  o: {
    articleId: string;
    revisionId: string;
    actor: string;
    now: Date;
    reviewNotes?: Record<string, unknown>;
    tx?: Tx;
  },
): Promise<ApplyRevisionOutcome> {
  const run = async (t: Tx): Promise<ApplyRevisionOutcome> => {
    const [fresh] = await t
      .select()
      .from(schema.seoArticles)
      .where(eq(schema.seoArticles.id, o.articleId))
      .for('update');
    if (!fresh) return { ok: false, reason: 'not_pending' };
    const [pending] = await t
      .select()
      .from(schema.seoArticleRevisions)
      .where(
        and(
          eq(schema.seoArticleRevisions.id, o.revisionId),
          eq(schema.seoArticleRevisions.articleId, o.articleId),
          eq(schema.seoArticleRevisions.reason, 'pending_update'),
        ),
      );
    if (!pending) return { ok: false, reason: 'not_pending' };
    const { wordCount, qualityIssues, ...fields } = pending.snapshot as {
      wordCount?: number;
      qualityIssues?: string[];
    } & Record<string, unknown>;
    const next = { ...fresh, ...(fields as Partial<Article>), slug: fresh.slug };
    const live = fresh.status === 'published' || fresh.status === 'needs_update';
    const notes = o.reviewNotes ?? fresh.reviewNotes;
    let gate: GateDecision | null = null;
    if (live) {
      gate = evaluatePublicationGate({
        target: 'apply_update',
        status: fresh.status,
        content: next,
        reviewNotes: notes,
      });
      const record = readFactCheckRecord(notes);
      // A check of another revision does not vouch for this one, even with equal text.
      if (gate.basis === 'verified' && record?.revisionId !== o.revisionId) {
        gate = { ...gate, allowed: false, basis: null, reasons: ['no_fact_check'] };
      }
      if (!gate.allowed) return { ok: false, reason: 'fact_check', gate };
    }
    const [rev] = await t
      .update(schema.seoArticleRevisions)
      .set({ reason: 'applied_update' })
      .where(
        and(
          eq(schema.seoArticleRevisions.id, o.revisionId),
          eq(schema.seoArticleRevisions.articleId, o.articleId),
          eq(schema.seoArticleRevisions.reason, 'pending_update'),
        ),
      )
      .returning();
    if (!rev) return { ok: false, reason: 'not_pending' };
    await saveArticleRevision(t, fresh, 'before_update', o.actor);
    const [updated] = await t
      .update(schema.seoArticles)
      .set({
        ...(fields as object),
        slug: fresh.slug,
        wordCount: wordCount ?? fresh.wordCount,
        qualityIssues: qualityIssues ?? fresh.qualityIssues,
        status: live ? 'published' : fresh.status,
        // The verdict travels with the text it is about; «verified» only
        // from an automatic check, never from a manual approval.
        reviewNotes: notes,
        factCheckPassed:
          (
            gate ??
            evaluatePublicationGate({
              target: 'publish',
              status: 'review',
              content: next,
              reviewNotes: notes,
            })
          ).basis === 'verified',
        version: fresh.version + 1,
        updatedAt: o.now,
      })
      .where(eq(schema.seoArticles.id, fresh.id))
      .returning();
    if (live) {
      await t
        .insert(schema.seoTasks)
        .values({
          kind: 'post_publish_check',
          agent: 'technical',
          idempotencyKey: `post_publish_check:${fresh.id}:v${fresh.version + 1}`,
          articleId: fresh.id,
          payload: { articleId: fresh.id },
          priority: 80,
        })
        .onConflictDoNothing();
      await writeSeoLog(t, {
        agent: o.actor.startsWith('admin:') ? 'system' : 'content',
        action: 'article.update_gate_passed',
        message: `Обновление допущено на сайт (${gate?.basis === 'manual' ? 'ручное подтверждение' : 'проверено'})`,
        articleId: fresh.id,
        details: { gate: { basis: gate?.basis ?? null, contentHash: gate?.contentHash ?? null } },
      });
    }
    return updated ? { ok: true, article: updated, gate } : { ok: false, reason: 'not_pending' };
  };
  return o.tx ? run(o.tx) : db.transaction(run);
}

/**
 * The owner's manual approval of the article's current text — or of a
 * pending update's text (`revisionId`). Stored separately from the automatic
 * result (never sets «verified»), bound to the exact text (any edit voids it)
 * and to this one article. Refused while the latest check reports a critical
 * contradiction: that needs a fix and a new check, not a click.
 */
export async function approveArticleManually(
  db: Database,
  o: { articleId: string; adminId: string; reason: string; revisionId?: string | null; now: Date },
): Promise<
  | { ok: true; article: Article; contentHash: string }
  | { ok: false; reason: 'not_found' | 'not_pending' | 'critical_contradiction' }
> {
  return db.transaction(async (t) => {
    const [a] = await t
      .select()
      .from(schema.seoArticles)
      .where(eq(schema.seoArticles.id, o.articleId))
      .for('update');
    if (!a) return { ok: false, reason: 'not_found' } as const;
    let content: Article = a;
    if (o.revisionId) {
      const [rev] = await t
        .select()
        .from(schema.seoArticleRevisions)
        .where(
          and(
            eq(schema.seoArticleRevisions.id, o.revisionId),
            eq(schema.seoArticleRevisions.articleId, a.id),
            eq(schema.seoArticleRevisions.reason, 'pending_update'),
          ),
        );
      if (!rev) return { ok: false, reason: 'not_pending' } as const;
      content = { ...a, ...(rev.snapshot as Partial<Article>) };
    }
    const gate = evaluatePublicationGate({
      target: 'publish',
      status: 'review',
      content,
      reviewNotes: a.reviewNotes,
    });
    if (!gate.manualAllowed) return { ok: false, reason: 'critical_contradiction' } as const;
    const manualApproval = {
      adminId: o.adminId,
      at: o.now.toISOString(),
      reason: o.reason.slice(0, 1000),
      contentHash: gate.contentHash,
      revisionId: o.revisionId ?? null,
    };
    const [updated] = await t
      .update(schema.seoArticles)
      .set({
        reviewNotes: { ...(a.reviewNotes ?? {}), manualApproval },
        updatedAt: o.now,
      })
      .where(eq(schema.seoArticles.id, a.id))
      .returning();
    await writeSeoLog(t, {
      agent: 'system',
      action: 'article.fact_check_manual',
      message:
        `Факт-чек подтверждён вручную${o.revisionId ? ' (обновление)' : ''}: ${manualApproval.reason}`.slice(
          0,
          500,
        ),
      articleId: a.id,
      actorUserId: o.adminId,
      details: { manualApproval, gateBefore: gateReasonText(gate.reasons) },
    });
    return { ok: true, article: updated!, contentHash: gate.contentHash } as const;
  });
}

/**
 * Fields a fact-check vouches for — exactly what articleContentHash covers:
 * the text readers see and the sources (evidence). Everything else an editor
 * can change (slug, call to action, keywords, subject, format, cover) is
 * technical. For `sources` only the set of URLs counts: renaming or
 * reordering a link keeps the check valid (applied at once), adding,
 * removing or changing a URL does not.
 */
export const FACTUAL_ARTICLE_FIELDS = [
  'title',
  'h1',
  'seoTitle',
  'metaDescription',
  'ogTitle',
  'ogDescription',
  'bodyMd',
  'faq',
  'sources',
] as const;

/**
 * An owner's edit of a LIVE article's text never reaches the public page
 * directly: it becomes a pending update (the same path as the agent's),
 * gets its own fact-check bound to its exact text, and goes live only via
 * applyPendingArticleRevision — through the Publication Safety Gate. The live
 * row keeps its text and stays on the site (published → needs_update).
 * Older pending updates of the article are superseded: one candidate at a time.
 * Runs inside the caller's transaction, with the row already version-checked.
 */
export async function proposeLiveArticleEdit(
  tx: Tx,
  o: {
    article: Article;
    factual: Partial<Record<(typeof FACTUAL_ARTICLE_FIELDS)[number], unknown>>;
    wordCount: number;
    actor: string;
    now: Date;
  },
): Promise<{ revisionId: string; contentHash: string }> {
  const a = o.article;
  const candidate = { ...a, ...(o.factual as Partial<Article>) };
  const snapshot = {
    ...Object.fromEntries(FACTUAL_ARTICLE_FIELDS.map((k) => [k, candidate[k]])),
    wordCount: o.wordCount,
  };
  await tx
    .update(schema.seoArticleRevisions)
    .set({ reason: 'superseded_update' })
    .where(
      and(
        eq(schema.seoArticleRevisions.articleId, a.id),
        eq(schema.seoArticleRevisions.reason, 'pending_update'),
      ),
    );
  const [rev] = await tx
    .insert(schema.seoArticleRevisions)
    .values({
      articleId: a.id,
      version: a.version + 1,
      snapshot,
      reason: 'pending_update',
      actor: o.actor,
    })
    .returning({ id: schema.seoArticleRevisions.id });
  await tx
    .insert(schema.seoTasks)
    .values({
      kind: 'review_article',
      agent: 'content',
      idempotencyKey: `review_article:${a.id}:rev:${rev!.id}`,
      articleId: a.id,
      payload: { articleId: a.id, pendingRevisionId: rev!.id },
      priority: 85,
    })
    .onConflictDoNothing();
  return { revisionId: rev!.id, contentHash: articleContentHash(candidate) };
}
