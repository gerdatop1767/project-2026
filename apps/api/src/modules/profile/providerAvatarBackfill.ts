import { schema, type Database } from '@zybrilka/db';
import { inArray } from 'drizzle-orm';
import { cacheProviderAvatar, type CacheOutcome } from './providerAvatar.js';

/**
 * Accounts that have their provider's photo only as a URL (they signed in
 * before photos were copied, or the copy failed) show nothing to others:
 * the rating serves stored images only. When the rating meets such an
 * account, its photo is copied in the background — through the same
 * provider-host allow-list, timeout and image checks as at sign-in — so
 * the next view shows it. The URL is the one the provider itself gave at
 * sign-in; nothing a client sends is ever fetched.
 *
 * Bounded: a few accounts per call, each tried at most once per
 * RETRY_MS in this process (a provider that is down is not hammered).
 */
const RETRY_MS = 6 * 60 * 60 * 1000;
const MAX_PER_CALL = 5;
const lastTried = new Map<string, number>();

type Fetcher = typeof cacheProviderAvatar;

export function backfillProviderAvatars(
  db: Database,
  userIds: readonly string[],
  options: { now?: number; cache?: Fetcher } = {},
): Promise<CacheOutcome[]> {
  const now = options.now ?? Date.now();
  const due = userIds
    .filter((id) => now - (lastTried.get(id) ?? -Infinity) >= RETRY_MS)
    .slice(0, MAX_PER_CALL);
  if (due.length === 0) return Promise.resolve([]);
  for (const id of due) lastTried.set(id, now);
  const cache = options.cache ?? cacheProviderAvatar;
  return db
    .select({
      id: schema.users.id,
      profileSource: schema.users.profileSource,
      avatarUrl: schema.users.avatarUrl,
    })
    .from(schema.users)
    .where(inArray(schema.users.id, due))
    .then(async (rows) => {
      const outcomes: CacheOutcome[] = [];
      // One at a time: a background trickle, never a burst at the CDN.
      for (const row of rows) {
        if (!row.profileSource || !row.avatarUrl) continue;
        outcomes.push(await cache(db, row.id, row.profileSource, row.avatarUrl));
      }
      return outcomes;
    })
    .catch(() => []);
}

/** Tests only: forget who was tried. */
export function resetProviderAvatarBackfillForTests(): void {
  lastTried.clear();
}
