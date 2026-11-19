/** Text utilities for the SEO agent: slugs, normalisation, near-duplicate detection. */

const RU_LAT: Record<string, string> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'e',
  ж: 'zh',
  з: 'z',
  и: 'i',
  й: 'y',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'h',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'sch',
  ъ: '',
  ы: 'y',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
};

/** ЧПУ: Russian → Latin, lowercase, hyphens, max 80 chars, never empty. */
export function seoSlug(input: string, maxLength = 80): string {
  const lat = [...input.toLowerCase()].map((ch) => RU_LAT[ch] ?? ch).join('');
  const slug = lat
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '');
  return slug || 'statya';
}

export const SEO_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Lowercase, ё→е, punctuation stripped, single spaces — for keyword matching. */
export function normalizeQuery(text: string): string {
  return text
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function words(text: string): string[] {
  return normalizeQuery(text)
    .split(' ')
    .filter((w) => w.length > 0);
}

/** Word shingles (k=3, or k=1 for short texts). */
export function shingles(text: string, k = 3): Set<string> {
  const w = words(text);
  const size = w.length < k ? 1 : k;
  const set = new Set<string>();
  for (let i = 0; i + size <= w.length; i++) set.add(w.slice(i, i + size).join(' '));
  return set;
}

/** Jaccard similarity of shingle sets, 0–1. Used to refuse cross-posting the same text. */
export function textSimilarity(a: string, b: string): number {
  const sa = shingles(a);
  const sb = shingles(b);
  if (sa.size === 0 && sb.size === 0) return 1;
  let inter = 0;
  for (const s of sa) if (sb.has(s)) inter++;
  return inter / (sa.size + sb.size - inter);
}

/** Query overlap 0–1 (word sets) — cannibalisation / duplicate-topic check. */
export function queryOverlap(a: string, b: string): number {
  const stop = new Set(['и', 'в', 'на', 'по', 'для', 'с', 'к', 'о', 'как', 'что', 'это', 'егэ']);
  const sa = new Set(
    words(a)
      .filter((w) => !stop.has(w))
      .map(stem),
  );
  const sb = new Set(
    words(b)
      .filter((w) => !stop.has(w))
      .map(stem),
  );
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const s of sa) if (sb.has(s)) inter++;
  return inter / Math.min(sa.size, sb.size);
}

/** Crude Russian stem: cut common endings so «задания/заданий/задание» match. */
function stem(word: string): string {
  if (word.length <= 4) return word;
  return word.replace(
    /(ями|ами|иями|ого|его|ому|ему|ыми|ими|иях|ах|ях|ов|ев|ей|ий|ый|ой|ая|яя|ое|ее|ие|ые|ую|юю|ом|ем|ам|ям|ии|ия|ие|а|я|о|е|и|ы|у|ю|ь)$/u,
    '',
  );
}

/** Adds UTM parameters to an absolute URL (existing ones are replaced). */
export function withUtm(
  url: string,
  utm: { source: string; medium: string; campaign: string; content?: string },
): string {
  const u = new URL(url);
  u.searchParams.set('utm_source', utm.source);
  u.searchParams.set('utm_medium', utm.medium);
  u.searchParams.set('utm_campaign', utm.campaign);
  if (utm.content) u.searchParams.set('utm_content', utm.content);
  return u.toString();
}
