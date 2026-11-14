/**
 * Search-engine metadata (docs/seo/SEO-REPORT.md). One registry is the
 * single source for:
 * - the <head> the client sets on every navigation (`applySeo`);
 * - the static HTML the build writes for each indexable page (vite.config.ts →
 *   `seoPrerender`), so a crawler that does not run JS gets the same title,
 *   description, canonical and structured data;
 * - sitemap.xml (built from `INDEXABLE_PAGES`);
 * - the nginx list of known app routes (apps/web/nginx.conf, checked by a test).
 *
 * Only metadata lives here: visible page texts are not changed for SEO.
 * A page is indexable only when a guest sees real content on it. Personal
 * screens (statistics, profile…), sign-in, work-in-progress placeholders and
 * subjects without tasks are `noindex, follow`.
 */
export const SITE_ORIGIN = 'https://zybrilka.ru';
export const SITE_NAME = 'Zybrilka';
export const DEFAULT_TITLE = 'Zybrilka — бесплатный тренажёр ЕГЭ';
export const DEFAULT_DESCRIPTION =
  'Zybrilka (Зубрилка) — бесплатный онлайн-тренажёр ЕГЭ по профильной математике и русскому языку: задания из типовых вариантов, мгновенная проверка, пошаговые разборы и статистика.';
export const OG_IMAGE = `${SITE_ORIGIN}/branding/zybrilka-logo.png`;

export interface PageSeo {
  /** Canonical path: no query, no trailing slash. */
  path: string;
  title: string;
  description: string;
  /** Visible name of the page, for breadcrumbs. */
  name: string;
  /** Breadcrumb parent path ('/' when omitted, none for '/'). */
  parent?: string;
}

/** Pages a guest can open and that carry real content — the sitemap. */
export const INDEXABLE_PAGES: readonly PageSeo[] = [
  { path: '/', title: DEFAULT_TITLE, description: DEFAULT_DESCRIPTION, name: 'Главная' },
  {
    path: '/training',
    title: 'Тренировка: задания ЕГЭ по темам, номерам и вариантам — Zybrilka',
    description:
      'Выберите предмет и режим: задания ЕГЭ по темам, по номерам и полные варианты. Ответ проверяется сразу, к заданиям есть разборы.',
    name: 'Тренировка',
  },
  {
    path: '/subjects',
    title: 'Предметы ЕГЭ — Zybrilka',
    description:
      'Предметы для подготовки к ЕГЭ в Zybrilka: профильная математика и русский язык — задания из типовых вариантов с проверкой и разборами.',
    name: 'Предметы',
  },
  {
    path: '/subjects/math',
    title: 'Профильная математика ЕГЭ: задания с проверкой и разборами — Zybrilka',
    description:
      'Задания ЕГЭ по профильной математике из типовых вариантов: по темам, по номерам 1–19 и полными вариантами. Мгновенная проверка ответа и пошаговые разборы.',
    name: 'Математика',
    parent: '/subjects',
  },
  {
    path: '/subjects/russian',
    title: 'Русский язык ЕГЭ: задания с проверкой и разборами — Zybrilka',
    description:
      'Задания ЕГЭ по русскому языку из типовых вариантов: по темам, по номерам и полными вариантами. Мгновенная проверка ответа и разборы.',
    name: 'Русский язык',
    parent: '/subjects',
  },
  {
    path: '/theory',
    title: 'Теория и правила к заданиям ЕГЭ — Zybrilka',
    description: 'Правила и теория к заданиям ЕГЭ, сгруппированные по номерам заданий.',
    name: 'Теория',
  },
  {
    path: '/materials',
    title: 'Полезные материалы для подготовки к ЕГЭ — Zybrilka',
    description:
      'Таблицы формул, справочники и шпаргалки к ЕГЭ по профильной математике и русскому языку: производные, тригонометрия, геометрия, вероятность, орфография, пунктуация.',
    name: 'Полезные материалы',
  },
  {
    path: '/strategies',
    title: 'Стратегии подготовки к ЕГЭ — Zybrilka',
    description:
      'Как распределить время на ЕГЭ по математике и русскому языку, в каком порядке решать задания, как оформлять вторую часть, писать сочинение и проверять ответы.',
    name: 'Стратегии',
  },
  {
    path: '/games',
    title: 'Мини-игры для подготовки к ЕГЭ — Zybrilka',
    description: 'Короткие игры-тренажёры для подготовки к ЕГЭ.',
    name: 'Мини-игры',
  },
  {
    path: '/games/stress',
    title: 'Ударения: тренажёр по орфоэпическому словарику ФИПИ — Zybrilka',
    description:
      'Игра-тренажёр ударений по орфоэпическому словарику ФИПИ — к заданию 4 ЕГЭ по русскому языку.',
    name: 'Ударения',
    parent: '/games',
  },
  {
    path: '/help',
    title: 'Помощь — Zybrilka',
    description: 'Как связаться с поддержкой Zybrilka.',
    name: 'Помощь',
  },
  {
    path: '/faq',
    title: 'Вопросы и ответы — Zybrilka',
    description: 'Ответы на частые вопросы о тренажёре ЕГЭ Zybrilka.',
    name: 'Вопросы и ответы',
  },
  {
    path: '/privacy',
    title: 'Политика конфиденциальности — Zybrilka',
    description: 'Какие данные обрабатывает Zybrilka, зачем, сколько хранит и как их удалить.',
    name: 'Политика конфиденциальности',
  },
  {
    path: '/terms',
    title: 'Пользовательское соглашение — Zybrilka',
    description: 'Условия использования тренажёра ЕГЭ Zybrilka.',
    name: 'Пользовательское соглашение',
  },
];

const byPath = new Map(INDEXABLE_PAGES.map((p) => [p.path, p]));

/** Titles for app screens that exist but stay out of the index. */
const NOINDEX_TITLES: ReadonlyArray<[RegExp, string]> = [
  [/^\/login$/, 'Вход'],
  [/^\/statistics(\/|$)/, 'Статистика'],
  [/^\/achievements$/, 'Достижения'],
  [/^\/training\/mistakes$/, 'Мои ошибки'],
  [/^\/favorites$/, 'Избранное'],
  [/^\/level$/, 'Уровень'],
  [/^\/rating$/, 'Рейтинг'],
  [/^\/profile$/, 'Профиль'],
  [/^\/settings$/, 'Настройки'],
  [/^\/notifications$/, 'Уведомления'],
  [/^\/friends(\/|$)/, 'Друзья'],
  [/^\/learning(\/|$)/, 'Учебный центр'],
  [/^\/onboarding$/, 'Знакомство'],
];

/**
 * Every path the app answers (nginx serves the app for these with 200; any
 * other path is a real 404). Keep in sync with lib/routes.ts — a test
 * checks both directions, and that nginx.conf carries this exact pattern.
 */
export const APP_ROUTE_PATTERN =
  '^/(training(/(topic|random|variants|mistakes|by-number))?|statistics(/variants/[0-9a-f-]+)?|achievements|subjects(/[a-z-]+)?|profile|theory|materials|strategies|learning(/session/[A-Za-z0-9_-]+)?|friends(/[A-Za-z0-9_-]+)?|login|rating|level|favorites|mock-exams|topics|settings|help|faq|privacy|terms|notifications|games(/stress)?|onboarding|landing|telegram-return|admin(/[A-Za-z0-9/_-]*)?)$';

const appRoute = new RegExp(APP_ROUTE_PATTERN);

export function cleanPath(pathname: string): string {
  const path = (pathname.split(/[?#]/)[0] ?? '/').replace(/\/+$/, '');
  return path === '' ? '/' : path;
}

export interface ResolvedSeo {
  title: string;
  description: string;
  index: boolean;
  /** Absolute canonical URL — only for indexable pages. */
  canonical: string | null;
  jsonLd: object[];
}

/** Metadata for a pathname (query ignored: it never makes a different page). */
export function seoForPath(pathname: string): ResolvedSeo {
  const path = cleanPath(pathname);
  const page = byPath.get(path);
  if (page) {
    return {
      title: page.title,
      description: page.description,
      index: true,
      canonical: SITE_ORIGIN + (page.path === '/' ? '/' : page.path),
      jsonLd: jsonLdFor(page),
    };
  }
  const known = path === '/' || appRoute.test(path);
  const name = NOINDEX_TITLES.find(([re]) => re.test(path))?.[1];
  return {
    title: known
      ? name
        ? `${name} — ${SITE_NAME}`
        : DEFAULT_TITLE
      : `Страница не найдена — ${SITE_NAME}`,
    description: DEFAULT_DESCRIPTION,
    index: false,
    canonical: null,
    jsonLd: [],
  };
}

function breadcrumbs(page: PageSeo): PageSeo[] {
  const chain: PageSeo[] = [page];
  let parent = page.path === '/' ? undefined : (page.parent ?? '/');
  while (parent) {
    const p = byPath.get(parent);
    if (!p) break;
    chain.unshift(p);
    parent = p.path === '/' ? undefined : (p.parent ?? '/');
  }
  return chain;
}

function abs(path: string): string {
  return SITE_ORIGIN + (path === '/' ? '/' : path);
}

export function jsonLdFor(page: PageSeo): object[] {
  if (page.path === '/') {
    return [
      {
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        name: SITE_NAME,
        alternateName: 'Зубрилка',
        url: abs('/'),
        inLanguage: 'ru',
        description: DEFAULT_DESCRIPTION,
      },
      {
        '@context': 'https://schema.org',
        '@type': 'Organization',
        name: SITE_NAME,
        url: abs('/'),
        logo: OG_IMAGE,
      },
    ];
  }
  return [
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: breadcrumbs(page).map((p, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: p.name,
        item: abs(p.path),
      })),
    },
  ];
}

function setMeta(attr: 'name' | 'property', key: string, content: string): void {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

/** Bring <head> in line with the current URL (called on every navigation). */
export function applySeo(pathname: string): void {
  if (typeof document === 'undefined') return;
  const seo = seoForPath(pathname);
  document.title = seo.title;
  setMeta('name', 'description', seo.description);
  setMeta('name', 'robots', seo.index ? 'index, follow' : 'noindex, follow');
  setMeta('property', 'og:title', seo.title);
  setMeta('property', 'og:description', seo.description);
  setMeta('property', 'og:url', seo.canonical ?? abs(cleanPath(pathname)));

  let link = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (seo.canonical) {
    if (!link) {
      link = document.createElement('link');
      link.rel = 'canonical';
      document.head.appendChild(link);
    }
    link.href = seo.canonical;
  } else {
    link?.remove();
  }

  let ld = document.head.querySelector<HTMLScriptElement>('script#seo-jsonld');
  if (seo.jsonLd.length > 0) {
    if (!ld) {
      ld = document.createElement('script');
      ld.type = 'application/ld+json';
      ld.id = 'seo-jsonld';
      document.head.appendChild(ld);
    }
    ld.textContent = JSON.stringify(seo.jsonLd.length === 1 ? seo.jsonLd[0] : seo.jsonLd);
  } else {
    ld?.remove();
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Build time: the <head> tags for one indexable page, replacing the
 * `<!-- seo:start -->…<!-- seo:end -->` block of index.html.
 */
export function headTagsFor(page: PageSeo | null): string {
  if (!page) {
    // The shell served for non-indexable app routes and for 404s.
    return [
      `<title>${escapeHtml(DEFAULT_TITLE)}</title>`,
      `<meta name="description" content="${escapeHtml(DEFAULT_DESCRIPTION)}" />`,
      '<meta name="robots" content="noindex, follow" />',
    ].join('\n    ');
  }
  const url = abs(page.path);
  const ld = jsonLdFor(page);
  return [
    `<title>${escapeHtml(page.title)}</title>`,
    `<meta name="description" content="${escapeHtml(page.description)}" />`,
    '<meta name="robots" content="index, follow" />',
    `<link rel="canonical" href="${url}" />`,
    `<meta property="og:title" content="${escapeHtml(page.title)}" />`,
    `<meta property="og:description" content="${escapeHtml(page.description)}" />`,
    `<meta property="og:url" content="${url}" />`,
    `<script type="application/ld+json" id="seo-jsonld">${JSON.stringify(ld.length === 1 ? ld[0] : ld).replace(/</g, '\\u003c')}</script>`,
  ].join('\n    ');
}

/** No <lastmod>: the build date is not when a page changed, and a false one is worse than none. */
export function sitemapXml(): string {
  const urls = INDEXABLE_PAGES.map((p) => `  <url>\n    <loc>${abs(p.path)}</loc>\n  </url>`).join(
    '\n',
  );
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}
