import { createHash, randomBytes } from 'node:crypto';
import type { Config } from '../../config.js';

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

export class VkNotConfiguredError extends Error {
  constructor() {
    super('VK ID is not configured (VK_CLIENT_ID/VK_CLIENT_SECRET/VK_REDIRECT_URI)');
  }
}

export function isVkConfigured(config: Config): boolean {
  return Boolean(config.VK_CLIENT_ID && config.VK_CLIENT_SECRET && config.VK_REDIRECT_URI);
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
): Promise<{ vkUserId: string }> {
  if (!isVkConfigured(config)) throw new VkNotConfiguredError();
  const response = await fetch(VK_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      code_verifier: codeVerifier,
      client_id: config.VK_CLIENT_ID!,
      client_secret: config.VK_CLIENT_SECRET!,
      redirect_uri: config.VK_REDIRECT_URI!,
      device_id: deviceId,
    }),
  });
  if (!response.ok) {
    throw new Error(`VK token exchange failed: ${response.status} ${await response.text()}`);
  }
  const data = (await response.json()) as { user_id?: number | string };
  if (data.user_id === undefined) {
    throw new Error('VK token response missing user_id');
  }
  return { vkUserId: String(data.user_id) };
}
