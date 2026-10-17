import { createHash, randomBytes } from 'node:crypto';
import type { Config } from '../../config.js';
import { checkProviderAvatarUrl, cleanProviderName } from './providerProfile.js';

/**
 * VK ID (OAuth 2.1 + mandatory PKCE — NOT the deprecated oauth.vk.com
 * OAuth 2.0/Implicit Flow endpoints).
 *
 * Domain: the official "VK ID for Business" docs (id.vk.ru — "Как
 * работает авторизация VK ID на Web" / "Авторизация без SDK для Web")
 * consistently use **id.vk.ru**, not id.vk.com, for both endpoints —
 * this file was switched from `.com` to `.ru` to match. That said,
 * this environment could not reach id.vk.ru/id.vk.com directly (DNS
 * blocked) to load the live pages; the above is based on search-index
 * excerpts of those exact doc pages, not a page fetch or a real
 * end-to-end OAuth round-trip. **Before relying on this in
 * production, do one real login against the registered VK app** and
 * confirm the redirect actually lands on id.vk.ru and the callback
 * carries the expected params — if VK has since moved everything to
 * id.vk.com, swap the domain back here.
 *
 * Parameters (confirmed against the same doc excerpts):
 * - `/authorize`: response_type=code, client_id, redirect_uri, state,
 *   code_challenge, code_challenge_method=S256, scope (optional).
 * - Callback (redirect_uri): code, state, device_id.
 * - `/oauth2/auth` (code exchange): grant_type=authorization_code,
 *   code, code_verifier, client_id, device_id, redirect_uri. This
 *   file also sends `client_secret` for confidential (server-side)
 *   clients; one doc excerpt separately mentions a "service_token"
 *   for confidential apps, but it was unclear whether that refers to
 *   this same exchange or a different VK API call — **unresolved,
 *   verify in the VK ID for Business app console** before assuming
 *   client_secret alone is sufficient.
 * - Response: flat JSON with `access_token`, `refresh_token`,
 *   `token_type`, `expires_in`, and `user_id` (number) — confirmed via
 *   a doc example response, so reading `data.user_id` below is
 *   correct as-is (not an OIDC `id_token` that would need decoding).
 */
const VK_AUTHORIZE_URL = 'https://id.vk.ru/authorize';
const VK_TOKEN_URL = 'https://id.vk.ru/oauth2/auth';
const VK_USER_INFO_URL = 'https://id.vk.ru/oauth2/user_info';

export class VkNotConfiguredError extends Error {
  constructor() {
    super('VK ID is not configured (VK_CLIENT_ID/VK_CLIENT_SECRET/VK_REDIRECT_URI)');
  }
}

export function isVkConfigured(config: Config): boolean {
  return Boolean(config.VK_CLIENT_ID && config.VK_CLIENT_SECRET && config.VK_REDIRECT_URI);
}

/** What went wrong talking to VK — deliberately coarse and free of any
 * request/response content, so it is always safe to log. */
export type VkRequestFailureKind = 'timeout' | 'network' | 'http' | 'invalid_response';

export class VkRequestError extends Error {
  constructor(
    readonly kind: VkRequestFailureKind,
    readonly status?: number,
    /** VK's short machine error code (e.g. `invalid_grant`), if it sent
     * one in the expected shape. Never a free-text description. */
    readonly vkError?: string,
  ) {
    super(
      `VK request failed: ${kind}${status ? ` (${status})` : ''}${vkError ? ` ${vkError}` : ''}`,
    );
    this.name = 'VkRequestError';
  }
}

const VK_ERROR_CODE_PATTERN = /^[a-z0-9_.]{1,64}$/i;

/** One POST to VK with a hard deadline covering BOTH the response
 * headers and reading the body (`AbortSignal.timeout` aborts a stalled
 * body read too). Returns the parsed JSON object. */
async function postToVk(
  config: Config,
  url: string,
  params: Record<string, string>,
): Promise<Record<string, unknown>> {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params),
      signal: AbortSignal.timeout(config.VK_REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      let vkError: string | undefined;
      try {
        const body = (await response.json()) as { error?: unknown };
        if (typeof body.error === 'string' && VK_ERROR_CODE_PATTERN.test(body.error)) {
          vkError = body.error;
        }
      } catch {
        // Unreadable error body — the status alone is enough.
      }
      throw new VkRequestError('http', response.status, vkError);
    }
    const data: unknown = await response.json();
    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
      throw new VkRequestError('invalid_response');
    }
    return data as Record<string, unknown>;
  } catch (error) {
    if (error instanceof VkRequestError) throw error;
    const name = (error as { name?: string } | null)?.name;
    if (name === 'TimeoutError' || name === 'AbortError') throw new VkRequestError('timeout');
    if (error instanceof SyntaxError) throw new VkRequestError('invalid_response');
    throw new VkRequestError('network');
  }
}

function base64url(buffer: Buffer): string {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export interface VkPkceChallenge {
  state: string;
  codeVerifier: string;
  codeChallenge: string;
}

/** Generates the CSRF `state` and PKCE pair for one login attempt — the
 * caller stores both server-side (a short-lived cookie) and must pass
 * the same `codeVerifier` back into `exchangeVkCode` after the
 * redirect, never trusting a client-supplied value instead. */
export function createVkPkceChallenge(): VkPkceChallenge {
  const state = base64url(randomBytes(16));
  const codeVerifier = base64url(randomBytes(32));
  const codeChallenge = base64url(createHash('sha256').update(codeVerifier).digest());
  return { state, codeVerifier, codeChallenge };
}

export function buildVkAuthorizeUrl(config: Config, challenge: VkPkceChallenge): string {
  if (!isVkConfigured(config)) throw new VkNotConfiguredError();
  const url = new URL(VK_AUTHORIZE_URL);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', config.VK_CLIENT_ID!);
  url.searchParams.set('redirect_uri', config.VK_REDIRECT_URI!);
  url.searchParams.set('state', challenge.state);
  url.searchParams.set('code_challenge', challenge.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('scope', 'email');
  return url.toString();
}

/** Exchanges the authorization code for VK's numeric user id. Never
 * trusts any user-identity field the client might supply on the
 * callback request itself — only what VK's own token endpoint returns
 * for this `code` is used. */
export async function exchangeVkCode(
  config: Config,
  code: string,
  deviceId: string,
  codeVerifier: string,
): Promise<{ vkUserId: string; accessToken?: string }> {
  if (!isVkConfigured(config)) throw new VkNotConfiguredError();
  const data = await postToVk(config, VK_TOKEN_URL, {
    grant_type: 'authorization_code',
    code,
    code_verifier: codeVerifier,
    client_id: config.VK_CLIENT_ID!,
    client_secret: config.VK_CLIENT_SECRET!,
    redirect_uri: config.VK_REDIRECT_URI!,
    device_id: deviceId,
  });
  const userId = data.user_id;
  if (typeof userId !== 'number' && typeof userId !== 'string') {
    throw new VkRequestError('invalid_response');
  }
  return {
    vkUserId: String(userId),
    accessToken: typeof data.access_token === 'string' ? data.access_token : undefined,
  };
}

/** Display profile VK knows about the user. Every field is optional —
 * VK may omit any of them and the caller must never treat a missing one
 * as "clear what we have". */
export interface VkProfile {
  firstName?: string;
  lastName?: string;
  avatarUrl?: string;
}

/** VK's own method API: a second, richer source for the photo. */
const VK_API_USERS_GET = 'https://api.vk.com/method/users.get';
const VK_API_VERSION = '5.199';

/** Photo fields `users.get` can return, best first, with the side (px) each
 * is documented to have. `photo_max_orig` is the original upload, so it is
 * ranked above everything without a made-up pixel count. */
const PHOTO_FIELDS: readonly { field: string; score: number }[] = [
  { field: 'photo_max_orig', score: 1_000_000 },
  { field: 'photo_400_orig', score: 400 * 400 },
  { field: 'photo_200_orig', score: 200 * 200 },
  { field: 'photo_200', score: 200 * 200 },
  { field: 'photo_100', score: 100 * 100 },
  { field: 'photo_50', score: 50 * 50 },
];

export interface AvatarCandidate {
  url: string;
  /** Larger = better. Only ever derived from a documented field or from a
   * size the URL itself declares — never guessed or inflated. */
  score: number;
}

/** VK image URLs declare the crop they serve as `cs=WxH` (or `size=WxH`);
 * read that, and nothing more, as the URL's own size hint. */
export function declaredPixels(url: string): number {
  try {
    const params = new URL(url).searchParams;
    for (const key of ['cs', 'size']) {
      const match = params.get(key)?.match(/^(\d{2,4})x(\d{2,4})$/);
      if (match) return Number(match[1]) * Number(match[2]);
    }
  } catch {
    // not a URL
  }
  return 0;
}

/** The highest-quality candidate; on a tie the earlier one (users.get first). */
export function pickBestAvatar(candidates: readonly AvatarCandidate[]): string | undefined {
  let best: AvatarCandidate | undefined;
  for (const candidate of candidates) {
    if (!best || candidate.score > best.score) best = candidate;
  }
  return best?.url;
}

/** The only logging surface the VK helpers need (pino-compatible). */
export interface VkLogger {
  warn(obj: Record<string, unknown>, msg: string): void;
}

function failureFields(error: unknown): Record<string, unknown> {
  const failure = error instanceof VkRequestError ? error : new VkRequestError('network');
  return {
    kind: failure.kind,
    ...(failure.status !== undefined ? { status: failure.status } : {}),
    ...(failure.vkError ? { vkError: failure.vkError } : {}),
  };
}

/**
 * Best-effort profile lookup with the access token VK just issued for THIS
 * authorization code (server-to-server, never anything the browser
 * supplied), every call bounded by `VK_REQUEST_TIMEOUT_MS`. Never throws: a
 * failed or malformed lookup yields less data (down to `{}`), never a failed
 * sign-in.
 *
 * Two sources, queried in parallel and merged:
 * - `POST id.vk.ru/oauth2/user_info` → `{ user: { first_name, last_name,
 *   avatar } }`. Its `avatar` is a ready-made thumbnail whose URL declares a
 *   small crop (`cs=…`), which is why photos looked blurry.
 * - `POST api.vk.com/method/users.get` with `fields=photo_max_orig,…` → the
 *   original upload and the sized variants. The best photo across BOTH
 *   sources is kept (see `pickBestAvatar`); a placeholder "camera" picture
 *   or a host outside the allow-list counts as no photo.
 *
 * Whether VK ID access tokens are accepted by `users.get` — and the exact
 * key names above — are taken from third-party client libraries, because
 * VK's own docs were not reachable when this was written. So each source is
 * independent and a failure is logged as ONE warning carrying only the
 * failure kind / HTTP status / VK error code / key NAMES (never tokens,
 * codes, secrets, cookies, bodies, photo URLs or personal values), then the
 * other source is used. The first real login shows in the API logs which
 * source works.
 */
export async function fetchVkProfile(
  config: Config,
  accessToken: string,
  log?: VkLogger,
): Promise<VkProfile> {
  if (!isVkConfigured(config)) return {};

  const [userInfo, photoApi] = await Promise.all([
    readUserInfo(config, accessToken, log),
    readUsersGet(config, accessToken, log),
  ]);

  const candidates: AvatarCandidate[] = [];
  const consider = (value: unknown, score: number, source: string) => {
    if (value === undefined || value === null || value === '') return;
    const checked = checkProviderAvatarUrl(value, 'vk');
    if (checked.ok) {
      candidates.push({ url: checked.url, score });
    } else if (checked.reason !== 'placeholder') {
      // A stock "no photo" picture is normal; anything else is worth knowing about.
      log?.warn({ vkAvatar: checked.reason, source }, 'VK avatar URL ignored');
    }
  };
  for (const { field, score } of PHOTO_FIELDS) consider(photoApi[field], score, 'users.get');
  consider(userInfo.avatar, declaredPixels(String(userInfo.avatar ?? '')), 'user_info');

  return {
    firstName: userInfo.firstName ?? photoApi.firstName,
    lastName: userInfo.lastName ?? photoApi.lastName,
    avatarUrl: pickBestAvatar(candidates),
  };
}

interface RawInfo {
  firstName?: string;
  lastName?: string;
  avatar?: unknown;
}

async function readUserInfo(config: Config, accessToken: string, log?: VkLogger): Promise<RawInfo> {
  try {
    const data = await postToVk(config, VK_USER_INFO_URL, {
      access_token: accessToken,
      client_id: config.VK_CLIENT_ID!,
    });
    const user = data.user;
    if (user === null || typeof user !== 'object' || Array.isArray(user)) {
      log?.warn(
        { vkProfile: 'invalid_response', topLevelKeys: safeKeys(data) },
        'VK profile lookup returned no user object; continuing without it',
      );
      return {};
    }
    const fields = user as Record<string, unknown>;
    const info: RawInfo = {
      firstName: cleanProviderName(fields.first_name),
      lastName: cleanProviderName(fields.last_name),
      avatar: fields.avatar,
    };
    if (!info.firstName && !info.lastName && !fields.avatar) {
      log?.warn(
        { vkProfile: 'no_usable_fields', userKeys: safeKeys(fields) },
        'VK profile lookup succeeded but had no name/avatar; continuing without it',
      );
    }
    return info;
  } catch (error) {
    log?.warn(
      { vkProfile: failureFields(error).kind, ...failureFields(error) },
      'VK profile lookup failed; continuing without it',
    );
    return {};
  }
}

async function readUsersGet(
  config: Config,
  accessToken: string,
  log?: VkLogger,
): Promise<RawInfo & Record<string, unknown>> {
  try {
    const data = await postToVk(config, VK_API_USERS_GET, {
      access_token: accessToken,
      v: VK_API_VERSION,
      fields: PHOTO_FIELDS.map((f) => f.field).join(','),
    });
    if (data.error && typeof data.error === 'object') {
      // VK API errors arrive as HTTP 200 with an `error` object.
      const code = (data.error as Record<string, unknown>).error_code;
      log?.warn(
        { vkPhotoApi: 'api_error', ...(typeof code === 'number' ? { vkErrorCode: code } : {}) },
        'VK users.get returned an error; using the user_info photo if any',
      );
      return {};
    }
    const list = data.response;
    const first = Array.isArray(list) ? list[0] : undefined;
    if (first === null || typeof first !== 'object') {
      log?.warn(
        { vkPhotoApi: 'invalid_response', topLevelKeys: safeKeys(data) },
        'VK users.get returned no user; using the user_info photo if any',
      );
      return {};
    }
    const fields = first as Record<string, unknown>;
    return {
      ...fields,
      firstName: cleanProviderName(fields.first_name),
      lastName: cleanProviderName(fields.last_name),
    };
  } catch (error) {
    log?.warn(
      { vkPhotoApi: failureFields(error).kind, ...failureFields(error) },
      'VK users.get failed; using the user_info photo if any',
    );
    return {};
  }
}

/** Key NAMES only (bounded), for diagnosing a differently-shaped
 * response without ever touching values. */
function safeKeys(object: Record<string, unknown>): string[] {
  return Object.keys(object)
    .slice(0, 20)
    .map((key) => key.slice(0, 40));
}
