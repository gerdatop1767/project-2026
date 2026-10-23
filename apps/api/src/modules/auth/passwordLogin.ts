import type { Database } from '@zybrilka/db';
import { dummyPasswordHash, verifyPassword } from './password.js';
import * as repo from './repo.js';
import { openSessionFor, type LoginResult } from './service.js';

/**
 * Email + password sign-in for accounts that ALREADY have a password
 * (docs/YANDEX_ID.md, "Аккаунты с почтой"). Registration, confirmation
 * letters and password reset were removed together with SMTP; this needs
 * no mail at all and only reads `auth_identities` + `email_credentials`.
 */
export class InvalidCredentialsError extends Error {}

/** One error, and roughly the same time, for an unknown address, an
 * account without a password and a wrong password. */
export async function loginWithPassword(
  db: Database,
  rawEmail: string,
  password: string,
): Promise<LoginResult> {
  const email = rawEmail.trim().toLowerCase();
  const userId = await repo.findUserIdByIdentity(db, 'email', email);
  const stored = userId ? await repo.getPasswordHash(db, userId) : null;
  const ok = await verifyPassword(password, stored ?? (await dummyPasswordHash()));
  if (!ok || !userId || !stored) throw new InvalidCredentialsError();
  return openSessionFor(db, userId);
}
