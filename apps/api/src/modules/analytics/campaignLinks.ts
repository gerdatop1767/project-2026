import { randomBytes } from 'node:crypto';

/**
 * Where a campaign link may send people: a path inside this site, from a
 * fixed list of entry pages. Never a scheme, host, `//`, `..`, query or
 * fragment — so `new URL(path, WEB_BASE_URL)` can only ever stay on our
 * own domain (no open redirect).
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
] as const;

const TARGET_RE = /^\/(?:[a-z0-9-]{1,40}(?:\/[a-z0-9-]{1,40}){0,2})?$/;

export function isAllowedCampaignTarget(path: string): boolean {
  if (!TARGET_RE.test(path)) return false;
  const root = path.split('/')[1] ?? '';
  return (CAMPAIGN_TARGET_ROOTS as readonly string[]).includes(root);
}

/** Campaign slugs: 10 random base62-ish chars, server-generated only. */
export const SLUG_RE = /^[A-Za-z0-9_-]{6,32}$/;

export function newCampaignSlug(): string {
  return randomBytes(8).toString('base64url').slice(0, 10);
}
