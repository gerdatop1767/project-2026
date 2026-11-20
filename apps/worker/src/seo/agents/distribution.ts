import { createSeoCampaign, loadIntegration, loadSeoSettings, schema } from '@zybrilka/db';
import { escapeHtml, textSimilarity } from '@zybrilka/shared';
import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { SeoDeps } from '../deps.js';
import { telegramChannelPost, vkWallPost } from '../integrations/clients.js';
import { PermanentError, type TaskHandler } from '../queue.js';

/**
 * Distribution Agent (docs/SEO_CENTER.md §8). One adaptation per
 * (article, platform) — UNIQUE in the DB — written for that platform's
 * format and rules, never the same text twice (similarity < 0.6 to every
 * other post of the article). Each post gets its own tracked link (a
 * campaign, channel `seo_external`) so clicks and registrations are real.
 * Automatic publishing ONLY through official APIs (Telegram channel via
 * our bot, VK wall with a community token). Everything else is prepared
 * for manual posting with a checklist of the platform's rules.
 */

export const SIMILARITY_LIMIT = 0.6;

/** Telegram: a message's text (after HTML entities are parsed) is at most 4096 UTF-16 units. */
export const TELEGRAM_TEXT_LIMIT = 4096;
const TELEGRAM_SAFETY = 16;

/** Cuts plain text to `max` UTF-16 units, preferring a word boundary, never splitting a surrogate pair. */
function cutPlain(text: string, max: number): string {
  if (text.length <= max) return text;
  let cut = text.slice(0, max);
  if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1);
  const space = cut.search(/\s\S*$/);
  if (space > max - 200) cut = cut.slice(0, space);
  return `${cut.trimEnd()}…`;
}

/**
 * The channel post as Telegram HTML. Truncation happens on the PLAIN text
 * (before escaping), so a tag or an entity like `&amp;` can never be cut in
 * half; the tracked link always survives (re-appended when the body is cut).
 */
export function telegramPostHtml(title: string | null, body: string, link: string): string {
  const max = TELEGRAM_TEXT_LIMIT - TELEGRAM_SAFETY;
  const head = title?.trim() ? `${title.trim()}\n\n` : '';
  let text = body.trim();
  if (!text.includes(link)) text = `${text}\n\n${link}`;
  if (head.length + text.length > max) {
    const withoutLink = text.split(link).join('').replace(/\s+$/, '');
    const room = max - head.length - link.length - 2;
    text = `${cutPlain(withoutLink, Math.max(0, room))}\n\n${link}`;
  }
  const safeHead = head ? `<b>${escapeHtml(head.trimEnd())}</b>\n\n` : '';
  return `${safeHead}${escapeHtml(text)}`;
}

/** Validates a message before sending: only <b>…</b>, balanced; only complete entities; text within the limit. */
export function checkTelegramHtml(
  html: string,
): { ok: true; textLength: number } | { ok: false; problem: string } {
  const tags = html.match(/<\/?[a-z][^>]*>/gi) ?? [];
  let depth = 0;
  for (const t of tags) {
    if (t === '<b>') depth++;
    else if (t === '</b>') depth--;
    else return { ok: false, problem: `неразрешённый тег ${t}` };
    if (depth < 0 || depth > 1) return { ok: false, problem: 'несбалансированные теги' };
  }
  if (depth !== 0) return { ok: false, problem: 'незакрытый тег' };
  const withoutTags = html.replace(/<\/?b>/g, '');
  if (/[<>]/.test(withoutTags)) return { ok: false, problem: 'неэкранированные < или >' };
  const ampersands = withoutTags.match(/&[^;\s]{0,10};?/g) ?? [];
  for (const a of ampersands) {
    if (!/^&(amp|lt|gt|quot|#\d{1,6});$/.test(a))
      return { ok: false, problem: `оборванная сущность ${a}` };
  }
  const text = withoutTags.replace(/&(amp|lt|gt|quot);/g, 'x').replace(/&#\d+;/g, 'x');
  if (text.length > TELEGRAM_TEXT_LIMIT)
    return { ok: false, problem: `текст длиннее ${TELEGRAM_TEXT_LIMIT}` };
  return { ok: true, textLength: text.length };
}

const postSchema = z.object({
  title: z.string().max(200).nullable(),
  body: z.string().min(150).max(12_000),
  checklist: z.array(z.string().min(5).max(300)).min(2).max(8),
});

export function distributeHandler(deps: SeoDeps): TaskHandler {
  return async (ctx) => {
    const { db, ai, origin } = deps;
    const settings = await loadSeoSettings(db);
    const articleId = (ctx.task.payload as { articleId: string }).articleId;
    const [a] = await db
      .select()
      .from(schema.seoArticles)
      .where(eq(schema.seoArticles.id, articleId));
    if (!a) throw new PermanentError('article not found');
    if (!a.publishedAt) throw new PermanentError('article is not published');

    const since = new Date(deps.now().getTime() - 24 * 3600_000);
    const [{ n: today } = { n: 0 }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.seoExternalPosts)
      .where(gte(schema.seoExternalPosts.createdAt, since));
    let budget = Math.max(0, settings.maxExternalPostsPerDay - today);
    if (budget === 0) {
      await ctx.log(
        'distribute.limit',
        `Лимит внешних публикаций на сутки исчерпан (${settings.maxExternalPostsPerDay})`,
        { articleId: a.id },
      );
      return { created: 0 };
    }

    const platforms = await db
      .select()
      .from(schema.seoPlatforms)
      .where(eq(schema.seoPlatforms.isActive, true));
    const existing = await db
      .select()
      .from(schema.seoExternalPosts)
      .where(eq(schema.seoExternalPosts.articleId, a.id));
    const done = new Set(existing.map((p) => p.platformId));
    // Platforms that historically brought registrations go first (knowledge base).
    const perf = await db
      .select()
      .from(schema.seoInsights)
      .where(
        and(eq(schema.seoInsights.dimension, 'platform'), eq(schema.seoInsights.windowDays, 28)),
      );
    const score = (slug: string) =>
      Number(perf.find((p) => p.value === slug)?.metrics.registrations ?? 0) * 10 +
      Number(perf.find((p) => p.value === slug)?.metrics.clicks ?? 0);
    const ordered = platforms
      .filter((p) => !done.has(p.id))
      .sort(
        (x, y) =>
          (y.mode === 'api' ? 1 : 0) - (x.mode === 'api' ? 1 : 0) || score(y.slug) - score(x.slug),
      );

    let created = 0;
    const texts = existing.map((p) => p.body);
    for (const platform of ordered) {
      if (budget <= 0) break;
      const campaign = await createSeoCampaign(db, {
        name: `${platform.name}: ${a.title}`,
        source: platform.slug,
        channel: 'seo_external',
        creative: a.slug,
        targetPath: `/blog/${a.slug}`,
      });
      const link = `${origin}/api/v1/go/${campaign.slug}`;
      let post: z.infer<typeof postSchema> | null = null;
      let similarity = 1;
      for (let attempt = 0; attempt < 2 && similarity >= SIMILARITY_LIMIT; attempt++) {
        const { data } = await ai.json(
          {
            agent: 'distribution',
            purpose: `distribute.${platform.slug}`,
            taskId: ctx.task.id,
            tier: platform.slug === 'dzen' || platform.slug === 'vc' ? 'strong' : 'cheap',
            effort: 'medium',
            maxTokens: 6000,
            system: `Ты адаптируешь материалы бесплатного тренажёра ЕГЭ «Зубрилка» для внешних площадок. Каждая площадка — свой формат и тон. Пост должен быть полезен сам по себе, без рекламного тона, ссылка — одна и естественная. Запрещено: спам, кликбейт, фальшивые отзывы, выдача себя за ученика, обещания «слить ответы». Не повторяй исходный текст дословно.`,
            prompt: `Площадка: ${platform.name}
Формат площадки: ${platform.format}
Правила площадки: ${platform.rules}
${attempt > 0 ? 'Предыдущий вариант слишком похож на другие публикации этой статьи — напиши иначе: другой угол, другая структура, другие примеры.\n' : ''}
Статья «${a.title}» (${origin}/blog/${a.slug}):
${a.bodyMd.slice(0, 12_000)}

Ссылка для поста (вставь ровно одну, как есть): ${link}
${platform.slug === 'telegram' ? 'Telegram: текст без Markdown, абзацы, можно эмодзи умеренно, до 1200 знаков.' : ''}
Верни заголовок (или null, если площадке он не нужен), текст поста и чек-лист из правил площадки, который нужно проверить перед публикацией.`,
          },
          postSchema,
        );
        similarity = Math.max(
          0,
          ...texts.map((t) => textSimilarity(t, data.body)),
          textSimilarity(a.bodyMd, data.body),
        );
        post = data;
      }
      if (!post || similarity >= SIMILARITY_LIMIT) {
        await db
          .update(schema.campaigns)
          .set({ status: 'archived' })
          .where(eq(schema.campaigns.id, campaign.id));
        await ctx.log(
          'distribute.skipped',
          `${platform.name}: не удалось получить достаточно отличающийся текст (сходство ${similarity.toFixed(2)})`,
          { articleId: a.id, level: 'warn' },
        );
        continue;
      }
      const body = post.body.includes(link) ? post.body : `${post.body}\n\n${link}`;
      const [row] = await db
        .insert(schema.seoExternalPosts)
        .values({
          articleId: a.id,
          platformId: platform.id,
          status: 'ready',
          title: post.title,
          body,
          link,
          campaignId: campaign.id,
          checklist: post.checklist,
          similarityMax: Math.round(similarity * 100) / 100,
        })
        .onConflictDoNothing()
        .returning();
      if (!row) continue;
      texts.push(body);
      created++;
      budget--;
      if (platform.mode === 'api' && settings.mode === 'auto' && !settings.publishingPaused) {
        await ctx.enqueue({
          kind: 'publish_external',
          agent: 'distribution',
          key: `publish_external:${row.id}`,
          payload: { postId: row.id },
          priority: 70,
        });
      }
    }
    await ctx.log('distribute.done', `Подготовлено внешних публикаций: ${created}`, {
      articleId: a.id,
    });
    return { created };
  };
}

export function publishExternalHandler(deps: SeoDeps): TaskHandler {
  return async (ctx) => {
    const { db } = deps;
    const settings = await loadSeoSettings(db);
    const postId = (ctx.task.payload as { postId: string }).postId;
    const [row] = await db
      .select({ post: schema.seoExternalPosts, platform: schema.seoPlatforms })
      .from(schema.seoExternalPosts)
      .innerJoin(
        schema.seoPlatforms,
        eq(schema.seoPlatforms.id, schema.seoExternalPosts.platformId),
      )
      .where(eq(schema.seoExternalPosts.id, postId));
    if (!row) throw new PermanentError('post not found');
    if (row.platform.mode !== 'api') throw new PermanentError('platform has no API publishing');
    if (settings.publishingPaused && !ctx.task.payload.manual)
      return { skipped: 'publishing paused' };
    // Claim: only a 'ready'/'error' post can move to 'scheduled' — a second run finds nothing to claim.
    const claimed = await db
      .update(schema.seoExternalPosts)
      .set({ status: 'scheduled', updatedAt: new Date() })
      .where(
        and(
          eq(schema.seoExternalPosts.id, postId),
          inArray(schema.seoExternalPosts.status, ['ready', 'draft', 'error']),
        ),
      )
      .returning({ id: schema.seoExternalPosts.id });
    if (!claimed.length) return { skipped: row.post.status };
    try {
      let result: { url: string | null; id: string };
      if (row.platform.slug === 'telegram') {
        const integ = await loadIntegration(db, deps.secretsKey, 'telegram_channel');
        const channel = integ?.config.channelId;
        if (!deps.telegramBotToken || typeof channel !== 'string')
          throw new PermanentError('Telegram-канал не подключён');
        const html = telegramPostHtml(row.post.title, row.post.body, row.post.link);
        const check = checkTelegramHtml(html);
        if (!check.ok)
          throw new PermanentError(`Telegram HTML не прошёл проверку: ${check.problem}`);
        const r = await telegramChannelPost(deps.fetch, deps.telegramBotToken, channel, html);
        result = { url: r.url, id: String(r.messageId) };
      } else if (row.platform.slug === 'vk') {
        const integ = await loadIntegration(db, deps.secretsKey, 'vk');
        if (!integ?.secret || !integ.config.groupId)
          throw new PermanentError('VK не подключён (нужен токен сообщества)');
        const r = await vkWallPost(
          deps.fetch,
          integ.secret,
          Number(integ.config.groupId),
          `${row.post.title ? `${row.post.title}\n\n` : ''}${row.post.body}`,
          row.post.link,
        );
        result = { url: r.url, id: String(r.postId) };
      } else {
        throw new PermanentError(`no API client for ${row.platform.slug}`);
      }
      await db
        .update(schema.seoExternalPosts)
        .set({
          status: 'published',
          externalUrl: result.url,
          externalId: result.id,
          publishedAt: new Date(),
          error: null,
          updatedAt: new Date(),
        })
        .where(eq(schema.seoExternalPosts.id, postId));
      await ctx.log(
        'external.published',
        `Опубликовано: ${row.platform.name}${result.url ? ` — ${result.url}` : ''}`,
        { articleId: row.post.articleId },
      );
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await db
        .update(schema.seoExternalPosts)
        .set({ status: 'error', error: message.slice(0, 500), updatedAt: new Date() })
        .where(eq(schema.seoExternalPosts.id, postId));
      // Never retry a post automatically: a timeout may have published it already (no duplicates).
      throw new PermanentError(message);
    }
  };
}
