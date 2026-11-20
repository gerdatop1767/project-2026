import { randomBytes } from 'node:crypto';

// The allow-list lives in @zybrilka/shared (one list for the API, the admin
// and the SEO agent); re-exported here for the existing imports.
export { CAMPAIGN_TARGET_ROOTS, isAllowedCampaignTarget } from '@zybrilka/shared';

/** Campaign slugs: 10 random base62-ish chars, server-generated only. */
export const SLUG_RE = /^[A-Za-z0-9_-]{6,32}$/;

export function newCampaignSlug(): string {
  return randomBytes(8).toString('base64url').slice(0, 10);
}
