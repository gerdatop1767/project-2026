import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SEO_SETTINGS,
  articleQualityIssues,
  articleSeoScore,
  normalizeSeoSettings,
  percentChange,
  queryOverlap,
  renderMarkdown,
  seoSlug,
  textSimilarity,
  topicPriority,
  usageCostUsd,
  withUtm,
  worstCaseCostUsd,
} from '../index.js';

describe('seoSlug', () => {
  it('transliterates Russian into a clean URL', () => {
    expect(seoSlug('Как решать задание 13 ЕГЭ по профильной математике?')).toBe(
      'kak-reshat-zadanie-13-ege-po-profilnoy-matematike',
    );
    expect(seoSlug('!!!')).toBe('statya');
  });
});

describe('scoring', () => {
  it('topic priority is 0..100 and rewards low competition', () => {
    const base = {
      demand: 8,
      competition: 2,
      seasonality: 5,
      freshness: 5,
      fit: 9,
      conversion: 7,
      rankChance: 6,
    };
    const easy = topicPriority(base);
    const hard = topicPriority({ ...base, competition: 10 });
    expect(easy).toBeGreaterThan(hard);
    expect(
      topicPriority({
        demand: 10,
        competition: 0,
        seasonality: 10,
        freshness: 10,
        fit: 10,
        conversion: 10,
        rankChance: 10,
      }),
    ).toBe(100);
  });

  it('SEO score is null without any data (never a fake 0)', () => {
    expect(
      articleSeoScore({
        impressions: null,
        clicks: null,
        position: null,
        organicVisits: null,
        registrations: null,
      }),
    ).toBeNull();
    const s = articleSeoScore({
      impressions: 1000,
      clicks: 50,
      position: 5,
      organicVisits: 60,
      registrations: 2,
    });
    expect(s).toBeGreaterThan(40);
    expect(s).toBeLessThanOrEqual(100);
  });

  it('percent change is null for zero base', () => {
    expect(percentChange(10, 0)).toBeNull();
    expect(percentChange(15, 10)).toBe(50);
    expect(percentChange(null, 10)).toBeNull();
  });
});

describe('costs', () => {
  it('prices Opus and Haiku per 1M tokens', () => {
    expect(usageCostUsd('claude-opus-5-5', { inputTokens: 1_000_000, outputTokens: 0 })).toBe(4);
    expect(usageCostUsd('claude-haiku-5-5', { inputTokens: 0, outputTokens: 1_000_000 })).toBe(0.5);
    expect(worstCaseCostUsd('claude-opus-5-5', 0, 1_000_000, 10)).toBeCloseTo(20.1);
  });
  it('unknown model is priced as the most expensive one', () => {
    expect(usageCostUsd('mystery', { inputTokens: 1_000_000, outputTokens: 0 })).toBe(10);
  });
});

describe('settings', () => {
  it('falls back to defaults for invalid stored values', () => {
    const s = normalizeSeoSettings({ articlesPerDay: 999, mode: 'auto', junk: 1 });
    expect(s.articlesPerDay).toBe(DEFAULT_SEO_SETTINGS.articlesPerDay);
    expect(s.mode).toBe('auto');
    expect(normalizeSeoSettings(null)).toEqual(DEFAULT_SEO_SETTINGS);
  });
});

describe('text similarity', () => {
  it('detects the same text and separates different ones', () => {
    const a = 'Как подготовиться к ЕГЭ по математике за три месяца: план, задания и ошибки';
    expect(textSimilarity(a, a)).toBe(1);
    expect(textSimilarity(a, 'Мемы про последнюю ночь перед экзаменом по русскому')).toBeLessThan(
      0.1,
    );
    expect(
      queryOverlap('задания егэ по математике', 'задание ЕГЭ математика'),
    ).toBeGreaterThanOrEqual(0.5);
  });
  it('adds UTM tags', () => {
    expect(
      withUtm('https://zybrilka.ru/blog/x?a=1', { source: 'vk', medium: 'social', campaign: 'c' }),
    ).toBe('https://zybrilka.ru/blog/x?a=1&utm_source=vk&utm_medium=social&utm_campaign=c');
  });
});

describe('renderMarkdown', () => {
  it('escapes raw HTML and unsafe links', () => {
    const r = renderMarkdown(
      '<script>alert(1)</script>\n\n[x](javascript:alert(1)) [y](https://fipi.ru/ege)',
    );
    expect(r.html).not.toContain('<script>');
    expect(r.html).toContain('&lt;script&gt;');
    expect(r.html).not.toContain('javascript:');
    expect(r.html).toContain('href="https://fipi.ru/ege"');
  });

  it('builds headings with ids, lists, tables, callouts and images', () => {
    const id = '0f9b8b7a-1111-4222-8333-944455556666';
    const md = [
      '## Что такое ЕГЭ',
      'Текст **жирный** и *курсив*.',
      '',
      '### Детали',
      '- один',
      '- два',
      '',
      '| A | B |',
      '|---|---|',
      '| 1 | 2 |',
      '',
      '> [!tip] Решай каждый день',
      '',
      `![обложка](media:${id})`,
      '![чужая](https://example.com/a.png)',
    ].join('\n');
    const r = renderMarkdown(md, {
      resolveImage: (x) =>
        x === id ? { src: '/blog/media/a.svg', alt: 'Обложка', width: 1200, height: 630 } : null,
    });
    expect(r.headings).toEqual([
      { level: 2, text: 'Что такое ЕГЭ', id: 'chto-takoe-ege' },
      { level: 3, text: 'Детали', id: 'detali' },
    ]);
    expect(r.html).toContain('<strong>жирный</strong>');
    expect(r.html).toContain('<em>курсив</em>');
    expect(r.html).toContain('<ul><li>один</li><li>два</li></ul>');
    expect(r.html).toContain('<td>1</td>');
    expect(r.html).toContain('callout-tip');
    expect(r.html).toContain('src="/blog/media/a.svg"');
    expect(r.html).not.toContain('example.com');
    expect(r.imageIds).toEqual([id]);
  });

  it('marks external links and rewrites internal ones', () => {
    const r = renderMarkdown('[тренажёр](/subjects/math) [фипи](https://fipi.ru)', {
      siteHost: 'zybrilka.ru',
      rewriteLink: (h) => (h.startsWith('/') ? `https://zybrilka.ru/api/v1/go/seo-x?to=${h}` : h),
    });
    expect(r.html).toContain('href="https://zybrilka.ru/api/v1/go/seo-x?to=/subjects/math"');
    expect(r.html).toMatch(/href="https:\/\/fipi.ru\/" rel="noopener"/);
  });
});

describe('article quality gate', () => {
  it('flags thin, unlinked, stuffed articles', () => {
    const issues = articleQualityIssues(
      {
        bodyMd: 'егэ по математике '.repeat(200),
        faq: [],
        seoTitle: 'Короткий заголовок',
        metaDescription: 'Коротко',
        primaryKeyword: 'егэ математика',
      },
      { wordCount: 300, h2Count: 1, internalLinks: 0 },
    );
    expect(issues.length).toBeGreaterThanOrEqual(5);
    expect(issues.some((i) => i.includes('переспам'))).toBe(true);
  });
});
