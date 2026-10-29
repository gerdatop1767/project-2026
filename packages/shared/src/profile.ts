import { z } from 'zod';

export {
  DISPLAY_NAME_MAX_LENGTH,
  AVATAR_MAX_BYTES,
  AVATAR_MIN_SIDE,
  AVATAR_MAX_SIDE,
  AVATAR_CONTENT_TYPES,
  normalizeDisplayName,
  displayNameProblem,
} from './displayName.js';
export type { AvatarContentType, DisplayNameProblem } from './displayName.js';

/** `PATCH /me/profile` body. `displayName: null` (or blank) resets to the provider's name. */
export const updateProfileRequestSchema = z.object({
  displayName: z.string().max(400).nullable(),
});
export type UpdateProfileRequest = z.infer<typeof updateProfileRequestSchema>;

/** Sign-in methods a single account can hold. */
export const identityProviders = ['email', 'vk', 'telegram', 'yandex'] as const;
export const identityProviderSchema = z.enum(identityProviders);
export type IdentityProvider = z.infer<typeof identityProviderSchema>;

/** Providers the user can link/unlink themselves from the profile — and
 * the only ones that can still sign anyone in. `email` is kept in
 * `identityProviders` for accounts created before email sign-in was removed
 * (their rows stay), but it is not a working sign-in method. */
export const linkableProviders = ['vk', 'telegram', 'yandex'] as const;
export type LinkableProvider = (typeof linkableProviders)[number];
export const linkableProviderSchema = z.enum(linkableProviders);

/** Whether this method can still be used to sign in (VK, Yandex, Telegram). */
export function isWorkingSignInMethod(provider: IdentityProvider): provider is LinkableProvider {
  return (linkableProviders as readonly string[]).includes(provider);
}

export const identityInfoSchema = z.object({
  provider: identityProviderSchema,
  /** ISO timestamp the method was linked. */
  linkedAt: z.string(),
});
export type IdentityInfo = z.infer<typeof identityInfoSchema>;

/**
 * `GET /me/identities`. `available` tells the UI which providers are
 * configured on this server (a button for an unconfigured provider would
 * only lead to an error); `canUnlink` is false when at most one WORKING
 * method (VK, Yandex, Telegram) is left, since removing it would lock the
 * user out — a legacy `email` row does not count.
 */
export const identitiesResponseSchema = z.object({
  identities: z.array(identityInfoSchema),
  available: z.object({ vk: z.boolean(), telegram: z.boolean(), yandex: z.boolean() }),
  canUnlink: z.boolean(),
  /** No Telegram linked yet, and a Telegram account confirmed this
   * account's link in the bot: shown so the owner can accept or refuse it
   * (docs/REMINDERS.md). Only the name Telegram itself reported. */
  telegramPendingLink: z.object({ name: z.string() }).nullable().optional(),
});
export type IdentitiesResponse = z.infer<typeof identitiesResponseSchema>;

/** `POST /auth/telegram` and `POST /me/identities/telegram` body: the raw
 * `Telegram.WebApp.initData` string, exactly as Telegram produced it. The
 * server verifies its signature; nothing in it is trusted before that. */
export const telegramInitDataRequestSchema = z.object({
  initData: z.string().min(1).max(8192),
});
export type TelegramInitDataRequest = z.infer<typeof telegramInitDataRequestSchema>;
