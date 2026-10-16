import { createHash, randomBytes } from 'node:crypto';
import type { Database } from '@zybrilka/db';
import type { AuthUser } from '@zybrilka/shared';
import type { Config } from '../../config.js';
import * as repo from './repo.js';
import { isEmailConfigured, sendMagicLinkEmail, EmailNotConfiguredError } from './email.js';
import { exchangeVkCode } from './vk.js';

export { EmailNotConfiguredError } from './email.js';
export { VkNotConfiguredError, isVkConfigured } from './vk.js';

const MAGIC_LINK_TTL_MS = 15 * 60 * 1000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Always resolves the same way whether or not `email` has an account —
 * callers must respond identically on success either way, so a caller
 * can't use response differences to enumerate registered emails. */
export async function requestMagicLink(db: Database, config: Config, email: string): Promise<void> {
  if (!isEmailConfigured(config)) {
    throw new EmailNotConfiguredError();
  }
  const normalizedEmail = email.trim().toLowerCase();
  const token = randomBytes(32).toString('hex');
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + MAGIC_LINK_TTL_MS);
  await repo.createMagicLinkToken(db, normalizedEmail, tokenHash, expiresAt);

  // Points at the frontend's `login` screen (not this API's own
  // POST /auth/verify route) — Login.tsx detects the `token` query
  // param on mount and completes the verification from there.
  const link = new URL('/login', config.WEB_BASE_URL);
  link.searchParams.set('token', token);
  await sendMagicLinkEmail(config, normalizedEmail, link.toString());
}

export class InvalidMagicLinkError extends Error {
  constructor() {
    super('This sign-in link is invalid or has expired');
  }
}

/** Verifies the token, creates/resolves the `users` row for this
 * email, and opens a new session. Rate limiting (not implemented here
 * — see final report) should sit in front of this at the route level. */
export async function verifyMagicLink(
  db: Database,
  token: string,
): Promise<{ sessionId: string; sessionExpiresAt: Date; user: AuthUser }> {
  const tokenHash = hashToken(token);
  const found = await repo.findValidMagicLinkToken(db, tokenHash);
  if (!found) throw new InvalidMagicLinkError();

  const userId = await repo.findOrCreateUserByIdentity(db, 'email', found.email);
  await repo.consumeMagicLinkToken(db, found.id);

  const sessionExpiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const sessionId = await repo.createSession(db, userId, sessionExpiresAt);
  return { sessionId, sessionExpiresAt, user: { id: userId, email: found.email } };
}

/** Exchanges the VK authorization code for VK's user id, then
 * find-or-creates the `users` row and opens a session — mirrors
 * `verifyMagicLink`'s shape so the route can treat both uniformly. */
export async function completeVkLogin(
  db: Database,
  config: Config,
  code: string,
  deviceId: string,
  codeVerifier: string,
): Promise<{ sessionId: string; sessionExpiresAt: Date; user: AuthUser }> {
  const { vkUserId } = await exchangeVkCode(config, code, deviceId, codeVerifier);
  const userId = await repo.findOrCreateUserByIdentity(db, 'vk', vkUserId);
  const email = await repo.getUserEmail(db, userId);

  const sessionExpiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const sessionId = await repo.createSession(db, userId, sessionExpiresAt);
  return { sessionId, sessionExpiresAt, user: { id: userId, email } };
}

export async function getCurrentUser(db: Database, sessionId: string): Promise<AuthUser | null> {
  const userId = await repo.getSessionUserId(db, sessionId);
  if (!userId) return null;
  const email = await repo.getUserEmail(db, userId);
  return { id: userId, email };
}

export async function logout(db: Database, sessionId: string): Promise<void> {
  await repo.deleteSession(db, sessionId);
}
