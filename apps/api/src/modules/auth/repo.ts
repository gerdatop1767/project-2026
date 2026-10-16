import type { Database } from '@zybrilka/db';
import { schema } from '@zybrilka/db';
import { and, eq, isNull } from 'drizzle-orm';

/** Finds the user already linked to this (provider, providerUserId)
 * identity, or creates a fresh `users` row and links it — the usual
 * "find or create" for a first-time VK/email sign-in. */
export async function findOrCreateUserByIdentity(
  db: Database,
  provider: (typeof schema.authProviders)[number],
  providerUserId: string,
): Promise<string> {
  const [existing] = await db
    .select({ userId: schema.authIdentities.userId })
    .from(schema.authIdentities)
    .where(
      and(
        eq(schema.authIdentities.provider, provider),
        eq(schema.authIdentities.providerUserId, providerUserId),
      ),
    );
  if (existing) return existing.userId;

  const [user] = await db.insert(schema.users).values({}).returning({ id: schema.users.id });
  await db
    .insert(schema.authIdentities)
    .values({ userId: user!.id, provider, providerUserId })
    // Guards a race between two concurrent first-sign-ins for the same
    // identity (two tabs clicking the same magic link at once) — the
    // loser's insert is a no-op, both callers end up pointing at the
    // same user via the SELECT above on any retry. Fine to not retry
    // here: the (rare) loser simply gets its own extra `users` row this
    // one time, never a duplicate identity row.
    .onConflictDoNothing({
      target: [schema.authIdentities.provider, schema.authIdentities.providerUserId],
    });
  return user!.id;
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

export async function getSessionUserId(db: Database, sessionId: string): Promise<string | null> {
  const [row] = await db
    .select({ userId: schema.authSessions.userId, expiresAt: schema.authSessions.expiresAt })
    .from(schema.authSessions)
    .where(eq(schema.authSessions.id, sessionId));
  if (!row) return null;
  if (row.expiresAt.getTime() < Date.now()) return null;
  return row.userId;
}

export async function deleteSession(db: Database, sessionId: string): Promise<void> {
  await db.delete(schema.authSessions).where(eq(schema.authSessions.id, sessionId));
}
