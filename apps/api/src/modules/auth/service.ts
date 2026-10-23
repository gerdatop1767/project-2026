import type { Database } from '@zybrilka/db';
import type { AuthUser } from '@zybrilka/shared';
import type { Config } from '../../config.js';
import * as repo from './repo.js';
import { isOnboardingCompleted } from '../learningProfile/repo.js';
import * as profileRepo from '../profile/repo.js';
import { resolveProfile, storeAvatar } from '../profile/service.js';
import { exchangeVkCode, fetchVkProfile, type VkLogger } from './vk.js';
import { exchangeYandexCode, fetchYandexUser, type YandexUser } from './yandex.js';
import {
  TelegramNotConfiguredError,
  fetchTelegramProfilePhoto,
  verifyTelegramInitData,
  type TelegramLogger,
  type VerifiedTelegramUser,
} from './telegram.js';
import { AVATAR_MAX_BYTES } from '@zybrilka/shared';
import { cacheProviderAvatar } from '../profile/providerAvatar.js';

export { VkNotConfiguredError, VkRequestError, isVkConfigured } from './vk.js';
export { TelegramAuthError, TelegramNotConfiguredError, isTelegramConfigured } from './telegram.js';
export { YandexNotConfiguredError, YandexRequestError, isYandexConfigured } from './yandex.js';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

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
 * session — the same `LoginResult` shape as every other sign-in. Identity, name and avatar all come from VK's server-to-server
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
    const profile = await fetchVkProfile(config, accessToken, log);
    await profileRepo.applyProviderProfile(db, userId, 'vk', profile);
    // In the background: never makes the sign-in wait on VK's image CDN.
    void cacheProviderAvatar(db, userId, 'vk', profile.avatarUrl, log);
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
    const profile = await fetchVkProfile(config, accessToken, log);
    await profileRepo.applyProviderProfile(db, userId, 'vk', profile);
    void cacheProviderAvatar(db, userId, 'vk', profile.avatarUrl, log);
  }
  return outcome;
}

// ------------------------------------------------------------------ Yandex

/**
 * A Yandex account with no Zybrilka account yet, whose email (as Yandex
 * reports it) is already the email sign-in of an existing account. We do
 * NOT merge on a matching address, and we do not silently open a second
 * account for the same person either: they sign in to the existing account
 * and connect Yandex in the profile (an explicit, signed-in link).
 */
export class YandexEmailInUseError extends Error {
  constructor() {
    super('This Yandex email already belongs to an existing account');
  }
}

async function adoptYandexProfile(db: Database, userId: string, ya: YandexUser): Promise<void> {
  await profileRepo.applyProviderProfile(db, userId, 'yandex', {
    firstName: ya.firstName,
    lastName: ya.lastName,
    avatarUrl: ya.avatarUrl,
  });
}

/**
 * Sign-in / first registration with Yandex ID. The identity is Yandex's own
 * user id from the server-to-server `login.yandex.ru/info` response for the
 * code exchanged here — nothing the browser sends is trusted.
 * - known Yandex id → that account (same account on every later sign-in);
 * - unknown id, email already used by an email account → refuse
 *   (`YandexEmailInUseError`), never merge;
 * - unknown id otherwise → a new account.
 */
export async function completeYandexLogin(
  db: Database,
  config: Config,
  code: string,
  codeVerifier: string,
): Promise<LoginResult> {
  const token = await exchangeYandexCode(config, code, codeVerifier);
  const ya = await fetchYandexUser(config, token);

  let userId = await repo.findUserIdByIdentity(db, 'yandex', ya.id);
  let created = false;
  if (!userId) {
    if (ya.email && (await repo.findUserIdByIdentity(db, 'email', ya.email))) {
      throw new YandexEmailInUseError();
    }
    ({ userId, created } = await repo.findOrCreateUserByIdentity(db, 'yandex', ya.id));
  }
  await adoptYandexProfile(db, userId, ya);
  const session = await startSession(db, userId);
  return { ...session, user: await loadAuthUser(db, userId), created };
}

/** Adds Yandex to the ALREADY signed-in `userId` (taken from the session by
 * the route). Proven the same way as a sign-in; never moves an identity
 * owned by another account, never merges, never opens a session. */
export async function completeYandexLink(
  db: Database,
  config: Config,
  userId: string,
  code: string,
  codeVerifier: string,
): Promise<LinkOutcome> {
  const token = await exchangeYandexCode(config, code, codeVerifier);
  const ya = await fetchYandexUser(config, token);
  const outcome = await profileRepo.addIdentity(db, userId, 'yandex', ya.id);
  if (outcome === 'linked' || outcome === 'already_linked')
    await adoptYandexProfile(db, userId, ya);
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

  // The signed launch data usually includes a photo URL (on t.me): keep our
  // own copy of it, in the background, so it never has to be loaded from
  // t.me again. When there is none, ask Telegram through the bot (best
  // effort) — once, not at every login.
  if (tg.photoUrl) {
    void cacheProviderAvatar(db, userId, 'telegram', tg.photoUrl, log);
    return;
  }
  if (!config.TELEGRAM_BOT_TOKEN) return;
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
