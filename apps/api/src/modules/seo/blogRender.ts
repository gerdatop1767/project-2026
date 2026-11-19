import {
  escapeHtml,
  renderMarkdown,
  SEO_ARTICLE_FORMAT_LABELS,
  type SeoArticleFormat,
} from '@zybrilka/shared';

/**
 * Server-side HTML for zybrilka.ru/blog (docs/SEO_CENTER.md §7). The page a
 * search engine receives is complete: title, description, canonical, Open
 * Graph, JSON-LD (Article + FAQPage + BreadcrumbList), table of contents,
 * FAQ. CSS and the small consent/Metrika script are same-origin files, so the
 * CSP needs no 'unsafe-inline'.
 */

export const BLOG_METRIKA_COUNTER = 114059780;

export interface BlogMedia {
  id: string;
  fileName: string;
  alt: string;
  width: number;
  height: number;
  description: string | null;
}

export interface BlogArticle {
  slug: string;
  title: string;
  seoTitle: string | null;
  metaDescription: string | null;
  h1: string | null;
  format: string | null;
  subjectId: string | null;
  bodyMd: string;
  faq: { question: string; answer: string }[];
  sources: { title: string; url: string }[];
  ogTitle: string | null;
  ogDescription: string | null;
  ctaPath: string;
  coverMediaId: string | null;
  publishedAt: Date | null;
  updatedAt: Date;
}

export interface BlogPageContext {
  origin: string;
  /** Tracked CTA link (campaign), or null → plain link to ctaPath. */
  ctaHref: string | null;
  media: Map<string, BlogMedia>;
  related: { slug: string; title: string }[];
  metrika: boolean;
}

const SUBJECT_NAMES: Record<string, string> = {
  math: 'математике',
  russian: 'русскому языку',
  english: 'английскому языку',
  social: 'обществознанию',
  informatics: 'информатике',
  physics: 'физике',
  history: 'истории',
  chemistry: 'химии',
  biology: 'биологии',
};

const json = (v: unknown) =>
  // JSON inside <script>: neutralise "</script" and HTML comment openers.
  JSON.stringify(v).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');

export const mediaUrl = (origin: string, fileName: string) => `${origin}/blog/media/${fileName}`;

function head(o: {
  title: string;
  description: string;
  canonical: string;
  ogTitle: string;
  ogDescription: string;
  ogImage: string;
  ogType: string;
  jsonLd: unknown[];
  metrika: boolean;
  published?: string;
  modified?: string;
}) {
  const e = escapeHtml;
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${e(o.title)}</title>
<meta name="description" content="${e(o.description)}">
<meta name="robots" content="index, follow, max-image-preview:large">
<link rel="canonical" href="${e(o.canonical)}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="alternate" type="application/rss+xml" title="Блог Зубрилки" href="/blog/rss.xml">
<meta property="og:type" content="${o.ogType}">
<meta property="og:site_name" content="Зубрилка">
<meta property="og:locale" content="ru_RU">
<meta property="og:title" content="${e(o.ogTitle)}">
<meta property="og:description" content="${e(o.ogDescription)}">
<meta property="og:url" content="${e(o.canonical)}">
<meta property="og:image" content="${e(o.ogImage)}">
<meta name="twitter:card" content="summary_large_image">
${o.published ? `<meta property="article:published_time" content="${o.published}">` : ''}
${o.modified ? `<meta property="article:modified_time" content="${o.modified}">` : ''}
<meta name="theme-color" content="#05070f">
<link rel="stylesheet" href="/blog/assets/blog.css">
${o.jsonLd.map((j) => `<script type="application/ld+json">${json(j)}</script>`).join('\n')}
<script src="/blog/assets/blog.js" defer data-metrika="${BLOG_METRIKA_COUNTER}"${o.metrika ? ' data-consent="1"' : ''}></script>
</head>`;
}

function header() {
  return `<header class="top"><a class="brand" href="/">Зубрилка</a><nav><a href="/blog">Блог</a><a class="wide" href="/subjects">Предметы</a><a class="btn" href="/training">Тренироваться</a></nav></header>`;
}

function footer() {
  return `<footer class="foot"><p>Зубрилка — бесплатный тренажёр ЕГЭ. <a href="/privacy">Конфиденциальность</a> · <a href="/faq">FAQ</a></p>
<div class="consent" hidden><p>Мы используем cookie Яндекс Метрики, чтобы понимать, какие статьи полезны. <a href="/privacy">Подробнее</a></p><button type="button" data-consent="a1">Принять</button><button type="button" data-consent="a0">Отклонить</button></div></footer>`;
}

export function renderArticlePage(a: BlogArticle, ctx: BlogPageContext): string {
  const e = escapeHtml;
  const url = `${ctx.origin}/blog/${a.slug}`;
  const host = new URL(ctx.origin).host;
  const md = renderMarkdown(a.bodyMd, {
    siteHost: host,
    resolveImage: (id) => {
      const m = ctx.media.get(id);
      return m
        ? {
            src: mediaUrl(ctx.origin, m.fileName),
            alt: m.alt,
            width: m.width,
            height: m.height,
            caption: m.description ?? undefined,
          }
        : null;
    },
  });
  const cover = a.coverMediaId ? ctx.media.get(a.coverMediaId) : undefined;
  const coverUrl = cover
    ? mediaUrl(ctx.origin, cover.fileName)
    : `${ctx.origin}/branding/zybrilka-logo.png`;
  const published = a.publishedAt?.toISOString();
  const modified = a.updatedAt.toISOString();
  const title = a.seoTitle || a.title;
  const description = a.metaDescription || a.title;
  const h1 = a.h1 || a.title;
  const subject = a.subjectId ? SUBJECT_NAMES[a.subjectId] : undefined;
  const cta = ctx.ctaHref ?? a.ctaPath;
  const ctaRel = ctx.ctaHref ? ' rel="nofollow"' : '';

  const jsonLd: unknown[] = [
    {
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: h1.slice(0, 110),
      description,
      image: [coverUrl],
      datePublished: published,
      dateModified: modified,
      inLanguage: 'ru',
      mainEntityOfPage: url,
      author: { '@type': 'Organization', name: 'Редакция Зубрилки', url: `${ctx.origin}/` },
      publisher: {
        '@type': 'Organization',
        name: 'Зубрилка',
        url: `${ctx.origin}/`,
        logo: { '@type': 'ImageObject', url: `${ctx.origin}/branding/zybrilka-logo.png` },
      },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Главная', item: `${ctx.origin}/` },
        { '@type': 'ListItem', position: 2, name: 'Блог', item: `${ctx.origin}/blog` },
        { '@type': 'ListItem', position: 3, name: h1, item: url },
      ],
    },
  ];
  if (a.faq.length > 0) {
    jsonLd.push({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: a.faq.map((f) => ({
        '@type': 'Question',
        name: f.question,
        acceptedAnswer: { '@type': 'Answer', text: f.answer },
      })),
    });
  }

  const toc =
    md.headings.length >= 3
      ? `<nav class="toc" aria-label="Содержание"><strong>Содержание</strong><ol>${md.headings
          .filter((h) => h.level === 2)
          .map((h) => `<li><a href="#${h.id}">${e(h.text)}</a></li>`)
          .join('')}${a.faq.length ? '<li><a href="#faq">Частые вопросы</a></li>' : ''}</ol></nav>`
      : '';
  const faq = a.faq.length
    ? `<section class="faq" id="faq"><h2>Частые вопросы</h2>${a.faq
        .map((f) => `<details><summary>${e(f.question)}</summary><p>${e(f.answer)}</p></details>`)
        .join('')}</section>`
    : '';
  const sources = a.sources.length
    ? `<section class="sources"><h2>Источники</h2><ul>${a.sources
        .map(
          (s) => `<li><a href="${e(s.url)}" rel="noopener" target="_blank">${e(s.title)}</a></li>`,
        )
        .join('')}</ul></section>`
    : '';
  const related = ctx.related.length
    ? `<section class="related"><h2>Читайте также</h2><ul>${ctx.related
        .map((r) => `<li><a href="/blog/${e(r.slug)}">${e(r.title)}</a></li>`)
        .join('')}</ul></section>`
    : '';
  const dateText = a.publishedAt
    ? a.publishedAt.toLocaleDateString('ru-RU', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'Europe/Moscow',
      })
    : '';
  const formatLabel = a.format
    ? (SEO_ARTICLE_FORMAT_LABELS[a.format as SeoArticleFormat] ?? '')
    : '';

  return `${head({
    title,
    description,
    canonical: url,
    ogTitle: a.ogTitle || title,
    ogDescription: a.ogDescription || description,
    ogImage: coverUrl,
    ogType: 'article',
    jsonLd,
    metrika: ctx.metrika,
    published,
    modified,
  })}
<body>
${header()}
<main class="article">
<nav class="crumbs" aria-label="Хлебные крошки"><a href="/">Главная</a> › <a href="/blog">Блог</a></nav>
<article>
<p class="meta">${e(formatLabel)}${formatLabel && dateText ? ' · ' : ''}${dateText ? `<time datetime="${published}">${e(dateText)}</time>` : ''}</p>
<h1>${e(h1)}</h1>
${cover ? `<figure class="cover"><img src="${e(coverUrl)}" alt="${e(cover.alt)}" width="${cover.width}" height="${cover.height}" fetchpriority="high"></figure>` : ''}
${toc}
<div class="body">${md.html}</div>
<aside class="cta"><p><strong>Потренируйся на настоящих заданиях${subject ? ` по ${e(subject)}` : ''}.</strong> Бесплатно, с мгновенной проверкой и разбором ошибок.</p><a class="btn" href="${e(cta)}"${ctaRel}>Решать задания в Зубрилке</a></aside>
${faq}
${sources}
</article>
${related}
</main>
${footer()}
</body>
</html>`;
}

export function renderBlogIndex(
  items: {
    slug: string;
    title: string;
    description: string | null;
    publishedAt: Date | null;
    cover: string | null;
  }[],
  ctx: { origin: string; metrika: boolean; page: number; pages: number },
): string {
  const e = escapeHtml;
  const canonical = `${ctx.origin}/blog${ctx.page > 1 ? `?page=${ctx.page}` : ''}`;
  const list = items.length
    ? `<ul class="cards">${items
        .map(
          (i) =>
            `<li><a href="/blog/${e(i.slug)}">${i.cover ? `<img src="${e(i.cover)}" alt="" width="600" height="315" loading="lazy">` : ''}<h2>${e(i.title)}</h2>${i.description ? `<p>${e(i.description)}</p>` : ''}</a></li>`,
        )
        .join('')}</ul>`
    : '<p class="empty">Скоро здесь появятся статьи о подготовке к ЕГЭ.</p>';
  const pager =
    ctx.pages > 1
      ? `<nav class="pager">${ctx.page > 1 ? `<a href="/blog${ctx.page > 2 ? `?page=${ctx.page - 1}` : ''}" rel="prev">← Новее</a>` : ''}${ctx.page < ctx.pages ? `<a href="/blog?page=${ctx.page + 1}" rel="next">Старее →</a>` : ''}</nav>`
      : '';
  return `${head({
    title: 'Блог Зубрилки — подготовка к ЕГЭ: разборы, советы, изменения',
    description:
      'Статьи о подготовке к ЕГЭ: разборы заданий, критерии оценивания, изменения экзамена, планы подготовки и типичные ошибки. Бесплатно от Зубрилки.',
    canonical,
    ogTitle: 'Блог Зубрилки',
    ogDescription: 'Разборы заданий ЕГЭ, советы и изменения экзамена.',
    ogImage: `${ctx.origin}/branding/zybrilka-logo.png`,
    ogType: 'website',
    jsonLd: [
      {
        '@context': 'https://schema.org',
        '@type': 'Blog',
        name: 'Блог Зубрилки',
        url: `${ctx.origin}/blog`,
        inLanguage: 'ru',
      },
    ],
    metrika: ctx.metrika,
  })}
<body>
${header()}
<main class="index"><h1>Блог Зубрилки</h1><p class="lead">Разборы заданий, советы и всё, что меняется в ЕГЭ.</p>${list}${pager}</main>
${footer()}
</body>
</html>`;
}

export function renderNotFound(origin: string): string {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Статья не найдена — Зубрилка</title><meta name="robots" content="noindex"><link rel="stylesheet" href="/blog/assets/blog.css"></head><body>${header()}<main class="index"><h1>Статья не найдена</h1><p>Возможно, её адрес изменился. <a href="${escapeHtml(origin)}/blog">Все статьи</a></p></main></body></html>`;
}

export function renderSitemap(origin: string, rows: { slug: string; updatedAt: Date }[]): string {
  const urls = [
    `<url><loc>${origin}/blog</loc></url>`,
    ...rows.map(
      (r) =>
        `<url><loc>${escapeHtml(`${origin}/blog/${r.slug}`)}</loc><lastmod>${r.updatedAt.toISOString()}</lastmod></url>`,
    ),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}

export function renderRss(
  origin: string,
  rows: { slug: string; title: string; description: string | null; publishedAt: Date | null }[],
): string {
  const e = escapeHtml;
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Блог Зубрилки</title><link>${origin}/blog</link><description>Подготовка к ЕГЭ: разборы, советы, изменения</description><language>ru</language>
${rows
  .map(
    (r) =>
      `<item><title>${e(r.title)}</title><link>${origin}/blog/${e(r.slug)}</link><guid>${origin}/blog/${e(r.slug)}</guid>${r.publishedAt ? `<pubDate>${r.publishedAt.toUTCString()}</pubDate>` : ''}${r.description ? `<description>${e(r.description)}</description>` : ''}</item>`,
  )
  .join('\n')}
</channel></rss>
`;
}

export const BLOG_CSS = `:root{--bg:#f4f3fb;--surface:#fff;--text:#14182b;--muted:#5b6478;--accent:#2b8ff0;--border:#e2e4f0;--tip:#e8f4ff;--warn:#fff4e0}
@media (prefers-color-scheme:dark){:root{--bg:#05070f;--surface:#0d1226;--text:#f5f7fa;--muted:#9aa6bf;--accent:#5ab8fd;--border:#23284a;--tip:#10213b;--warn:#2b2110}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:17px/1.65 Inter,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-text-size-adjust:100%}
a{color:var(--accent)}img{max-width:100%;height:auto;border-radius:12px}
.top{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px;max-width:1080px;margin:0 auto}
.top nav{display:flex;gap:14px;align-items:center}@media (max-width:480px){.top .wide{display:none}.top .btn{padding:8px 12px}}.top a{text-decoration:none;color:var(--text)}.brand{font-weight:800;font-size:20px}
.btn{display:inline-block;background:var(--accent);color:#04162c!important;padding:10px 16px;border-radius:12px;font-weight:700;text-decoration:none}
main{max-width:760px;margin:0 auto;padding:8px 16px 48px}.index{max-width:1080px}
h1{font-size:clamp(28px,5vw,40px);line-height:1.2;margin:8px 0 16px}h2{font-size:26px;line-height:1.3;margin:36px 0 12px}h3{font-size:21px;margin:28px 0 8px}
.crumbs,.meta{color:var(--muted);font-size:14px}.crumbs a{color:var(--muted)}
.cover{margin:0 0 20px}figure{margin:20px 0}figcaption{color:var(--muted);font-size:14px;margin-top:6px}
.toc{background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:16px 20px;margin:20px 0}.toc ol{margin:8px 0 0;padding-left:20px}
.table{overflow-x:auto;margin:16px 0}table{border-collapse:collapse;width:100%;background:var(--surface);border-radius:12px;overflow:hidden}th,td{border:1px solid var(--border);padding:8px 12px;text-align:left;vertical-align:top}th{background:var(--tip)}
blockquote{margin:16px 0;padding:8px 16px;border-left:4px solid var(--accent);color:var(--muted)}
.callout{background:var(--tip);border-radius:14px;padding:14px 18px;margin:20px 0}.callout p{margin:6px 0 0}.callout-warning,.callout-mistake{background:var(--warn)}
code{background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:1px 6px}
.cta{background:var(--surface);border:1px solid var(--border);border-radius:18px;padding:20px;margin:32px 0}
details{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:12px 16px;margin:8px 0}summary{cursor:pointer;font-weight:600}
.cards{list-style:none;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px}.cards a{display:block;background:var(--surface);border:1px solid var(--border);border-radius:18px;padding:16px;color:var(--text);text-decoration:none;height:100%}.cards h2{font-size:19px;margin:12px 0 6px}.cards p{color:var(--muted);margin:0;font-size:15px}
.pager{display:flex;justify-content:space-between;margin-top:24px}.lead{color:var(--muted)}
.foot{max-width:1080px;margin:0 auto;padding:24px 16px;color:var(--muted);font-size:14px}
.consent{position:fixed;left:12px;right:12px;bottom:12px;background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:12px 16px;display:flex;flex-wrap:wrap;gap:8px;align-items:center;max-width:720px;margin:0 auto;box-shadow:0 8px 30px rgba(0,0,0,.15)}.consent[hidden]{display:none}.consent p{margin:0;flex:1 1 260px}.consent button{border:0;border-radius:10px;padding:8px 14px;font:inherit;cursor:pointer;background:var(--border);color:var(--text)}.consent button[data-consent=a1]{background:var(--accent);color:#04162c}
`;

/** Consent bar + Yandex Metrika, same rules as the app (docs/COOKIES.md): no counter without `zc=a1`. */
export const BLOG_JS = `(function(){var s=document.currentScript;var id=+s.getAttribute('data-metrika');
function consent(){try{if(/(?:^|;\\s*)zc=a1(?:;|$)/.test(document.cookie)||localStorage.getItem('zybrilka-cookie-consent')==='a1')return 'a1'}catch(e){}if(/(?:^|;\\s*)zc=a0(?:;|$)/.test(document.cookie))return 'a0';return null}
function start(){if(window.__zm)return;window.__zm=1;(function(m,e,t,r,i,k,a){m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};m[i].l=1*new Date();k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)})(window,document,'script','https://mc.yandex.ru/metrika/tag.js?id='+id,'ym');ym(id,'init',{ssr:true,clickmap:true,accurateTrackBounce:true,trackLinks:true,referrer:document.referrer,url:location.href})}
document.addEventListener('DOMContentLoaded',function(){var c=consent();if(c==='a1'){start();return}if(c)return;var bar=document.querySelector('.consent');if(!bar)return;bar.hidden=false;bar.addEventListener('click',function(ev){var v=ev.target&&ev.target.getAttribute('data-consent');if(!v)return;document.cookie='zc='+v+'; Path=/; Max-Age=31536000; SameSite=Lax; Secure';try{localStorage.setItem('zybrilka-cookie-consent',v)}catch(e){}bar.hidden=true;if(v==='a1')start()})})})();`;
