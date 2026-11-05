import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  APP_ROUTE_PATTERN,
  applySeo,
  headTagsFor,
  INDEXABLE_PAGES,
  seoForPath,
  SITE_ORIGIN,
  sitemapXml,
} from './seo.js';
import { pathForRoute, routeFromPath } from './routes.js';
import type { Route } from './navigation.js';
import { withHead } from '../../seo/prerender.js';
import { defaultBottomNavItems } from '../ui/BottomNav/defaultItems.js';

const WEB = resolve(__dirname, '../..');
const appRoute = new RegExp(APP_ROUTE_PATTERN);

/** Every addressable route of the app, one sample each. */
const sampleRoutes: Route[] = [
  { screen: 'home' },
  { screen: 'training' },
  { screen: 'statistics' },
  { screen: 'achievements' },
  { screen: 'profile' },
  { screen: 'subject', subjectId: 'math', from: 'subjectCatalog' },
  { screen: 'subject', subjectId: 'social', from: 'subjectCatalog' },
  { screen: 'theory', section: 'rules' },
  { screen: 'theory', section: 'materials', taskNumber: 4 },
  { screen: 'learningSession', sessionId: 'abc_DEF-1' },
  { screen: 'variantAttempt', sessionId: '0b5d6a7e-1111-2222-3333-444455556666' },
  { screen: 'friendProfile', friendId: 'u_1' },
  ...(
    [
      'login',
      'learningCenter',
      'subjectCatalog',
      'mistakes',
      'trainingTopic',
      'trainingRandom',
      'trainingVariants',
      'rating',
      'level',
      'favorites',
      'mockExams',
      'topics',
      'friends',
      'settings',
      'help',
      'faq',
      'privacy',
      'terms',
      'notifications',
      'miniGames',
      'stressGame',
      'onboarding',
      'landing',
      'telegramReturn',
    ] as const
  ).map((screen) => ({ screen }) as Route),
];

afterEach(() => {
  document.head
    .querySelectorAll('link[rel=canonical], meta[name=robots], #seo-jsonld')
    .forEach((n) => n.remove());
});

describe('SEO registry', () => {
  it('every app route is known to nginx (200), and its path parses back to the same screen', () => {
    for (const route of sampleRoutes) {
      const path = pathForRoute(route)!.split('?')[0]!;
      if (path !== '/') expect(appRoute.test(path), path).toBe(true);
      expect(routeFromPath(path).screen, path).toBe(route.screen);
    }
  });

  it('paths the app does not have are not routes (nginx answers 404)', () => {
    for (const path of [
      '/nonexistent',
      '/subjects/math/extra',
      '/app',
      '/index',
      '/statistics/x',
      '/Training',
    ]) {
      expect(appRoute.test(path), path).toBe(false);
      expect(seoForPath(path).index).toBe(false);
    }
  });

  it('nginx.conf carries the same route pattern', () => {
    const conf = readFileSync(resolve(WEB, 'nginx.conf'), 'utf8');
    expect(conf).toContain(`"~${APP_ROUTE_PATTERN}" /app.html;`);
  });

  it('indexable pages are real routes with unique titles and descriptions', () => {
    const titles = new Set(INDEXABLE_PAGES.map((p) => p.title));
    const descriptions = new Set(INDEXABLE_PAGES.map((p) => p.description));
    expect(titles.size).toBe(INDEXABLE_PAGES.length);
    expect(descriptions.size).toBe(INDEXABLE_PAGES.length);
    for (const page of INDEXABLE_PAGES) {
      if (page.path !== '/') expect(appRoute.test(page.path), page.path).toBe(true);
      expect(page.title.length).toBeLessThanOrEqual(80);
      expect(page.description.length).toBeGreaterThan(30);
      expect(page.description.length).toBeLessThanOrEqual(200);
    }
  });

  it('private, technical and placeholder screens are noindex with no canonical', () => {
    for (const path of [
      '/login',
      '/profile',
      '/statistics',
      '/achievements',
      '/training/mistakes',
      '/favorites',
      '/level',
      '/settings',
      '/notifications',
      '/onboarding',
      '/telegram-return',
      '/landing',
      '/learning',
      '/learning/session/x',
      '/statistics/variants/0b5d6a7e-1111-2222-3333-444455556666',
      '/rating',
      '/friends',
      '/mock-exams',
      '/topics',
      '/training/topic',
      '/subjects/english',
      '/admin',
    ]) {
      const seo = seoForPath(path);
      expect(seo.index, path).toBe(false);
      expect(seo.canonical, path).toBeNull();
    }
  });

  it('query and trailing slash do not make another page: canonical is the bare path', () => {
    expect(seoForPath('/subjects/math?mode=byNumber&n=3').canonical).toBe(
      `${SITE_ORIGIN}/subjects/math`,
    );
    expect(seoForPath('/theory/').canonical).toBe(`${SITE_ORIGIN}/theory`);
    expect(seoForPath('/').canonical).toBe(`${SITE_ORIGIN}/`);
  });

  it('breadcrumbs follow the page hierarchy; home carries WebSite + Organization', () => {
    const math = seoForPath('/subjects/math').jsonLd[0] as {
      itemListElement: { name: string; item: string }[];
    };
    expect(math.itemListElement.map((i) => i.name)).toEqual(['Главная', 'Предметы', 'Математика']);
    expect(math.itemListElement[2]!.item).toBe(`${SITE_ORIGIN}/subjects/math`);
    expect(seoForPath('/').jsonLd.map((x) => (x as { '@type': string })['@type'])).toEqual([
      'WebSite',
      'Organization',
    ]);
  });

  it('sitemap lists exactly the indexable pages, absolute, without invented lastmod', () => {
    const xml = sitemapXml();
    expect(xml.match(/<loc>/g)).toHaveLength(INDEXABLE_PAGES.length);
    expect(xml).toContain(`<loc>${SITE_ORIGIN}/subjects/russian</loc>`);
    expect(xml).not.toContain('lastmod');
    expect(xml).not.toContain('/login');
  });
});

describe('<head> on navigation', () => {
  it('sets title, description, robots, canonical, og and JSON-LD; removes canonical on noindex pages', () => {
    applySeo('/subjects/russian');
    expect(document.title).toMatch(/Русский язык ЕГЭ/);
    expect(document.head.querySelector('link[rel=canonical]')?.getAttribute('href')).toBe(
      `${SITE_ORIGIN}/subjects/russian`,
    );
    expect(document.head.querySelector('meta[name=robots]')?.getAttribute('content')).toBe(
      'index, follow',
    );
    expect(document.head.querySelector('meta[property="og:url"]')?.getAttribute('content')).toBe(
      `${SITE_ORIGIN}/subjects/russian`,
    );
    expect(document.getElementById('seo-jsonld')?.textContent).toContain('BreadcrumbList');

    applySeo('/profile');
    expect(document.title).toBe('Профиль — Zybrilka');
    expect(document.head.querySelector('meta[name=robots]')?.getAttribute('content')).toBe(
      'noindex, follow',
    );
    expect(document.head.querySelector('link[rel=canonical]')).toBeNull();
    expect(document.getElementById('seo-jsonld')).toBeNull();
  });
});

describe('build: prerendered <head>', () => {
  const html = readFileSync(resolve(WEB, 'index.html'), 'utf8');

  it('index.html has the marked block, and its static tags match the home page', () => {
    expect(html).toContain('<!-- seo:start -->');
    expect(html).toContain('<!-- seo:end -->');
    expect(html).toContain('<title>Zybrilka — бесплатный тренажёр ЕГЭ</title>');
    expect(html.match(/<title>/g)).toHaveLength(1);
  });

  it('each page gets its own head; the app shell is noindex', () => {
    const math = withHead(
      html,
      headTagsFor(INDEXABLE_PAGES.find((p) => p.path === '/subjects/math')!),
    );
    expect(math.match(/<title>/g)).toHaveLength(1);
    expect(math).toContain(`<link rel="canonical" href="${SITE_ORIGIN}/subjects/math" />`);
    expect(math).toContain('<meta name="robots" content="index, follow" />');
    // The rest of the document — the app, the Metrika counter — is untouched.
    expect(math).toContain('<div id="root"></div>');
    expect(math).toContain("ym(114059780, 'init'");

    const shell = withHead(html, headTagsFor(null));
    expect(shell).toContain('<meta name="robots" content="noindex, follow" />');
    expect(shell).not.toContain('rel="canonical"');
  });

  it('JSON-LD cannot close its <script> early', () => {
    const tags = headTagsFor({ path: '/x', title: 't', description: 'd', name: '</script><b>' });
    expect(tags).not.toContain('</script><b>');
  });
});

describe('robots.txt', () => {
  const robots = readFileSync(resolve(WEB, 'public/robots.txt'), 'utf8');

  it('points to the sitemap and closes only technical paths', () => {
    expect(robots).toContain(`Sitemap: ${SITE_ORIGIN}/sitemap.xml`);
    const disallowed = [...robots.matchAll(/^Disallow: (\S+)/gm)].map((m) => m[1]!);
    for (const page of INDEXABLE_PAGES) {
      for (const d of disallowed)
        expect(page.path.startsWith(d), `${page.path} vs ${d}`).toBe(false);
    }
    expect(disallowed).toContain('/admin');
    expect(disallowed).toContain('/api/');
  });
});

describe('navigation is made of real links', () => {
  it('bottom nav items point at their real addresses', () => {
    for (const item of defaultBottomNavItems) {
      const screen = item.id === 'mistakes' ? 'mistakes' : item.id;
      expect(item.href).toBe(pathForRoute({ screen } as Route));
    }
  });
});
