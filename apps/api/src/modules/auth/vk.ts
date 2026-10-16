import { createHash, randomBytes } from 'node:crypto';
import type { Config } from '../../config.js';

/**
 * VK ID (OAuth 2.1 + mandatory PKCE, hosted at id.vk.com — NOT the
 * deprecated oauth.vk.com OAuth 2.0 endpoints). Endpoint paths and the
 * requirement to echo back `device_id` at token exchange are sourced
 * from VK ID community integration guides (no official endpoint
 * reference could be directly confirmed at implementation time) —
 * **verify both URLs below against the current official VK ID web
 * documentation (https://id.vk.com, VK ID for Business docs) before
 * relying on this in production**, and update them here if VK has
 * changed the paths.
 */
const VK_AUTHORIZE_URL = 'https://id.vk.com/authorize';
const VK_TOKEN_URL = 'https://id.vk.com/oauth2/auth';

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
