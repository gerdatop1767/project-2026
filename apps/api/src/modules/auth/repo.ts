import type { Database } from '@zybrilka/db';
import { schema } from '@zybrilka/db';
import { and, desc, eq, isNull, ne } from 'drizzle-orm';

/** Finds the user already linked to this (provider, providerUserId)
 * identity, or creates a fresh `users` row and links it — the usual
 * "find or create" for a first-time VK/email sign-in. `created` is true
 * only for the request that actually created the account (server-side
 * truth for "first registration"). Safe against two concurrent
 * first sign-ins for the same identity (double-clicked callback, two
 * tabs): the unique (provider, providerUserId) index lets exactly one
 * insert win; the loser removes its own just-created, still-unreferenced
 * `users` row and resolves to the winner's account — never a duplicate
 * account, never a leftover orphan. */
export async function findOrCreateUserByIdentity(
  db: Database,
  provider: (typeof schema.authProviders)[number],
  providerUserId: string,
): Promise<{ userId: string; created: boolean }> {
  const find = async (executor: Pick<Database, 'select'>) => {
    const [row] = await executor
      .select({ userId: schema.authIdentities.userId })
      .from(schema.authIdentities)
      .where(
        and(
          eq(schema.authIdentities.provider, provider),
          eq(schema.authIdentities.providerUserId, providerUserId),
        ),
      );
    return row?.userId;
  };

  const existing = await find(db);
  if (existing) return { userId: existing, created: false };

  return db.transaction(async (tx) => {
    const [user] = await tx.insert(schema.users).values({}).returning({ id: schema.users.id });
    const [identity] = await tx
      .insert(schema.authIdentities)
      .values({ userId: user!.id, provider, providerUserId })
      .onConflictDoNothing({
        target: [schema.authIdentities.provider, schema.authIdentities.providerUserId],
      })
      .returning({ id: schema.authIdentities.id });
    if (identity) return { userId: user!.id, created: true };

    await tx.delete(schema.users).where(eq(schema.users.id, user!.id));
    const winner = await find(tx);
    if (!winner) throw new Error('auth identity vanished during find-or-create');
    return { userId: winner, created: false };
  });
}

/** The account an identity belongs to, or null if nobody has it yet. */
export async function findUserIdByIdentity(
  db: Database,
  provider: (typeof schema.authProviders)[number],
  providerUserId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ userId: schema.authIdentities.userId })
    .from(schema.authIdentities)
    .where(
      and(
        eq(schema.authIdentities.provider, provider),
        eq(schema.authIdentities.providerUserId, providerUserId),
      ),
    );
  return row?.userId ?? null;
}

export async function getUserEmail(db: Database, userId: string): Promise<string | null> {
  const [row] = await db
    .select({ providerUserId: schema.authIdentities.providerUserId })
    .from(schema.authIdentities)
    .where(
      and(eq(schema.authIdentities.userId, userId), eq(schema.authIdentities.provider, 'email')),
    );
  return row?.providerUserId ?? null;
}

/** Stores a magic-link token by its hash only — see schema.ts's
 * `magicLinkTokens` doc comment for why the raw token is never
 * persisted. */
export async function createMagicLinkToken(
  db: Database,
  email: string,
  tokenHash: string,
  expiresAt: Date,
): Promise<void> {
  await db.insert(schema.magicLinkTokens).values({ email, tokenHash, expiresAt });
}

/** Looks up an unconsumed, unexpired token by its hash. Does NOT mark
 * it consumed — call `consumeMagicLinkToken` after this succeeds, so a
 * failed downstream step (e.g. user creation) can still be retried
 * with the same link rather than burning it on a transient error. */
export async function findValidMagicLinkToken(
  db: Database,
  tokenHash: string,
): Promise<{ id: string; email: string; expiresAt: Date } | null> {
  const [row] = await db
    .select({
      id: schema.magicLinkTokens.id,
      email: schema.magicLinkTokens.email,
      expiresAt: schema.magicLinkTokens.expiresAt,
    })
    .from(schema.magicLinkTokens)
    .where(
      and(
        eq(schema.magicLinkTokens.tokenHash, tokenHash),
        isNull(schema.magicLinkTokens.consumedAt),
        // Registration/reset links are never accepted as a sign-in link.
        eq(schema.magicLinkTokens.purpose, 'sign_in'),
      ),
    );
  if (!row) return null;
  if (row.expiresAt.getTime() < Date.now()) return null;
  return row;
}

export async function consumeMagicLinkToken(db: Database, id: string): Promise<void> {
  await db
    .update(schema.magicLinkTokens)
    .set({ consumedAt: new Date() })
    .where(eq(schema.magicLinkTokens.id, id));
}

export async function createSession(
  db: Database,
  userId: string,
  expiresAt: Date,
): Promise<string> {
  const [row] = await db
    .insert(schema.authSessions)
    .values({ userId, expiresAt })
    .returning({ id: schema.authSessions.id });
  return row!.id;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getSessionUserId(db: Database, sessionId: string): Promise<string | null> {
  // The id column is a uuid: a cookie that isn't one (tampered, truncated)
  // must read as "no session", not reach Postgres and surface as a 500.
  if (!UUID_PATTERN.test(sessionId)) return null;
  const [row] = await db
    .select({ userId: schema.authSessions.userId, expiresAt: schema.authSessions.expiresAt })
    .from(schema.authSessions)
    .where(eq(schema.authSessions.id, sessionId));
  if (!row) return null;
  if (row.expiresAt.getTime() < Date.now()) return null;
  return row.userId;
}

export async function deleteSession(db: Database, sessionId: string): Promise<void> {
  if (!UUID_PATTERN.test(sessionId)) return;
  await db.delete(schema.authSessions).where(eq(schema.authSessions.id, sessionId));
}

// ------------------------------------------------- email + password tokens

export type EmailTokenPurpose = (typeof schema.emailTokenPurposes)[number];

export interface EmailTokenRow {
  id: string;
  email: string;
  purpose: EmailTokenPurpose;
  passwordHash: string | null;
  userId: string | null;
  expiresAt: Date;
  consumedAt: Date | null;
}

const emailTokenColumns = {
  id: schema.magicLinkTokens.id,
  email: schema.magicLinkTokens.email,
  purpose: schema.magicLinkTokens.purpose,
  passwordHash: schema.magicLinkTokens.passwordHash,
  userId: schema.magicLinkTokens.userId,
  expiresAt: schema.magicLinkTokens.expiresAt,
  consumedAt: schema.magicLinkTokens.consumedAt,
};

export async function createEmailToken(
  db: Database,
  input: {
    email: string;
    purpose: EmailTokenPurpose;
    tokenHash: string;
    expiresAt: Date;
    passwordHash?: string | null;
    userId?: string | null;
  },
): Promise<string> {
  const [row] = await db
    .insert(schema.magicLinkTokens)
    .values(input)
    .returning({ id: schema.magicLinkTokens.id });
  return row!.id;
}

/** A token that failed to go out by email is withdrawn (never user data). */
export async function deleteEmailToken(db: Database, id: string): Promise<void> {
  await db.delete(schema.magicLinkTokens).where(eq(schema.magicLinkTokens.id, id));
}

/** Looks a token up by hash in ANY state, so the caller can tell
 * "expired" from "already used" from "never existed". */
export async function findEmailToken(
  db: Database,
  tokenHash: string,
): Promise<EmailTokenRow | null> {
  const [row] = await db
    .select(emailTokenColumns)
    .from(schema.magicLinkTokens)
    .where(eq(schema.magicLinkTokens.tokenHash, tokenHash));
  return row ?? null;
}

/** The newest not-yet-used registration for an address (expired or not). */
export async function findLatestPendingRegistration(
  db: Database,
  email: string,
): Promise<EmailTokenRow | null> {
  const [row] = await db
    .select(emailTokenColumns)
    .from(schema.magicLinkTokens)
    .where(
      and(
        eq(schema.magicLinkTokens.email, email),
        eq(schema.magicLinkTokens.purpose, 'register'),
        isNull(schema.magicLinkTokens.consumedAt),
      ),
    )
    .orderBy(desc(schema.magicLinkTokens.createdAt))
    .limit(1);
  return row ?? null;
}

/** Marks the token used — atomically: true only for the one caller that
 * actually consumed it (a double click or a replay gets false). */
export async function consumeEmailToken(db: Database, id: string): Promise<boolean> {
  const rows = await db
    .update(schema.magicLinkTokens)
    .set({ consumedAt: new Date() })
    .where(and(eq(schema.magicLinkTokens.id, id), isNull(schema.magicLinkTokens.consumedAt)))
    .returning({ id: schema.magicLinkTokens.id });
  return rows.length > 0;
}

/** After a password change, every other reset link for the account dies. */
export async function consumeOtherResetTokens(
  db: Database,
  userId: string,
  keepId: string,
): Promise<void> {
  await db
    .update(schema.magicLinkTokens)
    .set({ consumedAt: new Date() })
    .where(
      and(
        eq(schema.magicLinkTokens.userId, userId),
        eq(schema.magicLinkTokens.purpose, 'reset_password'),
        isNull(schema.magicLinkTokens.consumedAt),
        ne(schema.magicLinkTokens.id, keepId),
      ),
    );
}

export async function getPasswordHash(db: Database, userId: string): Promise<string | null> {
  const [row] = await db
    .select({ passwordHash: schema.emailCredentials.passwordHash })
    .from(schema.emailCredentials)
    .where(eq(schema.emailCredentials.userId, userId));
  return row?.passwordHash ?? null;
}

export async function setPasswordHash(
  db: Database,
  userId: string,
  passwordHash: string,
): Promise<void> {
  await db
    .insert(schema.emailCredentials)
    .values({ userId, passwordHash })
    .onConflictDoUpdate({
      target: schema.emailCredentials.userId,
      set: { passwordHash, updatedAt: new Date() },
    });
}

/** Signs the account out everywhere (after a password reset). */
export async function deleteSessionsOfUser(db: Database, userId: string): Promise<void> {
  await db.delete(schema.authSessions).where(eq(schema.authSessions.userId, userId));
}
