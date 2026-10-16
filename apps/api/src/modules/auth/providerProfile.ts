import { normalizeDisplayName } from '@zybrilka/shared';

const MAX_NAME_LENGTH = 100;
const MAX_AVATAR_URL_LENGTH = 1000;

/** A name coming FROM a provider (VK/Telegram): control and invisible
 * characters stripped, whitespace collapsed, bounded. `undefined` when
 * absent or not a string, so callers never store `null`/garbage. */
export function cleanProviderName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = normalizeDisplayName(value);
  if (!normalized) return undefined;
  return [...normalized].slice(0, MAX_NAME_LENGTH).join('');
}

/** Hosts a provider avatar may be served from. The URL always originates
 * from the provider's own response (server-to-server for VK, inside the
 * signed `initData` for Telegram) — never from the browser — and is only
 * ever rendered in an `<img>`; this list is a second line of defence so a
 * surprising value can't make us store or show a link to an arbitrary site. */
export const AVATAR_HOSTS = {
  vk: [
    'userapi.com',
    'vk.com',
    'vk.ru',
    'vkontakte.ru',
    'vkuserphoto.ru',
    'vk-cdn.net',
    'mycdn.me',
  ],
  telegram: ['t.me', 'telegram.org', 'telegram-cdn.org', 'cdn-telegram.org'],
} as const;

export type AvatarProvider = keyof typeof AVATAR_HOSTS;

function hostAllowed(hostname: string, provider: AvatarProvider): boolean {
  const host = hostname.toLowerCase();
  return AVATAR_HOSTS[provider].some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

/** VK serves a stock "camera" / "deactivated" picture for users without a
 * photo; that is "no avatar", not a photo worth saving. */
const VK_PLACEHOLDER = /\/images\/(camera|deactivated|stub|question)[_.\w-]*\.(png|gif|jpg)$/i;

export type AvatarRejection =
  'not_https' | 'bad_url' | 'host_not_allowed' | 'placeholder' | 'too_long';

/**
 * Validates a provider-supplied avatar URL. Returns the normalized URL, or
 * the reason it was refused (so the caller can log the reason — never the
 * URL, which for some CDNs carries a signature).
 */
export function checkProviderAvatarUrl(
  value: unknown,
  provider: AvatarProvider,
): { ok: true; url: string } | { ok: false; reason: AvatarRejection } {
  if (typeof value !== 'string') return { ok: false, reason: 'bad_url' };
  const trimmed = value.trim();
  if (trimmed.length > MAX_AVATAR_URL_LENGTH) return { ok: false, reason: 'too_long' };
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, reason: 'bad_url' };
  }
  if (url.protocol !== 'https:') return { ok: false, reason: 'not_https' };
  if (url.username || url.password) return { ok: false, reason: 'bad_url' };
  if (!hostAllowed(url.hostname, provider)) return { ok: false, reason: 'host_not_allowed' };
  if (provider === 'vk' && VK_PLACEHOLDER.test(url.pathname)) {
    return { ok: false, reason: 'placeholder' };
  }
  return { ok: true, url: url.toString() };
}
