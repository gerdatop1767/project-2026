import { createHash, randomBytes } from 'node:crypto';
import type { Database } from '@zybrilka/db';
import { passwordProblem, type PasswordProblem } from '@zybrilka/shared';
import type { Config } from '../../config.js';
import {
  EmailNotConfiguredError,
  accountExistsEmail,
  isEmailConfigured,
  noAccountEmail,
  registrationEmail,
  resetPasswordEmail,
  sendEmail,
  type OutgoingEmail,
} from './email.js';
import type { EmailThrottle } from './emailThrottle.js';
import { dummyPasswordHash, hashPassword, verifyPassword } from './password.js';
import * as repo from './repo.js';
import { openSessionFor, type LoginResult } from './service.js';

/**
 * Email + password accounts (docs/EMAIL_AUTH.md).
 *
 * - Registration creates nothing but a pending, hashed, 24-hour link; the
 *   account (users + auth_identities 'email' + email_credentials) appears
 *   only when that link is opened — so an address can't be squatted
 *   without access to its mailbox, and unconfirmed sign-ups leave no users.
 * - An address that already has an account (from the passwordless link,
 *   or an earlier registration) is never given a password by registration:
 *   its owner gets a letter with a password-reset link instead. The screen
 *   says the same thing in both cases.
 * - Accounts are never merged: an email registration can only create a new
 *   account or point to the existing one for that same address.
 * - Every token is random (256 bits), stored only as a SHA-256 hash,
 *   single-use, short-lived and bound to one purpose.
 */

export const REGISTER_TTL_MS = 24 * 60 * 60 * 1000;
export const RESET_TTL_MS = 60 * 60 * 1000;

export class PasswordRejectedError extends Error {
  constructor(readonly problem: PasswordProblem) {
    super(`password rejected: ${problem}`);
  }
}
export class ThrottledError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super('too many letters for this address');
  }
}
export class TokenInvalidError extends Error {}
export class TokenExpiredError extends Error {}
export class AlreadyRegisteredError extends Error {}
export class InvalidCredentialsError extends Error {}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function newToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashToken(token) };
}

function webLink(config: Config, param: string, token: string): string {
  const url = new URL('/login', config.WEB_BASE_URL);
  url.searchParams.set(param, token);
  return url.toString();
}

/**
 * Reserves a letter for `email`, stores the token, sends — and undoes both
 * the reservation and the token if sending fails, so the user can retry at
 * once and a link that never went out can never be used.
 */
async function sendWithToken(
  db: Database,
  config: Config,
  throttle: EmailThrottle,
  email: string,
  /** null = nothing to send (the slot stays taken, so the outside looks the same). */
  build: () => Promise<{ tokenId: string | null; message: OutgoingEmail } | null>,
): Promise<void> {
  if (!isEmailConfigured(config)) throw new EmailNotConfiguredError();
  const key = `mail:${email}`;
  const slot = throttle.take(key);
  if (!slot.ok) throw new ThrottledError(slot.retryAfterSeconds);
  let tokenId: string | null = null;
  try {
    const built = await build();
    if (!built) return;
    tokenId = built.tokenId;
    await sendEmail(config, built.message);
  } catch (error) {
    throttle.release(key);
    if (tokenId) await repo.deleteEmailToken(db, tokenId);
    throw error;
  }
}

/** POST /auth/register. Resolves the same way whether or not the address
 * already has an account; only the letter differs. */
export async function register(
  db: Database,
  config: Config,
  throttle: EmailThrottle,
  rawEmail: string,
  password: string,
): Promise<void> {
  const email = normalizeEmail(rawEmail);
  const problem = passwordProblem(password, email);
  if (problem) throw new PasswordRejectedError(problem);
  await sendWithToken(db, config, throttle, email, async () => {
    // Hashed in both branches, so the response takes as long either way.
    const passwordHash = await hashPassword(password);
    const existing = await repo.findUserIdByIdentity(db, 'email', email);
    const { token, tokenHash } = newToken();
    if (existing) {
      const tokenId = await repo.createEmailToken(db, {
        email,
        purpose: 'reset_password',
        tokenHash,
        userId: existing,
        expiresAt: new Date(Date.now() + RESET_TTL_MS),
      });
      return {
        tokenId,
        message: accountExistsEmail(email, webLink(config, 'reset', token), RESET_TTL_MS / 60_000),
      };
    }
    const tokenId = await repo.createEmailToken(db, {
      email,
      purpose: 'register',
      tokenHash,
      passwordHash,
      expiresAt: new Date(Date.now() + REGISTER_TTL_MS),
    });
    return {
      tokenId,
      message: registrationEmail(
        email,
        webLink(config, 'confirm', token),
        REGISTER_TTL_MS / 3_600_000,
      ),
    };
  });
}

/** POST /auth/register/resend: a new confirmation link for a registration
 * still waiting for one — found by address or by an old (even expired)
 * link. Nothing is sent when there is no such registration; the response
 * does not say which. */
export async function resendConfirmation(
  db: Database,
  config: Config,
  throttle: EmailThrottle,
  input: { email: string } | { token: string },
): Promise<void> {
  let pending: repo.EmailTokenRow | null;
  let email: string;
  if ('token' in input) {
    const row = await repo.findEmailToken(db, hashToken(input.token));
    pending = row && row.purpose === 'register' && !row.consumedAt ? row : null;
    // Unknown token: throttle on the token itself, still answer "ok".
    email = pending?.email ?? `token:${hashToken(input.token)}`;
  } else {
    email = normalizeEmail(input.email);
    pending = await repo.findLatestPendingRegistration(db, email);
  }
  await sendWithToken(db, config, throttle, email, async () => {
    if (!pending?.passwordHash) return null;
    // Confirmed in the meantime: nothing to resend.
    if (await repo.findUserIdByIdentity(db, 'email', pending.email)) return null;
    const { token, tokenHash } = newToken();
    const tokenId = await repo.createEmailToken(db, {
      email: pending.email,
      purpose: 'register',
      tokenHash,
      passwordHash: pending.passwordHash,
      expiresAt: new Date(Date.now() + REGISTER_TTL_MS),
    });
    return {
      tokenId,
      message: registrationEmail(
        pending.email,
        webLink(config, 'confirm', token),
        REGISTER_TTL_MS / 3_600_000,
      ),
    };
  });
}

async function usableToken(
  db: Database,
  token: string,
  purpose: repo.EmailTokenPurpose,
): Promise<repo.EmailTokenRow> {
  const row = await repo.findEmailToken(db, hashToken(token));
  if (!row || row.purpose !== purpose || row.consumedAt) throw new TokenInvalidError();
  if (row.expiresAt.getTime() < Date.now()) throw new TokenExpiredError();
  return row;
}

/** POST /auth/register/confirm: creates the account and signs it in. */
export async function confirmRegistration(db: Database, token: string): Promise<LoginResult> {
  const row = await usableToken(db, token, 'register');
  const userId = await db.transaction(async (tx) => {
    if (!(await repo.consumeEmailToken(tx, row.id))) throw new TokenInvalidError();
    const { userId: id, created } = await repo.findOrCreateUserByIdentity(tx, 'email', row.email);
    if (!created) throw new AlreadyRegisteredError();
    await repo.setPasswordHash(tx, id, row.passwordHash!);
    return id;
  });
  return { ...(await openSessionFor(db, userId)), created: true };
}

/** POST /auth/login. Same error and roughly the same time for an unknown
 * address, an account without a password and a wrong password. */
export async function loginWithPassword(
  db: Database,
  rawEmail: string,
  password: string,
): Promise<LoginResult> {
  const email = normalizeEmail(rawEmail);
  const userId = await repo.findUserIdByIdentity(db, 'email', email);
  const stored = userId ? await repo.getPasswordHash(db, userId) : null;
  const ok = await verifyPassword(password, stored ?? (await dummyPasswordHash()));
  if (!ok || !userId || !stored) throw new InvalidCredentialsError();
  return openSessionFor(db, userId);
}

/** POST /auth/password/forgot. Always sends one letter to the address
 * (a reset link, or "no account here"), so the answer and its timing are
 * the same whether or not it is registered. */
export async function forgotPassword(
  db: Database,
  config: Config,
  throttle: EmailThrottle,
  rawEmail: string,
): Promise<void> {
  const email = normalizeEmail(rawEmail);
  await sendWithToken(db, config, throttle, email, async () => {
    const userId = await repo.findUserIdByIdentity(db, 'email', email);
    if (!userId) {
      const register = new URL('/login', config.WEB_BASE_URL);
      register.searchParams.set('mode', 'register');
      return { tokenId: null, message: noAccountEmail(email, register.toString()) };
    }
    const { token, tokenHash } = newToken();
    const tokenId = await repo.createEmailToken(db, {
      email,
      purpose: 'reset_password',
      tokenHash,
      userId,
      expiresAt: new Date(Date.now() + RESET_TTL_MS),
    });
    return {
      tokenId,
      message: resetPasswordEmail(email, webLink(config, 'reset', token), RESET_TTL_MS / 60_000),
    };
  });
}

/** POST /auth/password/reset/check — lets the page say "expired" before
 * the user types a new password. Uses nothing up. */
export async function checkResetToken(db: Database, token: string): Promise<void> {
  const row = await usableToken(db, token, 'reset_password');
  await assertResetTarget(db, row);
}

async function assertResetTarget(db: Database, row: repo.EmailTokenRow): Promise<string> {
  // The address must still belong to the account the link was made for.
  const owner = await repo.findUserIdByIdentity(db, 'email', row.email);
  if (!row.userId || owner !== row.userId) throw new TokenInvalidError();
  return row.userId;
}

/** POST /auth/password/reset: sets the password, ends every other session
 * of the account, kills its other reset links, and signs this browser in. */
export async function resetPassword(
  db: Database,
  token: string,
  password: string,
): Promise<LoginResult> {
  const row = await usableToken(db, token, 'reset_password');
  const problem = passwordProblem(password, row.email);
  if (problem) throw new PasswordRejectedError(problem);
  const userId = await assertResetTarget(db, row);
  const passwordHash = await hashPassword(password);
  await db.transaction(async (tx) => {
    if (!(await repo.consumeEmailToken(tx, row.id))) throw new TokenInvalidError();
    await repo.setPasswordHash(tx, userId, passwordHash);
    await repo.consumeOtherResetTokens(tx, userId, row.id);
    await repo.deleteSessionsOfUser(tx, userId);
  });
  return openSessionFor(db, userId);
}
