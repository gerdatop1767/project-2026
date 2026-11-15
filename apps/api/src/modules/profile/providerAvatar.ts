import type { Database } from '@zybrilka/db';
import { AVATAR_MAX_BYTES } from '@zybrilka/shared';
import { storeAvatar } from './service.js';

/**
 * A local copy of the photo VK / Telegram / Yandex gave us at sign-in.
 *
 * Why: the profile picture used to be the provider's own URL, loaded by
 * every browser from the provider's CDN on every view. For Telegram that is
 * `t.me/i/userpic/...`, which is often slow or unreachable from Russian
 * networks; a request that hangs shows an empty avatar until the browser
 * gives up (the fallback only appears on an error). A copy stored with the
 * user's other avatars is served from our own domain with a long immutable
 * cache, so it appears at once on every later visit.
 *
 * Only https URLs on the providers' own image hosts are fetched (the URL
 * comes from VK's server response or Telegram's signed launch data, and the
 * allow-list keeps this from ever becoming a request to anywhere else), with
 * a short timeout and the same size/type checks as an uploaded avatar.
 * Best effort: any failure leaves the provider URL in use, as before.
 */
const ALLOWED_HOSTS: readonly RegExp[] = [
  /(^|\.)userapi\.com$/,
  /(^|\.)vk\.com$/,
  /(^|\.)vk\.me$/,
  /(^|\.)vkuserphoto\.ru$/,
  /^t\.me$/,
  /(^|\.)telegram\.org$/,
  /(^|\.)telesco\.pe$/,
  /(^|\.)cdn-telegram\.org$/,
  /^avatars\.yandex\.net$/,
  /^avatars\.mds\.yandex\.net$/,
];
const FETCH_TIMEOUT_MS = 4000;

export function isAllowedProviderAvatarUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
  return ALLOWED_HOSTS.some((re) => re.test(url.hostname));
}

interface Logger {
  warn: (obj: Record<string, unknown>, msg: string) => void;
}

export type CacheOutcome = 'stored' | 'skipped' | 'failed';

const MAX_REDIRECTS = 3;

/**
 * GETs an avatar from an allowed provider host. Redirects are followed by
 * hand, and every hop must be an allowed host too: with `redirect:
 * 'follow'` only the last URL was checked, so a redirect through an
 * allowed host could make the server request an internal address. The
 * body is read with a hard size cap, also when no content-length is sent.
 */
async function fetchAllowedImage(start: string): Promise<Buffer | null> {
  let url = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!isAllowedProviderAvatarUrl(url)) return null;
    const response = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: 'manual',
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) return null;
      url = new URL(location, url).href;
      continue;
    }
    if (!response.ok) return null;
    const declared = Number(response.headers.get('content-length') ?? 0);
    if (declared > AVATAR_MAX_BYTES) return null;
    return readCapped(response, AVATAR_MAX_BYTES);
  }
  return null;
}

async function readCapped(response: Response, max: number): Promise<Buffer | null> {
  if (!response.body) return Buffer.from(await response.arrayBuffer());
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

export async function cacheProviderAvatar(
  db: Database,
  userId: string,
  source: 'vk' | 'telegram' | 'yandex',
  url: string | null | undefined,
  log?: Logger,
): Promise<CacheOutcome> {
  if (!url || !isAllowedProviderAvatarUrl(url)) return 'skipped';
  try {
    const bytes = await fetchAllowedImage(url);
    if (!bytes) {
      log?.warn({ avatarCache: source }, 'provider avatar not cached');
      return 'failed';
    }
    const stored = await storeAvatar(db, userId, source, bytes);
    if (!stored.ok) {
      log?.warn({ avatarCache: source, problem: stored.problem }, 'provider avatar not usable');
      return 'failed';
    }
    return 'stored';
  } catch (err) {
    log?.warn({ avatarCache: source, err: (err as Error).name }, 'provider avatar fetch failed');
    return 'failed';
  }
}
