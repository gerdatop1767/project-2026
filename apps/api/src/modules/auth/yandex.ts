import type { Config } from '../../config.js';
import { checkProviderAvatarUrl, cleanProviderName } from './providerProfile.js';
import type { VkPkceChallenge } from './vk.js';

/**
 * Yandex ID (OAuth 2.0 authorization code flow, with PKCE) — docs/YANDEX_ID.md.
 *
 * Per Yandex ID's documentation ("Getting a confirmation code from a URL",
 * "Exchanging the token for information about the user"):
 * - `https://oauth.yandex.ru/authorize`: response_type=code, client_id,
 *   redirect_uri, state, code_challenge, code_challenge_method=S256.
 *   The scopes are the ones ticked for the app in oauth.yandex.ru, so no
 *   `scope` parameter is sent (asking for one the app lacks is an error).
 * - Callback: `code` + `state`, or `error` (e.g. `access_denied` when the
 *   user declines) + `state`.
 * - `https://oauth.yandex.ru/token` (form POST): grant_type=authorization_code,
 *   code, client_id, client_secret, code_verifier → `access_token`.
 * - `https://login.yandex.ru/info?format=json` with `Authorization: OAuth <token>`
 *   → `id` (stable per-user id), `first_name`, `last_name`,
 *   `default_avatar_id`, `is_avatar_empty`.
 *
 * This environment could not open the Yandex docs or endpoints directly
 * (DNS blocked); the above follows the docs' indexed text. Do one real
 * sign-in against the registered app before relying on it in production.
 */
const YANDEX_AUTHORIZE_URL = 'https://oauth.yandex.ru/authorize';
const YANDEX_TOKEN_URL = 'https://oauth.yandex.ru/token';
const YANDEX_INFO_URL = 'https://login.yandex.ru/info?format=json';
const YANDEX_AVATAR_URL = 'https://avatars.yandex.net/get-yapic';

export class YandexNotConfiguredError extends Error {
  constructor() {
    super(
      'Yandex ID is not configured (YANDEX_CLIENT_ID/YANDEX_CLIENT_SECRET/YANDEX_REDIRECT_URI)',
    );
  }
}

export function isYandexConfigured(config: Config): boolean {
  return Boolean(
    config.YANDEX_CLIENT_ID && config.YANDEX_CLIENT_SECRET && config.YANDEX_REDIRECT_URI,
  );
}

/** What went wrong talking to Yandex — coarse and free of any request or
 * response content (no code, token or secret), so always safe to log. */
export type YandexFailureKind = 'timeout' | 'network' | 'http' | 'invalid_response';

export class YandexRequestError extends Error {
  constructor(
    readonly kind: YandexFailureKind,
    readonly status?: number,
    /** Yandex's short machine error code (e.g. `invalid_grant`), if any. */
    readonly yandexError?: string,
  ) {
    super(`Yandex request failed: ${kind}${status ? ` (${status})` : ''}`);
    this.name = 'YandexRequestError';
  }
}

const ERROR_CODE_PATTERN = /^[a-z0-9_.]{1,64}$/i;

async function callYandex(
  config: Config,
  url: string,
  init: RequestInit,
): Promise<Record<string, unknown>> {
  try {
    const response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(config.YANDEX_REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      let code: string | undefined;
      try {
        const body = (await response.json()) as { error?: unknown };
        if (typeof body.error === 'string' && ERROR_CODE_PATTERN.test(body.error))
          code = body.error;
      } catch {
        // The status is enough.
      }
      throw new YandexRequestError('http', response.status, code);
    }
    const data: unknown = await response.json();
    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
      throw new YandexRequestError('invalid_response');
    }
    return data as Record<string, unknown>;
  } catch (error) {
    if (error instanceof YandexRequestError) throw error;
    const name = (error as { name?: string } | null)?.name;
    if (name === 'TimeoutError' || name === 'AbortError') throw new YandexRequestError('timeout');
    if (error instanceof SyntaxError) throw new YandexRequestError('invalid_response');
    throw new YandexRequestError('network');
  }
}

export function buildYandexAuthorizeUrl(config: Config, challenge: VkPkceChallenge): string {
  if (!isYandexConfigured(config)) throw new YandexNotConfiguredError();
  const url = new URL(YANDEX_AUTHORIZE_URL);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', config.YANDEX_CLIENT_ID!);
  url.searchParams.set('redirect_uri', config.YANDEX_REDIRECT_URI!);
  url.searchParams.set('state', challenge.state);
  url.searchParams.set('code_challenge', challenge.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

/** Server-to-server code exchange. Returns the access token (kept in memory
 * for the one profile request below — never stored or logged). */
export async function exchangeYandexCode(
  config: Config,
  code: string,
  codeVerifier: string,
): Promise<string> {
  if (!isYandexConfigured(config)) throw new YandexNotConfiguredError();
  const data = await callYandex(config, YANDEX_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: config.YANDEX_CLIENT_ID!,
      client_secret: config.YANDEX_CLIENT_SECRET!,
      code_verifier: codeVerifier,
    }),
  });
  const token = data.access_token;
  if (typeof token !== 'string' || token === '') throw new YandexRequestError('invalid_response');
  return token;
}

export interface YandexUser {
  /** Yandex's stable user id — the identity key (`auth_identities`). */
  id: string;
  firstName?: string;
  lastName?: string;
  avatarUrl?: string;
}

/** Everything about the user comes from this server-to-server response
 * for the token we just obtained — nothing from the browser. */
export async function fetchYandexUser(config: Config, accessToken: string): Promise<YandexUser> {
  const data = await callYandex(config, YANDEX_INFO_URL, {
    method: 'GET',
    headers: { authorization: `OAuth ${accessToken}` },
  });
  const rawId = data.id;
  const id =
    typeof rawId === 'string' && /^\d{1,32}$/.test(rawId)
      ? rawId
      : typeof rawId === 'number' && Number.isSafeInteger(rawId) && rawId > 0
        ? String(rawId)
        : null;
  if (!id) throw new YandexRequestError('invalid_response');

  const avatarId = data.default_avatar_id;
  const checked =
    data.is_avatar_empty !== true &&
    typeof avatarId === 'string' &&
    /^[\w/-]{1,200}$/.test(avatarId)
      ? checkProviderAvatarUrl(`${YANDEX_AVATAR_URL}/${avatarId}/islands-200`, 'yandex')
      : null;
  const avatarUrl = checked?.ok ? checked.url : undefined;

  return {
    id,
    firstName: cleanProviderName(data.first_name),
    lastName: cleanProviderName(data.last_name),
    avatarUrl,
  };
}
