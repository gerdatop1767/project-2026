import { and, eq } from 'drizzle-orm';
import type { Database } from './client.js';
import * as schema from './schema.js';

export type IdentityProvider = (typeof schema.authProviders)[number];
export type AddIdentityOutcome = 'linked' | 'already_linked' | 'taken' | 'provider_already_used';

/** The database or an open transaction (drizzle's `tx` has the same API). */
type Executor = Pick<Database, 'select' | 'insert' | 'update' | 'delete' | 'execute'>;

/**
 * Attaches (provider, providerUserId) to `userId` — and ONLY ever to that
 * user; an identity owned by someone else is never moved.
 * - 'linked': new row for this user;
 * - 'already_linked': this exact identity already belongs to this user;
 * - 'taken': it belongs to a different account;
 * - 'provider_already_used': this user already holds a DIFFERENT account of
 *   the same provider (one VK / one Telegram per account).
 * The unique (provider, providerUserId) index is the final arbiter under
 * concurrency: the loser of a race re-reads the owner and reports 'taken'.
 * Runs inside the caller's transaction.
 */
export async function addIdentityIn(
  tx: Executor,
  userId: string,
  provider: IdentityProvider,
  providerUserId: string,
): Promise<AddIdentityOutcome> {
  const owned = await tx
    .select({ userId: schema.authIdentities.userId })
    .from(schema.authIdentities)
    .where(
      and(
        eq(schema.authIdentities.provider, provider),
        eq(schema.authIdentities.providerUserId, providerUserId),
      ),
    );
  if (owned[0]) return owned[0].userId === userId ? 'already_linked' : 'taken';

  const mine = await tx
    .select({ id: schema.authIdentities.id })
    .from(schema.authIdentities)
    .where(
      and(eq(schema.authIdentities.userId, userId), eq(schema.authIdentities.provider, provider)),
    );
  if (mine.length > 0) return 'provider_already_used';

  const inserted = await tx
    .insert(schema.authIdentities)
    .values({ userId, provider, providerUserId })
    .onConflictDoNothing({
      target: [schema.authIdentities.provider, schema.authIdentities.providerUserId],
    })
    .returning({ id: schema.authIdentities.id });
  if (inserted.length > 0) return 'linked';

  // Lost a race against another request linking the same identity.
  const [winner] = await tx
    .select({ userId: schema.authIdentities.userId })
    .from(schema.authIdentities)
    .where(
      and(
        eq(schema.authIdentities.provider, provider),
        eq(schema.authIdentities.providerUserId, providerUserId),
      ),
    );
  return winner?.userId === userId ? 'already_linked' : 'taken';
}

export function addIdentity(
  db: Database,
  userId: string,
  provider: IdentityProvider,
  providerUserId: string,
): Promise<AddIdentityOutcome> {
  return db.transaction((tx) => addIdentityIn(tx, userId, provider, providerUserId));
}
