import { describe, expect, it } from 'vitest';
import { mathMaterialFor } from '../data/theory/mathTheory.js';
import { russianTheory } from '../data/theory/russianTheory.js';
import { libraryItems } from '../data/library/library.js';
import { LEARNING_PAGES, mathTheorySpecs } from './seoPages.js';
import { INDEXABLE_PAGES, seoForPath, sitemapXml, SITE_ORIGIN } from './seo.js';
import { pathForRoute, routeFromPath } from './routes.js';

/** Learning-centre pages in search (docs/seo/SEO-REPORT.md). */
describe('learning-centre SEO pages', () => {
  it('every theory number, material and strategy has its own indexable page', () => {
    const paths = new Set(LEARNING_PAGES.map((p) => p.path));
    for (let n = 1; n <= 27; n++) expect(paths.has(`/theory/russian/${n}`), `ru ${n}`).toBe(true);
    for (let n = 1; n <= 19; n++) expect(paths.has(`/theory/math/${n}`), `math ${n}`).toBe(true);
    for (const item of libraryItems) expect(paths.has(`/${item.section}/${item.id}`)).toBe(true);
    for (const p of ['/learning', '/theory', '/theory/math']) expect(paths.has(p)).toBe(true);
    expect(LEARNING_PAGES).toHaveLength(3 + 27 + 19 + libraryItems.length);
  });

  it('no thin pages: every indexed theory number has real material', () => {
    for (const t of russianTheory)
      expect(t.materials.length, `ru ${t.taskNumber}`).toBeGreaterThan(0);
    for (const spec of mathTheorySpecs) {
      expect(
        spec.topics.some((b) => mathMaterialFor(b.topicKey)),
        `math ${spec.number}`,
      ).toBe(true);
    }
  });

  it('each page: its own canonical, index, breadcrumbs up to the centre, a LearningResource', () => {
    const seo = seoForPath('/theory/russian/9');
    expect(seo.index).toBe(true);
    expect(seo.canonical).toBe(`${SITE_ORIGIN}/theory/russian/9`);
    expect(seo.title).toMatch(/№9 ЕГЭ по русскому языку: Гласные в корне/);
    const [crumbs, resource] = seo.jsonLd as [
      { itemListElement: { name: string }[] },
      { '@type': string; url: string },
    ];
    expect(crumbs.itemListElement.map((i) => i.name)).toEqual([
      'Главная',
      'Учебный центр',
      'Теория по русскому языку',
      '№9. Гласные в корне',
    ]);
    expect(resource['@type']).toBe('LearningResource');
    expect(resource.url).toBe(`${SITE_ORIGIN}/theory/russian/9`);
    expect(seoForPath('/materials/math-derivatives').canonical).toBe(
      `${SITE_ORIGIN}/materials/math-derivatives`,
    );
  });

  it('old query addresses and other editions do not compete with the readable pages', () => {
    // A filter is the same list: canonical is the list.
    expect(seoForPath('/materials?s=math').canonical).toBe(`${SITE_ORIGIN}/materials`);
    // A query that selects a theory page without a readable address stays out of the index.
    for (const path of [
      '/theory?s=math&ed=ege-2027-project&n=6',
      '/theory?s=math&t=math.random-variables',
      '/theory?n=9',
    ]) {
      expect(seoForPath(path).index, path).toBe(false);
      expect(seoForPath(path).canonical, path).toBeNull();
    }
    // …and the app rewrites an old link to the readable one.
    expect(pathForRoute(routeFromPath('/theory?n=9'))).toBe('/theory/russian/9');
    expect(pathForRoute(routeFromPath('/materials?id=math-derivatives'))).toBe(
      '/materials/math-derivatives',
    );
  });

  it('sitemap: every indexable page once, absolute https://zybrilka.ru, no technical URLs', () => {
    const locs = [...sitemapXml().matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]!);
    expect(new Set(locs).size).toBe(locs.length);
    expect(locs).toHaveLength(INDEXABLE_PAGES.length);
    for (const loc of locs) {
      expect(loc.startsWith('https://zybrilka.ru/')).toBe(true);
      expect(loc).not.toMatch(
        /[?#]|\/(admin|api|login|profile|statistics|onboarding|learning\/session)/,
      );
    }
    expect(locs).toContain('https://zybrilka.ru/learning');
    expect(locs).toContain('https://zybrilka.ru/theory/russian/27');
    expect(locs).toContain('https://zybrilka.ru/strategies/strategy-essay');
  });
});
