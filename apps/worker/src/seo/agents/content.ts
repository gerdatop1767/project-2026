import {
  enqueueSeoTask,
  loadSeoSettings,
  saveArticleRevision,
  schema,
  uniqueArticleSlug,
} from '@zybrilka/db';
import {
  articleQualityIssues,
  normalizeQuery,
  renderMarkdown,
  SEO_ARTICLE_FORMAT_LABELS,
  SEO_ARTICLE_FORMATS,
  seoSlug,
  type SeoArticleFormat,
} from '@zybrilka/shared';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import {
  OFFICIAL_SOURCES,
  PLATFORM_SUBJECTS,
  SITE_PAGES,
  nextMoscowTime,
  type SeoDeps,
} from '../deps.js';
import { PermanentError, type TaskHandler } from '../queue.js';

/**
 * Content Agent (docs/SEO_CENTER.md §5): facts first (web search, official
 * sources), then the article as structured output, then a code-side quality
 * gate. Review Agent: a separate fact-check pass. Nothing unverified goes
 * live — a failed check leaves the article «На проверке».
 */

export const generatedArticleSchema = z.object({
  title: z.string().min(5).max(200),
  seoTitle: z.string().min(10).max(80),
  metaDescription: z.string().min(80).max(200),
  h1: z.string().min(5).max(200),
  slugHint: z.string().min(3).max(90),
  format: z.enum(SEO_ARTICLE_FORMATS),
  bodyMd: z.string().min(2000).max(60_000),
  faq: z
    .array(z.object({ question: z.string().min(5).max(300), answer: z.string().min(10).max(1500) }))
    .min(3)
    .max(8),
  sources: z
    .array(z.object({ title: z.string().min(2).max(300), url: z.string().url().max(1000) }))
    .max(15),
  ogTitle: z.string().min(5).max(120),
  ogDescription: z.string().min(20).max(250),
  primaryKeyword: z.string().min(2).max(200),
  secondaryKeywords: z.array(z.string().min(2).max(200)).max(15),
  ctaPath: z.enum(SITE_PAGES.map((p) => p.path) as [string, ...string[]]),
});

const reviewSchema = z.object({
  verdict: z.enum(['pass', 'fix', 'reject']),
  factualIssues: z
    .array(
      z.object({
        claim: z.string().max(500),
        problem: z.string().max(500),
        correction: z.string().max(800),
      }),
    )
    .max(20),
  styleIssues: z.array(z.string().max(300)).max(10),
  summary: z.string().max(1000),
});

const WRITER_SYSTEM = `Ты — образовательный редактор «Зубрилки», бесплатного тренажёра ЕГЭ (zybrilka.ru). Пишешь статьи для школьников 10–11 классов.
Стиль: живой естественный русский язык, на «ты», коротко и по делу, конкретные примеры и разборы. Без воды, без повторов одной мысли, без канцелярита, без кликбейта.
SEO: основной запрос — в SEO Title, H1 и первом абзаце; остальные запросы — естественно, без переспама. SEO Title до 65 символов, Meta Description 120–160 символов.
Структура тела (Markdown): начинай с короткого вступления (без заголовка H1 — он отдельно); 4–8 разделов «## …», при необходимости «### …»; списки, таблицы (| … |), блоки «> [!tip] …», «> [!mistake] …», «> [!example] …».
Внутренние ссылки: минимум 3 ссылки вида [текст](/путь) только на страницы из списка «Страницы сайта» и «Статьи блога». Внешние ссылки — только на официальные источники, которые ты действительно нашёл.
Факты об ЕГЭ (баллы, номера заданий, даты, изменения) — ТОЛЬКО из переданных фактов исследования. Если факта нет — не пиши его.
Не обещай задания по предметам, которых нет на платформе. Не копируй тексты конкурентов. Не используй картинки — их добавит отдельный агент.`;

function format(f: SeoArticleFormat) {
  return `${f} (${SEO_ARTICLE_FORMAT_LABELS[f]})`;
}

export function writeArticleHandler(deps: SeoDeps): TaskHandler {
  return async (ctx) => {
    const { db, ai } = deps;
    const settings = await loadSeoSettings(db);
    const payload = ctx.task.payload as {
      topicId?: string;
      articleId?: string;
      instructions?: string | null;
    };

    // The article row: from an admin idea (articleId) or a topic.
    let article = payload.articleId
      ? (
          await db
            .select()
            .from(schema.seoArticles)
            .where(eq(schema.seoArticles.id, payload.articleId))
        )[0]
      : undefined;
    const topic = payload.topicId
      ? (
          await db.select().from(schema.seoTopics).where(eq(schema.seoTopics.id, payload.topicId))
        )[0]
      : article?.topicId
        ? (
            await db.select().from(schema.seoTopics).where(eq(schema.seoTopics.id, article.topicId))
          )[0]
        : undefined;
    if (!article && !topic) throw new PermanentError('nothing to write: no article and no topic');
    if (article && article.status === 'generating')
      throw new PermanentError('article is being generated');
    if (!article) {
      if (topic!.articleId) throw new PermanentError('topic already has an article');
      const slug = await uniqueArticleSlug(db, seoSlug(topic!.primaryKeyword ?? topic!.title));
      [article] = await db
        .insert(schema.seoArticles)
        .values({
          title: topic!.title,
          slug,
          status: 'research',
          topicId: topic!.id,
          format: topic!.format,
          subjectId: topic!.subjectId,
          primaryKeyword: topic!.primaryKeyword,
          priority: topic!.priority,
          generatedBy: settings.strongModel,
        })
        .returning();
      await db
        .update(schema.seoTopics)
        .set({ articleId: article!.id, status: 'writing', updatedAt: deps.now() })
        .where(eq(schema.seoTopics.id, topic!.id));
    }
    const a = article!;
    await db
      .update(schema.seoArticles)
      .set({ status: 'research', updatedAt: deps.now() })
      .where(eq(schema.seoArticles.id, a.id));
    await ctx.log('article.research', `Сбор фактов для «${a.title}»`, { articleId: a.id });

    const subjectName = a.subjectId ? PLATFORM_SUBJECTS[a.subjectId] : undefined;
    const facts = await ai.cached(
      'article_facts',
      { title: a.title, kw: a.primaryKeyword, angle: topic?.angle },
      72,
      async () => {
        const r = await ai.text({
          agent: 'content',
          purpose: 'article.facts',
          taskId: ctx.task.id,
          tier: 'strong',
          effort: 'medium',
          maxTokens: 8000,
          webSearch: { maxUses: 6 },
          system:
            'Ты собираешь проверенные факты для образовательной статьи об ЕГЭ. Приоритет источников: ' +
            OFFICIAL_SOURCES.join(', ') +
            '. Указывай год ЕГЭ для каждого факта. Если источники противоречат друг другу — укажи это.',
          prompt: `Тема: «${a.title}». Основной запрос: «${a.primaryKeyword ?? a.title}». ${topic?.angle ? `Угол: ${topic.angle}.` : ''}${subjectName ? ` Предмет: ${subjectName}.` : ''}
Найди и перечисли факты, нужные для статьи: номера и форматы заданий, баллы, критерии, даты, изменения 2026/2027, типичные ошибки (по аналитическим отчётам ФИПИ, если есть). Каждый факт — с URL источника и годом.`,
        });
        return { text: r.text, sources: r.sources.slice(0, 20) };
      },
    );

    const [published, insights] = await Promise.all([
      db
        .select({ slug: schema.seoArticles.slug, title: schema.seoArticles.title })
        .from(schema.seoArticles)
        .where(eq(schema.seoArticles.status, 'published'))
        .orderBy(desc(schema.seoArticles.publishedAt))
        .limit(60),
      db
        .select()
        .from(schema.seoInsights)
        .where(inArray(schema.seoInsights.dimension, ['format', 'title_pattern']))
        .limit(20),
    ]);

    await db
      .update(schema.seoArticles)
      .set({ status: 'generating', updatedAt: deps.now() })
      .where(eq(schema.seoArticles.id, a.id));
    const wantedFormat = (topic?.format ?? a.format ?? 'guide') as SeoArticleFormat;
    const { data } = await ai.json(
      {
        agent: 'content',
        purpose: 'article.write',
        taskId: ctx.task.id,
        tier: 'strong',
        effort: 'high',
        maxTokens: 20_000,
        system: WRITER_SYSTEM,
        prompt: `Напиши статью.
Тема: «${a.title}»
Основной запрос: «${a.primaryKeyword ?? a.title}»
Дополнительные запросы: ${(topic?.keywords ?? a.secondaryKeywords).join(', ') || '—'}
Формат: ${format(wantedFormat)}
${topic?.angle ? `Угол подачи: ${topic.angle}` : ''}
${subjectName ? `Предмет: ${subjectName}` : 'Общая тема подготовки'}
${payload.instructions ? `Указания редактора: ${payload.instructions}` : ''}

Факты исследования (используй только их):
${facts.text.slice(0, 24_000)}

Найденные источники:
${facts.sources.map((s) => `- ${s.title}: ${s.url}`).join('\n') || '—'}

Страницы сайта (для внутренних ссылок и ctaPath):
${SITE_PAGES.map((p) => `- ${p.path} — ${p.title}`).join('\n')}

Статьи блога (ссылка вида /blog/<slug>):
${published.map((p) => `- /blog/${p.slug} — ${p.title}`).join('\n') || '—'}

Что лучше работало раньше (реальные данные, можно учитывать):
${insights.map((i) => `- ${i.dimension}=${i.value}: ${JSON.stringify(i.metrics)} (n=${i.sampleSize})`).join('\n') || '— (данных пока нет)'}

Объём тела: 1200–2500 слов. FAQ: 3–6 вопросов, которые реально задают школьники. sources — только реально использованные URL из списка выше.`,
      },
      generatedArticleSchema,
    );

    // Code-side gate: structure, links, stuffing. Also drop external links not in the found sources.
    const allowedExternal = new Set([
      ...facts.sources.map((s) => s.url),
      ...data.sources.map((s) => s.url),
    ]);
    const rendered = renderMarkdown(data.bodyMd);
    const internalLinks = rendered.links.filter((l) => l.startsWith('/')).length;
    const unknownExternal = rendered.links.filter(
      (l) =>
        /^https?:/.test(l) &&
        !allowedExternal.has(l) &&
        !OFFICIAL_SOURCES.some((d) => new URL(l).host.endsWith(d)),
    );
    const issues = articleQualityIssues(data, {
      wordCount: rendered.wordCount,
      h2Count: rendered.headings.filter((h) => h.level === 2).length,
      internalLinks,
    });
    if (unknownExternal.length)
      issues.push(
        `Внешние ссылки не из найденных источников: ${unknownExternal.slice(0, 3).join(', ')}`,
      );

    const [current] = await db
      .select()
      .from(schema.seoArticles)
      .where(eq(schema.seoArticles.id, a.id));
    const live = current!.publishedAt !== null;
    const slug = live ? current!.slug : await uniqueArticleSlug(db, seoSlug(data.slugHint), a.id);
    const fields = {
      title: data.title,
      seoTitle: data.seoTitle,
      metaDescription: data.metaDescription,
      h1: data.h1,
      slug,
      format: data.format,
      bodyMd: data.bodyMd,
      faq: data.faq,
      sources: data.sources,
      ogTitle: data.ogTitle,
      ogDescription: data.ogDescription,
      primaryKeyword: data.primaryKeyword,
      secondaryKeywords: data.secondaryKeywords,
      ctaPath: data.ctaPath,
      coverMediaId: current!.coverMediaId,
      subjectId: current!.subjectId,
    };
    let pendingRevisionId: string | null = null;
    if (live) {
      // An article that is (or was) on the site is never overwritten by
      // unreviewed text: the new version waits as a pending revision.
      const [rev] = await db
        .insert(schema.seoArticleRevisions)
        .values({
          articleId: a.id,
          version: current!.version + 1,
          snapshot: { ...fields, wordCount: rendered.wordCount, qualityIssues: issues },
          reason: 'pending_update',
          actor: 'agent:content',
        })
        .returning({ id: schema.seoArticleRevisions.id });
      pendingRevisionId = rev!.id;
      await db
        .update(schema.seoArticles)
        .set({
          status: current!.status === 'published' ? 'needs_update' : current!.status,
          error: null,
          updatedAt: deps.now(),
        })
        .where(eq(schema.seoArticles.id, a.id));
    } else {
      if (current!.bodyMd)
        await saveArticleRevision(
          db,
          current!,
          payload.instructions ? 'agent_rewrite' : 'agent_generate',
          'agent:content',
        );
      await db
        .update(schema.seoArticles)
        .set({
          ...fields,
          wordCount: rendered.wordCount,
          qualityIssues: issues,
          status: 'draft',
          factCheckPassed: null,
          generatedBy: current!.generatedBy ?? 'agent',
          version: current!.version + 1,
          error: null,
          updatedAt: deps.now(),
        })
        .where(eq(schema.seoArticles.id, a.id));
    }

    // Keywords of this article now count as covered (one article per query — anti-cannibalisation).
    for (const q of [data.primaryKeyword, ...data.secondaryKeywords]) {
      const normalized = normalizeQuery(q);
      await db
        .insert(schema.seoKeywords)
        .values({
          query: q,
          normalized,
          subjectId: a.subjectId,
          articleId: a.id,
          source: 'article',
        })
        .onConflictDoNothing();
      await db
        .update(schema.seoKeywords)
        .set({ articleId: a.id })
        .where(and(eq(schema.seoKeywords.normalized, normalized)));
    }
    await ctx.log(
      'article.generated',
      `Черновик «${data.title}»: ${rendered.wordCount} слов, ${issues.length ? `замечаний ${issues.length}` : 'без замечаний'}`,
      { articleId: a.id, details: { issues } },
    );
    await ctx.enqueue({
      kind: 'review_article',
      agent: 'content',
      key: `review_article:${a.id}:v${current!.version + 1}`,
      articleId: a.id,
      payload: { articleId: a.id, pendingRevisionId },
      priority: 65,
    });
    return { articleId: a.id, words: rendered.wordCount, issues: issues.length };
  };
}

export function reviewArticleHandler(deps: SeoDeps): TaskHandler {
  return async (ctx) => {
    const { db, ai } = deps;
    const settings = await loadSeoSettings(db);
    const { articleId, pendingRevisionId } = ctx.task.payload as {
      articleId: string;
      pendingRevisionId?: string | null;
    };
    const [stored] = await db
      .select()
      .from(schema.seoArticles)
      .where(eq(schema.seoArticles.id, articleId));
    if (!stored) throw new PermanentError('article not found');
    let pending: Record<string, unknown> | null = null;
    if (pendingRevisionId) {
      const [rev] = await db
        .select()
        .from(schema.seoArticleRevisions)
        .where(eq(schema.seoArticleRevisions.id, pendingRevisionId));
      if (!rev || rev.reason !== 'pending_update') return { skipped: 'revision gone' };
      pending = rev.snapshot;
    } else if (!['draft', 'review', 'needs_update'].includes(stored.status)) {
      return { skipped: stored.status };
    }
    // What is reviewed: the pending update, or the article itself.
    const a = pending
      ? {
          ...stored,
          ...(pending as Partial<typeof stored>),
          qualityIssues: (pending.qualityIssues as string[]) ?? [],
        }
      : stored;

    const { data } = await ai.json(
      {
        agent: 'content',
        purpose: 'article.factcheck',
        taskId: ctx.task.id,
        tier: 'strong',
        effort: 'high',
        maxTokens: 6000,
        system: `Ты — строгий редактор-факт-чекер материалов об ЕГЭ. Проверяй утверждения о баллах, номерах заданий, форматах, датах, изменениях и правилах по официальным источникам (${OFFICIAL_SOURCES.join(', ')}). Если утверждение нельзя подтвердить — это проблема. Оцени и стиль: вода, повторы, канцелярит, переспам.
verdict: pass — можно публиковать; fix — есть исправимые ошибки; reject — тема или текст непригодны.`,
        prompt: `Статья «${a.title}» (основной запрос «${a.primaryKeyword}»).

${a.bodyMd}

FAQ:
${a.faq.map((f) => `В: ${f.question}\nО: ${f.answer}`).join('\n')}

Источники, указанные автором:
${a.sources.map((s) => `- ${s.url}`).join('\n') || '—'}`,
      },
      reviewSchema,
    );
    // The structured review above has no web access; verify the flagged claims with search.
    let verified = data;
    if (data.factualIssues.length || data.verdict !== 'pass') {
      const check = await ai.text({
        agent: 'content',
        purpose: 'article.factcheck.web',
        taskId: ctx.task.id,
        tier: 'strong',
        effort: 'medium',
        maxTokens: 4000,
        webSearch: { maxUses: 5 },
        system:
          'Ты проверяешь спорные утверждения об ЕГЭ по официальным источникам. Для каждого — «верно»/«неверно»/«не подтверждается» и правильная формулировка с URL.',
        prompt: `Проверь утверждения:\n${data.factualIssues.map((i, n) => `${n + 1}. ${i.claim} (сомнение: ${i.problem})`).join('\n') || data.summary}`,
      });
      const { data: second } = await ai.json(
        {
          agent: 'content',
          purpose: 'article.factcheck.verdict',
          taskId: ctx.task.id,
          tier: 'cheap',
          effort: 'low',
          maxTokens: 3000,
          system: 'Сведи итог проверки фактов в структуру. Оставь только подтверждённые проблемы.',
          prompt: `Первичное ревью:\n${JSON.stringify(data)}\n\nПроверка по источникам:\n${check.text.slice(0, 12_000)}`,
        },
        reviewSchema,
      );
      verified = second;
    }

    const passed =
      verified.verdict === 'pass' &&
      verified.factualIssues.length === 0 &&
      a.qualityIssues.length === 0;
    const autoPublish = passed && settings.mode === 'auto' && !settings.publishingPaused;
    if (pending) {
      if (autoPublish) {
        await applyPendingRevision(deps, stored, pendingRevisionId!, verified);
      } else {
        await db
          .update(schema.seoArticles)
          .set({ reviewNotes: { ...verified, pendingRevisionId, passed }, updatedAt: deps.now() })
          .where(eq(schema.seoArticles.id, a.id));
      }
    } else {
      await db
        .update(schema.seoArticles)
        .set({
          status: autoPublish ? 'scheduled' : 'review',
          scheduledFor: autoPublish ? nextMoscowTime(settings.publishTime, deps.now()) : null,
          factCheckPassed: passed,
          reviewNotes: verified,
          updatedAt: deps.now(),
        })
        .where(eq(schema.seoArticles.id, a.id));
    }
    await ctx.log(
      'article.reviewed',
      passed
        ? `Факт-чек пройден: «${a.title}»${pending ? (autoPublish ? ' — обновление применено' : ' — обновление ждёт одобрения') : autoPublish ? ', запланирована публикация' : ', ждёт одобрения'}`
        : `Факт-чек: ${verified.verdict}, проблем ${verified.factualIssues.length}, замечаний качества ${a.qualityIssues.length} — на проверке`,
      { articleId: a.id, level: passed ? 'info' : 'warn', details: { review: verified } },
    );
    // Visuals regardless of verdict (an editor may fix and publish).
    await ctx.enqueue({
      kind: 'visuals',
      agent: 'visual',
      key: `visuals:${a.id}:v${a.version}`,
      articleId: a.id,
      payload: { articleId: a.id },
      priority: 55,
    });
    // A fixable article in autonomous mode gets one automatic rewrite with the corrections.
    if (
      !passed &&
      !pending &&
      verified.verdict === 'fix' &&
      settings.mode === 'auto' &&
      a.version < 4
    ) {
      await enqueueSeoTask(db, {
        kind: 'write_article',
        agent: 'content',
        idempotencyKey: `write_article:${a.id}:fix:v${a.version}`,
        articleId: a.id,
        payload: {
          articleId: a.id,
          instructions:
            `Исправь: ${verified.factualIssues.map((i) => `${i.claim} → ${i.correction}`).join('; ')}. ${a.qualityIssues.join(' ')}`.slice(
              0,
              1900,
            ),
        },
        priority: 60,
      });
    }
    return { passed, verdict: verified.verdict };
  };
}

/** Applies a reviewed pending update to a live article (agent or admin). */
export async function applyPendingRevision(
  deps: Pick<SeoDeps, 'db' | 'now'>,
  article: typeof schema.seoArticles.$inferSelect,
  revisionId: string,
  review: unknown,
) {
  const { db } = deps;
  const [rev] = await db
    .select()
    .from(schema.seoArticleRevisions)
    .where(eq(schema.seoArticleRevisions.id, revisionId));
  if (!rev || rev.reason !== 'pending_update') return false;
  const snap = rev.snapshot as Record<string, unknown>;
  await saveArticleRevision(db, article, 'before_update', 'agent:content');
  const { wordCount, qualityIssues, ...fields } = snap as {
    wordCount?: number;
    qualityIssues?: string[];
  } & Record<string, unknown>;
  await db
    .update(schema.seoArticles)
    .set({
      ...(fields as object),
      slug: article.slug,
      wordCount: wordCount ?? article.wordCount,
      qualityIssues: qualityIssues ?? [],
      status: 'published',
      factCheckPassed: true,
      reviewNotes: review as Record<string, unknown>,
      version: article.version + 1,
      updatedAt: deps.now(),
    })
    .where(eq(schema.seoArticles.id, article.id));
  await db
    .update(schema.seoArticleRevisions)
    .set({ reason: 'applied_update' })
    .where(eq(schema.seoArticleRevisions.id, revisionId));
  await enqueueSeoTask(db, {
    kind: 'post_publish_check',
    agent: 'technical',
    idempotencyKey: `post_publish_check:${article.id}:v${article.version + 1}`,
    articleId: article.id,
    payload: { articleId: article.id },
    priority: 80,
  });
  return true;
}
