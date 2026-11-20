import { z } from 'zod';
import { SEO_ARTICLE_FORMATS } from './constants.js';
import { SEO_SLUG_RE } from './text.js';
import { isAllowedCampaignTarget } from '../campaignTargets.js';

export const seoFaqItemSchema = z.object({
  question: z.string().trim().min(5).max(300),
  answer: z.string().trim().min(10).max(2000),
});
export type SeoFaqItem = z.infer<typeof seoFaqItemSchema>;

export const seoSourceSchema = z.object({
  title: z.string().trim().min(2).max(300),
  url: z.url().max(1000),
});
export type SeoSource = z.infer<typeof seoSourceSchema>;

/**
 * Editable article fields — what the content agent produces and what the
 * owner edits in the admin. Body is the safe Markdown subset (markdown.ts).
 */
export const seoArticleContentSchema = z.object({
  title: z.string().trim().min(5).max(200),
  seoTitle: z.string().trim().min(10).max(80),
  metaDescription: z.string().trim().min(50).max(200),
  h1: z.string().trim().min(5).max(200),
  slug: z.string().regex(SEO_SLUG_RE).max(90),
  format: z.enum(SEO_ARTICLE_FORMATS),
  subjectId: z
    .string()
    .regex(/^[a-z_]{1,32}$/)
    .nullable(),
  bodyMd: z.string().min(200).max(120_000),
  faq: z.array(seoFaqItemSchema).max(20),
  sources: z.array(seoSourceSchema).max(30),
  ogTitle: z.string().trim().min(5).max(120),
  ogDescription: z.string().trim().min(20).max(250),
  primaryKeyword: z.string().trim().min(2).max(200),
  secondaryKeywords: z.array(z.string().trim().min(2).max(200)).max(30),
  /** Where the article sends readers in the app (internal path, e.g. /subjects/math). */
  ctaPath: z.string().max(120).refine(isAllowedCampaignTarget, 'not an allowed trainer section'),
});
export type SeoArticleContent = z.infer<typeof seoArticleContentSchema>;

export const seoArticlePatchSchema = seoArticleContentSchema.partial().strict();

/** Structural quality gate run before an article can be reviewed or published. */
export function articleQualityIssues(
  a: Pick<SeoArticleContent, 'bodyMd' | 'faq' | 'seoTitle' | 'metaDescription' | 'primaryKeyword'>,
  stats: { wordCount: number; h2Count: number; internalLinks: number },
): string[] {
  const issues: string[] = [];
  if (stats.wordCount < 600)
    issues.push(`Слишком короткий текст: ${stats.wordCount} слов (нужно от 600).`);
  if (stats.h2Count < 3) issues.push('Нужно минимум три подзаголовка H2.');
  if (stats.internalLinks < 2) issues.push('Нужно минимум две внутренние ссылки на Зубрилку.');
  if (a.faq.length < 3) issues.push('В FAQ нужно минимум три вопроса.');
  if (a.seoTitle.length > 70) issues.push('SEO Title длиннее 70 символов — обрежется в выдаче.');
  if (a.metaDescription.length < 110) issues.push('Meta Description короче 110 символов.');
  const kw = a.primaryKeyword.toLowerCase().split(/\s+/)[0] ?? '';
  if (kw && !a.seoTitle.toLowerCase().includes(kw)) {
    issues.push('Основной запрос не встречается в SEO Title.');
  }
  // Keyword stuffing: any 3-word phrase repeated far too often.
  const words = a.bodyMd
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const counts = new Map<string, number>();
  for (let i = 0; i + 3 <= words.length; i++) {
    const k = words.slice(i, i + 3).join(' ');
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const limit = Math.max(6, Math.round(words.length / 150));
  for (const [phrase, n] of counts) {
    if (n > limit && phrase.split(' ').filter((w) => w.length > 2).length >= 2) {
      issues.push(`Фраза «${phrase}» повторяется ${n} раз — похоже на переспам.`);
      break;
    }
  }
  return issues;
}
