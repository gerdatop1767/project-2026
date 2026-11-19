import { schema } from '@zybrilka/db';
import type { Database } from '@zybrilka/db';
import { SEO_SLUG_RE } from '@zybrilka/shared';
import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import {
  BLOG_CSS,
  BLOG_JS,
  mediaUrl,
  renderArticlePage,
  renderBlogIndex,
  renderNotFound,
  renderRss,
  renderSitemap,
  type BlogMedia,
} from './blogRender.js';

export interface BlogRoutesOptions {
  db: Database;
  /** Public site origin (WEB_BASE_URL), e.g. https://zybrilka.ru. */
  origin: string;
}

const PAGE_SIZE = 24;
const MEDIA_RE = /^[a-z0-9-]{1,120}\.(svg|png|jpg|jpeg|webp)$/;

/** Pages: same-origin script/style only; Metrika allowed (it loads only after consent). */
const PAGE_CSP = [
  "default-src 'self'",
  "script-src 'self' https://mc.yandex.ru https://yastatic.net",
  "img-src 'self' data: https://mc.yandex.ru",
  "connect-src 'self' https://mc.yandex.ru",
  "style-src 'self'",
  "frame-ancestors 'self' https://web.telegram.org",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

function html(reply: FastifyReply, body: string, status = 200) {
  return reply
    .code(status)
    .header('content-type', 'text/html; charset=utf-8')
    .header('content-security-policy', PAGE_CSP)
    .header('cache-control', 'public, max-age=0, must-revalidate')
    .send(body);
}

/**
 * Public blog (docs/SEO_CENTER.md §7): /blog, /blog/:slug, its sitemap, RSS,
 * media and assets. Only `published` articles exist here — anything else is
 * a real 404 (noindex), never a soft 200.
 */
export const blogRoutes: FastifyPluginAsync<BlogRoutesOptions> = async (app, { db, origin }) => {
  const base = origin.replace(/\/+$/, '');

  app.get('/blog/assets/blog.css', async (_req, reply) =>
    reply
      .header('content-type', 'text/css; charset=utf-8')
      .header('cache-control', 'public, max-age=3600')
      .send(BLOG_CSS),
  );
  app.get('/blog/assets/blog.js', async (_req, reply) =>
    reply
      .header('content-type', 'text/javascript; charset=utf-8')
      .header('cache-control', 'public, max-age=3600')
      .send(BLOG_JS),
  );

  app.get('/blog', async (request, reply) => {
    const q = request.query as { page?: string };
    const page = Math.max(1, Math.min(1000, Number.parseInt(q.page ?? '1', 10) || 1));
    const [{ total } = { total: 0 }] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(schema.seoArticles)
      .where(eq(schema.seoArticles.status, 'published'));
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (page > pages) return html(reply, renderNotFound(base), 404);
    const rows = await db
      .select({
        slug: schema.seoArticles.slug,
        title: schema.seoArticles.title,
        description: schema.seoArticles.metaDescription,
        publishedAt: schema.seoArticles.publishedAt,
        cover: schema.seoMedia.fileName,
      })
      .from(schema.seoArticles)
      .leftJoin(schema.seoMedia, eq(schema.seoMedia.id, schema.seoArticles.coverMediaId))
      .where(eq(schema.seoArticles.status, 'published'))
      .orderBy(desc(schema.seoArticles.publishedAt))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE);
    return html(
      reply,
      renderBlogIndex(
        rows.map((r) => ({ ...r, cover: r.cover ? mediaUrl(base, r.cover) : null })),
        { origin: base, metrika: false, page, pages },
      ),
    );
  });

  const publishedList = () =>
    db
      .select({
        slug: schema.seoArticles.slug,
        title: schema.seoArticles.title,
        description: schema.seoArticles.metaDescription,
        publishedAt: schema.seoArticles.publishedAt,
        updatedAt: schema.seoArticles.updatedAt,
      })
      .from(schema.seoArticles)
      .where(eq(schema.seoArticles.status, 'published'))
      .orderBy(desc(schema.seoArticles.publishedAt))
      .limit(5000);

  app.get('/blog/sitemap.xml', async (_req, reply) => {
    const rows = await publishedList();
    return reply
      .header('content-type', 'application/xml; charset=utf-8')
      .header('cache-control', 'public, max-age=600')
      .send(renderSitemap(base, rows));
  });

  app.get('/blog/rss.xml', async (_req, reply) => {
    const rows = (await publishedList()).slice(0, 50);
    return reply
      .header('content-type', 'application/rss+xml; charset=utf-8')
      .header('cache-control', 'public, max-age=600')
      .send(renderRss(base, rows));
  });

  app.get('/blog/media/:file', async (request, reply) => {
    const file = (request.params as { file: string }).file;
    if (!MEDIA_RE.test(file)) return reply.code(404).send({ error: 'not_found' });
    const [m] = await db
      .select({ bytes: schema.seoMedia.bytes, mimeType: schema.seoMedia.mimeType })
      .from(schema.seoMedia)
      .where(eq(schema.seoMedia.fileName, file));
    if (!m) return reply.code(404).send({ error: 'not_found' });
    return (
      reply
        .header('content-type', m.mimeType)
        .header('cache-control', 'public, max-age=31536000, immutable')
        // An SVG opened directly can't run anything or load anything.
        .header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox")
        .send(Buffer.from(m.bytes))
    );
  });

  // IndexNow ownership proof: https://zybrilka.ru/blog/indexnow-<key>.txt
  app.get('/blog/indexnow-:key', async (request, reply) => {
    const raw = (request.params as { key: string }).key;
    const key = raw.endsWith('.txt') ? raw.slice(0, -4) : '';
    const [row] = await db
      .select({ config: schema.seoIntegrations.config })
      .from(schema.seoIntegrations)
      .where(eq(schema.seoIntegrations.kind, 'indexnow'));
    const stored = typeof row?.config.key === 'string' ? row.config.key : null;
    if (!stored || !/^[a-f0-9]{32}$/.test(key) || key !== stored) {
      return reply.code(404).send({ error: 'not_found' });
    }
    return reply.header('content-type', 'text/plain; charset=utf-8').send(stored);
  });

  app.get('/blog/:slug', async (request, reply) => {
    const slug = (request.params as { slug: string }).slug;
    if (!SEO_SLUG_RE.test(slug) || slug.length > 90) return html(reply, renderNotFound(base), 404);
    const [a] = await db
      .select()
      .from(schema.seoArticles)
      .where(and(eq(schema.seoArticles.slug, slug), eq(schema.seoArticles.status, 'published')));
    if (!a) return html(reply, renderNotFound(base), 404);

    const mediaRows = await db
      .select({
        id: schema.seoMedia.id,
        fileName: schema.seoMedia.fileName,
        alt: schema.seoMedia.alt,
        width: schema.seoMedia.width,
        height: schema.seoMedia.height,
        description: schema.seoMedia.description,
      })
      .from(schema.seoMedia)
      .where(eq(schema.seoMedia.articleId, a.id));
    const media = new Map<string, BlogMedia>(mediaRows.map((m) => [m.id, m]));

    const relatedWhere = a.subjectId
      ? and(
          eq(schema.seoArticles.status, 'published'),
          ne(schema.seoArticles.id, a.id),
          eq(schema.seoArticles.subjectId, a.subjectId),
        )
      : and(eq(schema.seoArticles.status, 'published'), ne(schema.seoArticles.id, a.id));
    const related = await db
      .select({ slug: schema.seoArticles.slug, title: schema.seoArticles.title })
      .from(schema.seoArticles)
      .where(relatedWhere)
      .orderBy(desc(schema.seoArticles.publishedAt))
      .limit(4);

    let ctaHref: string | null = null;
    if (a.campaignId) {
      const [c] = await db
        .select({ slug: schema.campaigns.slug })
        .from(schema.campaigns)
        .where(
          and(eq(schema.campaigns.id, a.campaignId), inArray(schema.campaigns.status, ['active'])),
        );
      if (c) ctaHref = `${base}/api/v1/go/${c.slug}`;
    }
    return html(
      reply,
      renderArticlePage(a, { origin: base, ctaHref, media, related, metrika: false }),
    );
  });
};
