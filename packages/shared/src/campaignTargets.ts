/**
 * Where a tracked link (campaign, `/api/v1/go/<slug>`) may send people: a
 * path inside this site, from a fixed list of entry sections. Never a
 * scheme, host, `//`, `..`, query or fragment — so `new URL(path,
 * WEB_BASE_URL)` can only ever stay on our own domain (no open redirect).
 *
 * The single source of truth for the API redirect, campaign creation in the
 * admin and by the SEO agent, and the SEO article schema.
 */
export const CAMPAIGN_TARGET_ROOTS = [
  '',
  'landing',
  'training',
  'subjects',
  'learning',
  'topics',
  'mock-exams',
  'help',
  'faq',
  // Learning centre and games (SEO article calls to action, docs/SEO_CENTER.md).
  'theory',
  'materials',
  'strategies',
  'games',
  // Blog articles (docs/SEO_CENTER.md): external posts link to /blog/<slug>.
  'blog',
] as const;

const TARGET_RE = /^\/(?:[a-z0-9-]{1,40}(?:\/[a-z0-9-]{1,90}){0,2})?$/;

export function isAllowedCampaignTarget(path: string): boolean {
  if (!TARGET_RE.test(path)) return false;
  const root = path.split('/')[1] ?? '';
  return (CAMPAIGN_TARGET_ROOTS as readonly string[]).includes(root);
}
