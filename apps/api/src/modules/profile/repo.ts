import type { Database } from '@zybrilka/db';
import { schema } from '@zybrilka/db';
import { isWorkingSignInMethod, type LinkableProvider } from '@zybrilka/shared';
import { and, asc, eq } from 'drizzle-orm';

export type AvatarSource = (typeof schema.avatarSources)[number];
export type Provider = (typeof schema.authProviders)[number];
export type ProfileSource = (typeof schema.profileSources)[number];

export interface ProfileRow {
  firstName: string | null;
  lastName: string | null;
  avatarUrl: string | null;
  displayName: string | null;
  profileSource: ProfileSource | null;
}

export async function getProfileRow(db: Database, userId: string): Promise<ProfileRow> {
  const [row] = await db
    .select({
      firstName: schema.users.firstName,
      lastName: schema.users.lastName,
      avatarUrl: schema.users.avatarUrl,
      displayName: schema.users.displayName,
      profileSource: schema.users.profileSource,
    })
    .from(schema.users)
    .where(eq(schema.users.id, userId));
  return (
    row ?? {
      firstName: null,
      lastName: null,
      avatarUrl: null,
      displayName: null,
      profileSource: null,
    }
  );
}

export async function setCustomName(
  db: Database,
  userId: string,
  displayName: string | null,
): Promise<void> {
  await db.update(schema.users).set({ displayName }).where(eq(schema.users.id, userId));
}

export interface ProviderProfile {
  firstName?: string;
  lastName?: string;
  avatarUrl?: string;
}

/**
 * Applies display data a PROVIDER supplied at sign-in or linking. Rules:
 * - only non-empty values are ever written (a provider that omits or blanks
 *   a field never clears what we have);
 * - an EMPTY field is always filled;
 * - a field that already has a value is refreshed only when this provider is
 *   the one that filled the profile (`profileSource`), so a user holding both
 *   VK and Telegram doesn't see their name flip with each login;
 * - `displayName` and uploaded avatars (the user's manual choices) live in
 *   other columns/tables and are never touched here.
 */
export async function applyProviderProfile(
  db: Database,
  userId: string,
  provider: ProfileSource,
  profile: ProviderProfile,
): Promise<void> {
  const current = await getProfileRow(db, userId);
  const mayRefresh = current.profileSource === null || current.profileSource === provider;
  const set: Partial<typeof schema.users.$inferInsert> = {};
  const pick = <K extends 'firstName' | 'lastName' | 'avatarUrl'>(key: K) => {
    const incoming = profile[key];
    if (!incoming) return;
    if (current[key] === null || current[key] === '' || (mayRefresh && current[key] !== incoming)) {
      set[key] = incoming;
    }
  };
  pick('firstName');
  pick('lastName');
  pick('avatarUrl');
  if (Object.keys(set).length === 0) return;
  if (current.profileSource === null) set.profileSource = provider;
  await db.update(schema.users).set(set).where(eq(schema.users.id, userId));
}

// ---------------------------------------------------------------- avatars

export interface AvatarMeta {
  source: AvatarSource;
  sha256: string;
}

export async function listAvatarMeta(db: Database, userId: string): Promise<AvatarMeta[]> {
  return db
    .select({ source: schema.userAvatars.source, sha256: schema.userAvatars.sha256 })
    .from(schema.userAvatars)
    .where(eq(schema.userAvatars.userId, userId));
}

export async function getAvatar(db: Database, userId: string, source: AvatarSource) {
  const [row] = await db
    .select({
      contentType: schema.userAvatars.contentType,
      data: schema.userAvatars.data,
      sha256: schema.userAvatars.sha256,
    })
    .from(schema.userAvatars)
    .where(and(eq(schema.userAvatars.userId, userId), eq(schema.userAvatars.source, source)));
  return row ?? null;
}

export interface NewAvatar {
  contentType: string;
  width: number;
  height: number;
  data: Buffer;
  sha256: string;
}

export async function upsertAvatar(
  db: Database,
  userId: string,
  source: AvatarSource,
  avatar: NewAvatar,
): Promise<void> {
  const values = {
    contentType: avatar.contentType,
    width: avatar.width,
    height: avatar.height,
    byteSize: avatar.data.length,
    sha256: avatar.sha256,
    data: avatar.data,
  };
  await db
    .insert(schema.userAvatars)
    .values({ userId, source, ...values })
    .onConflictDoUpdate({
      target: [schema.userAvatars.userId, schema.userAvatars.source],
      set: { ...values, updatedAt: new Date() },
    });
}

export async function deleteAvatar(db: Database, userId: string, source: AvatarSource) {
  const rows = await db
    .delete(schema.userAvatars)
    .where(and(eq(schema.userAvatars.userId, userId), eq(schema.userAvatars.source, source)))
    .returning({ id: schema.userAvatars.id });
  return rows.length > 0;
}

// ------------------------------------------------------------- identities

export interface IdentityRow {
  provider: Provider;
  createdAt: Date;
}

export async function listIdentities(db: Database, userId: string): Promise<IdentityRow[]> {
  return db
    .select({
      provider: schema.authIdentities.provider,
      createdAt: schema.authIdentities.createdAt,
    })
    .from(schema.authIdentities)
    .where(eq(schema.authIdentities.userId, userId))
    .orderBy(asc(schema.authIdentities.createdAt));
}

export type AddIdentityOutcome = 'linked' | 'already_linked' | 'taken' | 'provider_already_used';

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
 */
export async function addIdentity(
  db: Database,
  userId: string,
  provider: Provider,
  providerUserId: string,
): Promise<AddIdentityOutcome> {
  return db.transaction(async (tx) => {
    const owned = await tx
      .select({
        userId: schema.authIdentities.userId,
        providerUserId: schema.authIdentities.providerUserId,
      })
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
  });
}

export type RemoveIdentityOutcome = 'removed' | 'not_linked' | 'last_identity';

/**
 * Detaches one sign-in method, but never the last WORKING one (VK, Yandex,
 * Telegram): an account with no way to sign in is unreachable. A legacy
 * `email` row is not a way in any more (email sign-in was removed), so it
 * does not count, and it is never removed here — its data stays as it was.
 * The user row is locked first so two concurrent unlinks can't each see
 * "two left" and remove both.
 */
export async function removeIdentity(
  db: Database,
  userId: string,
  provider: LinkableProvider,
): Promise<RemoveIdentityOutcome> {
  return db.transaction(async (tx) => {
    await tx
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .for('update');
    const all = await tx
      .select({ id: schema.authIdentities.id, provider: schema.authIdentities.provider })
      .from(schema.authIdentities)
      .where(eq(schema.authIdentities.userId, userId));
    const target = all.find((row) => row.provider === provider);
    if (!target) return 'not_linked';
    if (all.filter((row) => isWorkingSignInMethod(row.provider)).length <= 1) {
      return 'last_identity';
    }
    await tx.delete(schema.authIdentities).where(eq(schema.authIdentities.id, target.id));
    return 'removed';
  });
}
