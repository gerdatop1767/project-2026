import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Plugin } from 'vite';
import { headTagsFor, INDEXABLE_PAGES, sitemapXml } from '../src/lib/seo.js';

const START = '<!-- seo:start -->';
const END = '<!-- seo:end -->';

/** Replace the marked SEO block of the built index.html. */
export function withHead(html: string, tags: string): string {
  const a = html.indexOf(START);
  const b = html.indexOf(END);
  if (a < 0 || b < a) throw new Error('index.html: seo:start/seo:end markers are missing');
  return `${html.slice(0, a + START.length)}\n    ${tags}\n    ${html.slice(b)}`;
}

/**
 * After the build: one static HTML per indexable page (dist/<path>.html,
 * served by nginx as `$uri.html`), the shell for every other app route
 * (dist/app.html, noindex), and sitemap.xml. The app itself is the same
 * bundle — only <head> differs. See docs/seo/SEO-REPORT.md.
 */
export function seoPrerender(): Plugin {
  let outDir = 'dist';
  return {
    name: 'zybrilka-seo-prerender',
    apply: 'build',
    configResolved(config) {
      outDir = join(config.root, config.build.outDir);
    },
    closeBundle() {
      const shell = readFileSync(join(outDir, 'index.html'), 'utf8');
      for (const page of INDEXABLE_PAGES) {
        const file = page.path === '/' ? 'index.html' : `${page.path.slice(1)}.html`;
        const target = join(outDir, file);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, withHead(shell, headTagsFor(page)));
      }
      writeFileSync(join(outDir, 'app.html'), withHead(shell, headTagsFor(null)));
      writeFileSync(join(outDir, 'sitemap.xml'), sitemapXml());
    },
  };
}
