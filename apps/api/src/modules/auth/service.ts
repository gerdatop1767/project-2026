import { createHash, randomBytes } from 'node:crypto';
import type { Database } from '@zybrilka/db';
import type { AuthUser } from '@zybrilka/shared';
import type { Config } from '../../config.js';
import * as repo from './repo.js';
import { isEmailConfigured, sendMagicLinkEmail, EmailNotConfiguredError } from './email.js';
import { isOnboardingCompleted } from '../learningProfile/repo.js';
import * as profileRepo from '../profile/repo.js';
import { resolveProfile, storeAvatar } from '../profile/service.js';
import { exchangeVkCode, fetchVkProfile, type VkLogger } from './vk.js';
import {
  TelegramNotConfiguredError,
  fetchTelegramProfilePhoto,
  verifyTelegramInitData,
  type TelegramLogger,
  type VerifiedTelegramUser,
} from './telegram.js';
import { AVATAR_MAX_BYTES } from '@zybrilka/shared';

export { EmailNotConfiguredError } from './email.js';
export { VkNotConfiguredError, VkRequestError, isVkConfigured } from './vk.js';
export { TelegramAuthError, TelegramNotConfiguredError, isTelegramConfigured } from './telegram.js';

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

/** Assembles the `AuthUser` the API/client sees for a user id — every
 * field read from the database (display profile with the priority rules
 * already applied, linked email, and whether the saved learning profile
 * says onboarding is finished). */
export async function loadAuthUser(db: Database, userId: string): Promise<AuthUser> {
  const [email, profile, onboardingCompleted] = await Promise.all([
    repo.getUserEmail(db, userId),
    resolveProfile(db, userId),
    isOnboardingCompleted(db, userId),
  ]);
  return { id: userId, email, ...profile, onboardingCompleted };
}

export interface LoginResult {
  sessionId: string;
  sessionExpiresAt: Date;
  user: AuthUser;
  /** True only when this very sign-in created the account. */
  created: boolean;
}

/** Verifies the token, creates/resolves the `users` row for this
 * email, and opens a new session. */
export async function verifyMagicLink(db: Database, token: string): Promise<LoginResult> {
  const tokenHash = hashToken(token);
  const found = await repo.findValidMagicLinkToken(db, tokenHash);
  if (!found) throw new InvalidMagicLinkError();

  const { userId, created } = await repo.findOrCreateUserByIdentity(db, 'email', found.email);
  await repo.consumeMagicLinkToken(db, found.id);

  const sessionExpiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const sessionId = await repo.createSession(db, userId, sessionExpiresAt);
  return { sessionId, sessionExpiresAt, user: await loadAuthUser(db, userId), created };
}

/** A fresh session for an already-identified user (the Telegram Mini App
 * claiming a completed VK handoff — see handoff.ts). */
export async function openSessionFor(db: Database, userId: string): Promise<LoginResult> {
  const session = await startSession(db, userId);
  return { ...session, user: await loadAuthUser(db, userId), created: false };
}

async function startSession(
  db: Database,
  userId: string,
): Promise<{ sessionId: string; sessionExpiresAt: Date }> {
  const sessionExpiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const sessionId = await repo.createSession(db, userId, sessionExpiresAt);
  return { sessionId, sessionExpiresAt };
}

/** Exchanges the VK authorization code for VK's user id (plus, best
 * effort, name/avatar), then find-or-creates the `users` row, refreshes
 * its provider profile (never the user's own name/avatar), and opens a
 * session — mirrors `verifyMagicLink`'s shape so the route can treat both
 * uniformly. Identity, name and avatar all come from VK's server-to-server
 * responses for this code; nothing client-supplied is trusted. */
export async function completeVkLogin(
  db: Database,
  config: Config,
  code: string,
  deviceId: string,
  codeVerifier: string,
  log?: VkLogger,
): Promise<LoginResult> {
  const { vkUserId, accessToken } = await exchangeVkCode(config, code, deviceId, codeVerifier);
  const { userId, created } = await repo.findOrCreateUserByIdentity(db, 'vk', vkUserId);

  if (accessToken) {
    await profileRepo.applyProviderProfile(
      db,
      userId,
      'vk',
      await fetchVkProfile(config, accessToken, log),
    );
  }

  const session = await startSession(db, userId);
  return { ...session, user: await loadAuthUser(db, userId), created };
}

export type LinkOutcome = 'linked' | 'already_linked' | 'taken' | 'provider_already_used';

/**
 * Adds VK as another sign-in method of the ALREADY signed-in `userId`
 * (the route passes the session's user, never anything from the URL). The
 * VK account is proven the same way as for a login: a code exchanged
 * server-side. An identity owned by a different account is refused, never
 * moved; no session is created or replaced, no account is created or merged.
 */
export async function completeVkLink(
  db: Database,
  config: Config,
  userId: string,
  code: string,
  deviceId: string,
  codeVerifier: string,
  log?: VkLogger,
): Promise<LinkOutcome> {
  const { vkUserId, accessToken } = await exchangeVkCode(config, code, deviceId, codeVerifier);
  const outcome = await profileRepo.addIdentity(db, userId, 'vk', vkUserId);
  if ((outcome === 'linked' || outcome === 'already_linked') && accessToken) {
    await profileRepo.applyProviderProfile(
      db,
      userId,
      'vk',
      await fetchVkProfile(config, accessToken, log),
    );
  }
  return outcome;
}

// ---------------------------------------------------------------- Telegram

/** Signed in already, and this Telegram account is not linked to anyone:
 * a new account must not be created behind the user's back. */
export class TelegramNotLinkedError extends Error {
  constructor() {
    super('This Telegram account is not linked to any account');
  }
}

async function adoptTelegramProfile(
  db: Database,
  config: Config,
  userId: string,
  tg: VerifiedTelegramUser,
  log?: TelegramLogger,
): Promise<void> {
  await profileRepo.applyProviderProfile(db, userId, 'telegram', {
    firstName: tg.firstName,
    lastName: tg.lastName,
    avatarUrl: tg.photoUrl,
  });

  // The signed launch data usually includes a photo URL. When it doesn't,
  // ask Telegram through the bot (best effort) — once, not at every login.
  if (tg.photoUrl || !config.TELEGRAM_BOT_TOKEN) return;
  const existing = await profileRepo.listAvatarMeta(db, userId);
  if (existing.some((avatar) => avatar.source === 'telegram')) return;
  const bytes = await fetchTelegramProfilePhoto(config.TELEGRAM_BOT_TOKEN, tg.id, {
    maxBytes: AVATAR_MAX_BYTES,
    log,
  });
  if (!bytes) return;
  const stored = await storeAvatar(db, userId, 'telegram', bytes);
  if (!stored.ok) {
    log?.warn({ tgPhoto: stored.problem }, 'Telegram profile photo was not a usable image');
  }
}

function verifyLaunch(config: Config, initData: string): VerifiedTelegramUser {
  if (!config.TELEGRAM_BOT_TOKEN) throw new TelegramNotConfiguredError();
  return verifyTelegramInitData(initData, config.TELEGRAM_BOT_TOKEN, {
    maxAgeSeconds: config.TELEGRAM_AUTH_MAX_AGE_SECONDS,
  });
}

/**
 * Signs in (or registers) a Telegram Mini App user. Authenticity comes only
 * from the HMAC check of the raw `initData` against the server-side bot
 * token; the numeric Telegram user id inside it is the identity key.
 * - known Telegram id → that account;
 * - unknown id and nobody is signed in → a new account (first launch);
 * - unknown id while another account is signed in → refuse
 *   (`TelegramNotLinkedError`); linking is an explicit action in the profile.
 */
export async function completeTelegramLogin(
  db: Database,
  config: Config,
  initData: string,
  options: { currentUserId: string | null; log?: TelegramLogger },
): Promise<LoginResult> {
  const tg = verifyLaunch(config, initData);

  let userId = await repo.findUserIdByIdentity(db, 'telegram', tg.id);
  let created = false;
  if (!userId) {
    if (options.currentUserId) throw new TelegramNotLinkedError();
    ({ userId, created } = await repo.findOrCreateUserByIdentity(db, 'telegram', tg.id));
  }

  await adoptTelegramProfile(db, config, userId, tg, options.log);

  const session = await startSession(db, userId);
  return { ...session, user: await loadAuthUser(db, userId), created };
}

/** Adds Telegram to the signed-in `userId`, after the same signature check. */
export async function linkTelegramIdentity(
  db: Database,
  config: Config,
  userId: string,
  initData: string,
  log?: TelegramLogger,
): Promise<LinkOutcome> {
  const tg = verifyLaunch(config, initData);
  const outcome = await profileRepo.addIdentity(db, userId, 'telegram', tg.id);
  if (outcome === 'linked' || outcome === 'already_linked') {
    await adoptTelegramProfile(db, config, userId, tg, log);
  }
  return outcome;
}

export async function getCurrentUser(db: Database, sessionId: string): Promise<AuthUser | null> {
  const userId = await repo.getSessionUserId(db, sessionId);
  if (!userId) return null;
  return loadAuthUser(db, userId);
}

export async function logout(db: Database, sessionId: string): Promise<void> {
  await repo.deleteSession(db, sessionId);
}
