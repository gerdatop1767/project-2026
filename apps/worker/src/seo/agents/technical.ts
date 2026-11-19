import { loadIntegration, schema } from '@zybrilka/db';
import type { SeoIssueSeverity } from '@zybrilka/shared';
import { and, eq, inArray, notInArray, sql } from 'drizzle-orm';
import type { SeoDeps } from '../deps.js';
import { indexNowPing } from '../integrations/clients.js';
import { PermanentError, type TaskHandler } from '../queue.js';

/**
 * Technical SEO Agent (docs/SEO_CENTER.md §11). Crawls ONLY our own site
 * (sitemaps + internal links), reads the HTML the server returns and
 * records issues with priority, impact and the fix. Safe fixes it applies
 * itself (re-ping IndexNow for unindexed articles, re-run checks); anything
 * that changes pages or server config is left for the owner.
 */

export interface PageFacts {
  url: string;
  status: number;
  location: string | null;
  ms: number;
  bytes: number;
  title: string | null;
  description: string | null;
  canonical: string | null;
  robots: string | null;
  h1Count: number;
  imgsWithoutAlt: number;
  jsonLd: number;
  viewport: boolean;
  links: string[];
}

const attr = (tag: string, name: string) => {
  const m = new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(tag);
  return m ? (m[2] ?? m[3] ?? '') : null;
};
const decode = (s: string) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

/** Parses the bits of HTML an SEO audit needs (no DOM; tolerant regexes). */
export function parsePage(
  url: string,
  html: string,
  status: number,
  location: string | null,
  ms: number,
): PageFacts {
  const metas = html.match(/<meta\b[^>]*>/gi) ?? [];
  const meta = (n: string) => {
    const tag = metas.find((t) => (attr(t, 'name') ?? '').toLowerCase() === n);
    return tag ? decode(attr(tag, 'content') ?? '') : null;
  };
  const linkTags = html.match(/<link\b[^>]*>/gi) ?? [];
  const canonicalTag = linkTags.find((t) => (attr(t, 'rel') ?? '').toLowerCase() === 'canonical');
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() ?? null;
  const imgs = html.match(/<img\b[^>]*>/gi) ?? [];
  const anchors = html.match(/<a\b[^>]*>/gi) ?? [];
  return {
    url,
    status,
    location,
    ms,
    bytes: html.length,
    title: title ? decode(title) : null,
    description: meta('description'),
    canonical: canonicalTag ? attr(canonicalTag, 'href') : null,
    robots: meta('robots'),
    h1Count: (html.match(/<h1[\s>]/gi) ?? []).length,
    imgsWithoutAlt: imgs.filter((t) => attr(t, 'alt') === null).length,
    jsonLd: (html.match(/application\/ld\+json/gi) ?? []).length,
    viewport: metas.some((t) => (attr(t, 'name') ?? '').toLowerCase() === 'viewport'),
    links: anchors
      .map((t) => attr(t, 'href'))
      .filter((h): h is string => Boolean(h))
      .map(decode),
  };
}

async function fetchPage(deps: SeoDeps, url: string): Promise<PageFacts> {
  const started = Date.now();
  const res = await deps.fetch(url, {
    redirect: 'manual',
    headers: { 'user-agent': 'ZybrilkaSeoAudit/1.0 (+https://zybrilka.ru)' },
    signal: AbortSignal.timeout(20_000),
  });
  const html =
    res.status >= 200 &&
    res.status < 300 &&
    (res.headers.get('content-type') ?? '').includes('html')
      ? await res.text()
      : '';
  return parsePage(url, html, res.status, res.headers.get('location'), Date.now() - started);
}

function sitemapUrls(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => decode(m[1]!));
}

interface Issue {
  code: string;
  url: string;
  severity: SeoIssueSeverity;
  title: string;
  description: string;
  impact: string;
  fix: string;
  autoFixable?: boolean;
}

/** Rules → issues for one page (pure; unit-tested). */
export function pageIssues(p: PageFacts, origin: string, inSitemap: boolean): Issue[] {
  const out: Issue[] = [];
  const add = (i: Omit<Issue, 'url'>) => out.push({ ...i, url: p.url });
  if (p.status >= 400) {
    add({
      code: `http_${p.status}`,
      severity: inSitemap ? 'critical' : 'high',
      title: `Страница отвечает ${p.status}`,
      description: `${p.url} → HTTP ${p.status}${inSitemap ? ', но адрес есть в sitemap' : ''}.`,
      impact: 'Поисковик исключит страницу; ссылки на неё теряют вес.',
      fix: inSitemap
        ? 'Убрать адрес из sitemap или вернуть страницу.'
        : 'Исправить ссылку на рабочую страницу или настроить 301.',
    });
    return out;
  }
  if (p.status >= 300 && p.status < 400) {
    if (inSitemap)
      add({
        code: 'redirect_in_sitemap',
        severity: 'medium',
        title: 'Редирект в sitemap',
        description: `${p.url} → ${p.status} ${p.location ?? ''}`,
        impact: 'Робот тратит обход на редиректы.',
        fix: 'Указать в sitemap конечный адрес.',
      });
    return out;
  }
  const noindex = (p.robots ?? '').toLowerCase().includes('noindex');
  if (inSitemap && noindex)
    add({
      code: 'noindex_in_sitemap',
      severity: 'high',
      title: 'noindex у страницы из sitemap',
      description: 'Страница одновременно в sitemap и закрыта от индекса.',
      impact: 'Противоречивые сигналы, страница не попадёт в поиск.',
      fix: 'Убрать из sitemap или снять noindex.',
    });
  if (noindex) return out;
  if (!p.title)
    add({
      code: 'title_missing',
      severity: 'high',
      title: 'Нет <title>',
      description: 'У страницы нет заголовка.',
      impact: 'Поисковик сам соберёт сниппет, CTR падает.',
      fix: 'Добавить уникальный title 30–65 символов.',
    });
  else if (p.title.length > 70)
    add({
      code: 'title_long',
      severity: 'low',
      title: 'Длинный title',
      description: `${p.title.length} символов.`,
      impact: 'Заголовок обрежется в выдаче.',
      fix: 'Сократить до 65 символов.',
      autoFixable: p.url.includes('/blog/'),
    });
  if (!p.description)
    add({
      code: 'description_missing',
      severity: 'medium',
      title: 'Нет meta description',
      description: 'Нет описания страницы.',
      impact: 'Хуже сниппет и CTR.',
      fix: 'Добавить описание 120–160 символов.',
    });
  else if (p.description.length < 70 || p.description.length > 200)
    add({
      code: 'description_length',
      severity: 'low',
      title: 'Описание неудачной длины',
      description: `${p.description.length} символов.`,
      impact: 'Сниппет обрежется или будет пустоват.',
      fix: 'Сделать 120–160 символов.',
    });
  if (!p.canonical)
    add({
      code: 'canonical_missing',
      severity: 'medium',
      title: 'Нет canonical',
      description: 'Страница не указывает канонический адрес.',
      impact: 'Риск дублей с параметрами.',
      fix: 'Добавить <link rel="canonical">.',
    });
  else {
    const want = p.url.replace(/\?.*$/, '');
    if (p.canonical.replace(/\/+$/, '') !== want.replace(/\/+$/, ''))
      add({
        code: 'canonical_other',
        severity: 'medium',
        title: 'canonical на другой адрес',
        description: `canonical = ${p.canonical}`,
        impact: 'Страница может не индексироваться сама по себе.',
        fix: 'Проверить, что это намеренно; иначе canonical = собственный адрес.',
      });
    if (!p.canonical.startsWith(origin))
      add({
        code: 'canonical_foreign',
        severity: 'high',
        title: 'canonical на чужой домен или http',
        description: p.canonical,
        impact: 'Вес уходит на другой адрес.',
        fix: `Использовать ${origin}.`,
      });
  }
  if (p.h1Count === 0)
    add({
      code: 'h1_missing',
      severity: 'medium',
      title: 'Нет H1 в HTML',
      description: 'В ответе сервера нет H1 (возможно, он рисуется только скриптом).',
      impact: 'Поисковику сложнее понять тему страницы.',
      fix: 'Отдавать H1 в серверном HTML.',
    });
  if (p.h1Count > 1)
    add({
      code: 'h1_multiple',
      severity: 'low',
      title: 'Несколько H1',
      description: `${p.h1Count} заголовков H1.`,
      impact: 'Размывается главная тема страницы.',
      fix: 'Оставить один H1.',
    });
  if (p.imgsWithoutAlt > 0)
    add({
      code: 'img_no_alt',
      severity: 'low',
      title: 'Изображения без alt',
      description: `${p.imgsWithoutAlt} шт.`,
      impact: 'Нет трафика из поиска по картинкам, хуже доступность.',
      fix: 'Добавить alt.',
    });
  if (!p.viewport)
    add({
      code: 'viewport_missing',
      severity: 'high',
      title: 'Нет meta viewport',
      description: 'Страница не адаптирована под мобильные.',
      impact: 'Mobile-first индекс понижает такие страницы.',
      fix: 'Добавить <meta name="viewport" content="width=device-width, initial-scale=1">.',
    });
  if (p.jsonLd === 0)
    add({
      code: 'jsonld_missing',
      severity: 'low',
      title: 'Нет микроразметки',
      description: 'Нет JSON-LD.',
      impact: 'Нет расширенных сниппетов.',
      fix: 'Добавить подходящую разметку Schema.org.',
    });
  if (p.ms > 1500)
    add({
      code: 'slow_response',
      severity: p.ms > 3000 ? 'high' : 'medium',
      title: 'Медленный ответ сервера',
      description: `${p.ms} мс до полного HTML.`,
      impact: 'Хуже Core Web Vitals (LCP) и обход.',
      fix: 'Проверить кэширование и запросы к БД на этой странице.',
    });
  return out;
}

export function technicalAuditHandler(deps: SeoDeps): TaskHandler {
  return async (ctx) => {
    const { db, origin } = deps;
    const [run] = await db.insert(schema.seoAuditRuns).values({}).returning();
    const issues: Issue[] = [];
    const add = (i: Issue) => issues.push(i);

    // robots.txt and sitemaps
    const robotsRes = await deps.fetch(`${origin}/robots.txt`, {
      signal: AbortSignal.timeout(15_000),
    });
    const robots = robotsRes.ok ? await robotsRes.text() : '';
    if (!robotsRes.ok)
      add({
        code: 'robots_missing',
        url: `${origin}/robots.txt`,
        severity: 'high',
        title: 'robots.txt недоступен',
        description: `HTTP ${robotsRes.status}`,
        impact: 'Робот не знает правил обхода и sitemap.',
        fix: 'Вернуть robots.txt.',
      });
    for (const sm of ['/sitemap.xml', '/blog/sitemap.xml']) {
      if (robotsRes.ok && !robots.includes(`${origin}${sm}`))
        add({
          code: 'sitemap_not_in_robots',
          url: `${origin}${sm}`,
          severity: 'medium',
          title: 'Sitemap не указан в robots.txt',
          description: `Нет строки «Sitemap: ${origin}${sm}».`,
          impact: 'Яндекс и Google могут не найти sitemap.',
          fix: `Добавить в robots.txt: Sitemap: ${origin}${sm}`,
        });
    }
    const sitemap = new Set<string>();
    for (const sm of ['/sitemap.xml', '/blog/sitemap.xml']) {
      const r = await deps.fetch(`${origin}${sm}`, { signal: AbortSignal.timeout(20_000) });
      if (!r.ok) {
        add({
          code: 'sitemap_unavailable',
          url: `${origin}${sm}`,
          severity: 'critical',
          title: 'Sitemap недоступен',
          description: `HTTP ${r.status}`,
          impact: 'Новые страницы индексируются медленнее.',
          fix: 'Проверить отдачу sitemap.',
        });
        continue;
      }
      for (const u of sitemapUrls(await r.text())) sitemap.add(u);
    }

    // Crawl: sitemap URLs first, then internal links found on them (BFS for depth).
    const queue: { url: string; depth: number }[] = [
      { url: `${origin}/`, depth: 0 },
      ...[...sitemap].map((url) => ({ url, depth: 99 })),
    ];
    const seen = new Map<string, PageFacts>();
    const depth = new Map<string, number>();
    const titles = new Map<string, string[]>();
    const LIMIT = 400;
    while (queue.length && seen.size < LIMIT) {
      const { url, depth: d } = queue.shift()!;
      const key = url.replace(/#.*$/, '');
      if (seen.has(key)) {
        if (d < (depth.get(key) ?? 99)) depth.set(key, d);
        continue;
      }
      let p: PageFacts;
      try {
        p = await fetchPage(deps, key);
      } catch (err) {
        add({
          code: 'fetch_failed',
          url: key,
          severity: 'high',
          title: 'Страница не ответила',
          description: err instanceof Error ? err.message : 'error',
          impact: 'Робот тоже может не дождаться ответа.',
          fix: 'Проверить доступность и время ответа.',
        });
        seen.set(key, {
          url: key,
          status: 0,
          location: null,
          ms: 0,
          bytes: 0,
          title: null,
          description: null,
          canonical: null,
          robots: null,
          h1Count: 0,
          imgsWithoutAlt: 0,
          jsonLd: 0,
          viewport: true,
          links: [],
        });
        continue;
      }
      seen.set(key, p);
      depth.set(key, Math.min(d, depth.get(key) ?? 99));
      for (const i of pageIssues(p, origin, sitemap.has(key))) add(i);
      if (p.title && p.status === 200 && !(p.robots ?? '').includes('noindex'))
        titles.set(p.title, [...(titles.get(p.title) ?? []), key]);
      for (const href of p.links) {
        let abs: URL;
        try {
          abs = new URL(href, key);
        } catch {
          continue;
        }
        if (
          abs.origin !== origin ||
          abs.pathname.startsWith('/api/') ||
          abs.pathname.startsWith('/admin')
        )
          continue;
        abs.hash = '';
        queue.push({ url: abs.toString(), depth: (depth.get(key) ?? 0) + 1 });
      }
    }

    // Broken internal links: link targets that answered 4xx, with a referring page.
    for (const [url, p] of seen) {
      if (p.status >= 400 && !sitemap.has(url)) {
        const ref = [...seen.values()].find((x) =>
          x.links.some((l) => {
            try {
              return new URL(l, x.url).toString().replace(/#.*$/, '') === url;
            } catch {
              return false;
            }
          }),
        );
        if (ref)
          add({
            code: 'broken_link',
            url,
            severity: 'high',
            title: 'Битая внутренняя ссылка',
            description: `Ссылка на ${url} (HTTP ${p.status}) со страницы ${ref.url}`,
            impact: 'Пользователь и робот упираются в ошибку.',
            fix: `Исправить ссылку на странице ${ref.url}.`,
          });
      }
    }
    for (const [title, urls] of titles) {
      if (urls.length > 1)
        add({
          code: 'duplicate_title',
          url: urls[0]!,
          severity: 'medium',
          title: 'Дубли title',
          description: `«${title}» на ${urls.length} страницах: ${urls.slice(0, 5).join(', ')}`,
          impact: 'Страницы конкурируют между собой, сниппеты одинаковые.',
          fix: 'Сделать заголовки уникальными.',
        });
    }
    for (const url of sitemap) {
      const d = depth.get(url);
      if (d !== undefined && d > 3 && d < 99)
        add({
          code: 'deep_page',
          url,
          severity: 'low',
          title: 'Глубокая вложенность',
          description: `${d} кликов от главной.`,
          impact: 'Такие страницы реже обходятся и получают меньше веса.',
          fix: 'Добавить ссылки из разделов верхнего уровня или из статей.',
        });
      if (!seen.has(url) || depth.get(url) === 99)
        add({
          code: 'orphan_page',
          url,
          severity: 'medium',
          title: 'Страница без внутренних ссылок',
          description: 'Есть в sitemap, но ни одна страница сайта на неё не ссылается.',
          impact: 'Слабый внутренний вес.',
          fix: 'Поставить ссылки из связанных статей и разделов.',
        });
    }

    // Indexing of articles (from Webmaster sync): unindexed after 7 days → re-ping (safe auto-fix).
    const unindexed = await db
      .select({ page: schema.seoIndexStatus.page })
      .from(schema.seoIndexStatus)
      .innerJoin(
        schema.seoArticles,
        sql`${schema.seoIndexStatus.page} = '/blog/' || ${schema.seoArticles.slug}`,
      )
      .where(
        and(
          eq(schema.seoIndexStatus.state, 'not_indexed'),
          sql`${schema.seoIndexStatus.date} = (SELECT max(date) FROM seo_index_status WHERE page LIKE '/blog/%')`,
          sql`${schema.seoArticles.publishedAt} < now() - interval '7 days'`,
        ),
      );
    let pinged = 0;
    const inx = await loadIntegration(db, deps.secretsKey, 'indexnow');
    if (unindexed.length && typeof inx?.config.key === 'string') {
      await indexNowPing(
        deps.fetch,
        origin,
        inx.config.key,
        unindexed.map((u) => `${origin}${u.page}`),
      );
      pinged = unindexed.length;
    }
    for (const u of unindexed)
      add({
        code: 'not_indexed',
        url: `${origin}${u.page}`,
        severity: 'medium',
        title: 'Статья не в индексе Яндекса',
        description:
          'Опубликована больше 7 дней назад, но не найдена в поиске (данные Вебмастера).',
        impact: 'Нет трафика со статьи.',
        fix: pinged
          ? 'Агент повторно отправил адрес в IndexNow. Если не поможет — проверить качество и дубли.'
          : 'Подключить IndexNow или отправить на переобход в Вебмастере.',
        autoFixable: true,
      });

    // Persist: upsert by (code, url); issues not found this run get closed.
    const foundKeys = new Set<string>();
    for (const i of issues) {
      foundKeys.add(`${i.code}|${i.url}`);
      await db
        .insert(schema.seoAuditIssues)
        .values({ ...i, autoFixable: i.autoFixable ?? false, runId: run!.id, status: 'open' })
        .onConflictDoUpdate({
          target: [schema.seoAuditIssues.code, schema.seoAuditIssues.url],
          set: {
            severity: i.severity,
            title: i.title,
            description: i.description,
            impact: i.impact,
            fix: i.fix,
            lastSeenAt: new Date(),
            runId: run!.id,
            status: sql`CASE WHEN ${schema.seoAuditIssues.status} = 'ignored' THEN 'ignored' ELSE 'open' END`,
            resolvedAt: null,
          },
        });
    }
    const open = await db
      .select()
      .from(schema.seoAuditIssues)
      .where(inArray(schema.seoAuditIssues.status, ['open']));
    const toClose = open.filter((o) => !foundKeys.has(`${o.code}|${o.url}`)).map((o) => o.id);
    if (toClose.length) {
      await db
        .update(schema.seoAuditIssues)
        .set({ status: 'fixed', resolvedAt: new Date() })
        .where(
          and(
            inArray(schema.seoAuditIssues.id, toClose),
            notInArray(schema.seoAuditIssues.status, ['ignored']),
          ),
        );
    }
    const bySeverity = issues.reduce<Record<string, number>>(
      (a, i) => ({ ...a, [i.severity]: (a[i.severity] ?? 0) + 1 }),
      {},
    );
    await db
      .update(schema.seoAuditRuns)
      .set({
        finishedAt: new Date(),
        pagesChecked: seen.size,
        issuesFound: issues.length,
        summary: {
          bySeverity,
          sitemapUrls: sitemap.size,
          autoFixed: pinged,
          closed: toClose.length,
        },
      })
      .where(eq(schema.seoAuditRuns.id, run!.id));
    await ctx.log(
      'audit.done',
      `Технический аудит: страниц ${seen.size}, проблем ${issues.length} (${JSON.stringify(bySeverity)}), закрыто ${toClose.length}, переотправлено в IndexNow ${pinged}`,
    );
    return { pages: seen.size, issues: issues.length };
  };
}

/** After publishing: the page answers 200, canonical is itself, it's in the blog sitemap; IndexNow ping. */
export function postPublishCheckHandler(deps: SeoDeps): TaskHandler {
  return async (ctx) => {
    const { db, origin } = deps;
    const articleId = (ctx.task.payload as { articleId: string }).articleId;
    const [a] = await db
      .select()
      .from(schema.seoArticles)
      .where(eq(schema.seoArticles.id, articleId));
    if (!a) throw new PermanentError('article not found');
    const url = `${origin}/blog/${a.slug}`;
    const page = await fetchPage(deps, url);
    const smRes = await deps.fetch(`${origin}/blog/sitemap.xml`, {
      signal: AbortSignal.timeout(15_000),
    });
    const inSitemap = smRes.ok && sitemapUrls(await smRes.text()).includes(url);
    const problems = pageIssues(page, origin, inSitemap).filter((i) =>
      ['critical', 'high', 'medium'].includes(i.severity),
    );
    if (!inSitemap)
      problems.push({
        code: 'not_in_sitemap',
        url,
        severity: 'high',
        title: 'Нет в sitemap',
        description: '',
        impact: '',
        fix: '',
      });
    let indexNow: string = 'not_configured';
    const inx = await loadIntegration(db, deps.secretsKey, 'indexnow');
    if (page.status === 200 && typeof inx?.config.key === 'string') {
      try {
        indexNow = String(await indexNowPing(deps.fetch, origin, inx.config.key, [url]));
      } catch (err) {
        indexNow = err instanceof Error ? err.message : 'error';
      }
    }
    const check = {
      status: page.status,
      canonical: page.canonical,
      inSitemap,
      ms: page.ms,
      problems: problems.map((p) => p.title),
      indexNow,
    };
    await db
      .update(schema.seoArticles)
      .set({ lastCheckedAt: new Date(), lastCheck: check })
      .where(eq(schema.seoArticles.id, a.id));
    if (page.status !== 200) throw new Error(`published page answers ${page.status}`);
    await ctx.log(
      'article.checked',
      `Проверка после публикации: HTTP ${page.status}, canonical ${page.canonical === url ? 'ок' : page.canonical}, sitemap ${inSitemap ? 'да' : 'нет'}, IndexNow ${indexNow}`,
      { articleId: a.id, level: problems.length ? 'warn' : 'info' },
    );
    return check;
  };
}
