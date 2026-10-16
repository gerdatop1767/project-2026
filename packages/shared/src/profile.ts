import { z } from 'zod';

/** Longest custom display name, counted in Unicode code points. */
export const DISPLAY_NAME_MAX_LENGTH = 40;

/** Biggest avatar the API accepts. The web client downsizes to 512 px before
 * uploading, so real uploads are far smaller; this is the hard server cap. */
export const AVATAR_MAX_BYTES = 1024 * 1024;

/** Smallest / largest accepted avatar side, in pixels. */
export const AVATAR_MIN_SIDE = 64;
export const AVATAR_MAX_SIDE = 4096;

/** The only image formats avatars may use (SVG is deliberately excluded). */
export const AVATAR_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type AvatarContentType = (typeof AVATAR_CONTENT_TYPES)[number];

// Zero-width, bidi-override/isolate and BOM characters: invisible, but they
// let one name impersonate another or flip surrounding text.
const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;
// C0/C1 control characters.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001F\u007F-\u009F]/g;

/**
 * Normalizes a user-typed display name: Unicode NFC, control and invisible
 * characters removed, runs of whitespace collapsed, ends trimmed. Returns
 * `null` for an empty result (meaning "no custom name"). Used by the API as
 * the source of truth and by the client for its own preview/validation.
 */
export function normalizeDisplayName(raw: string): string | null {
  const cleaned = raw
    .normalize('NFC')
    .replace(CONTROL, ' ')
    .replace(INVISIBLE, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned === '' ? null : cleaned;
}

export type DisplayNameProblem = 'too_long' | 'forbidden_characters';

/** `null` when `normalized` is acceptable as a display name. */
export function displayNameProblem(normalized: string): DisplayNameProblem | null {
  if ([...normalized].length > DISPLAY_NAME_MAX_LENGTH) return 'too_long';
  if (/[<>]/.test(normalized)) return 'forbidden_characters';
  return null;
}

/** `PATCH /me/profile` body. `displayName: null` (or blank) resets to the provider's name. */
export const updateProfileRequestSchema = z.object({
  displayName: z.string().max(400).nullable(),
});
export type UpdateProfileRequest = z.infer<typeof updateProfileRequestSchema>;

/** Sign-in methods a single account can hold. */
export const identityProviders = ['email', 'vk', 'telegram'] as const;
export const identityProviderSchema = z.enum(identityProviders);
export type IdentityProvider = z.infer<typeof identityProviderSchema>;

/** Providers the user can link/unlink themselves from the profile. */
export const linkableProviders = ['vk', 'telegram'] as const;
export type LinkableProvider = (typeof linkableProviders)[number];

export const identityInfoSchema = z.object({
  provider: identityProviderSchema,
  /** ISO timestamp the method was linked. */
  linkedAt: z.string(),
});
export type IdentityInfo = z.infer<typeof identityInfoSchema>;

/**
 * `GET /me/identities`. `available` tells the UI which providers are
 * configured on this server (a button for an unconfigured provider would
 * only lead to an error); `canUnlink` is false when only one method is
 * left, since removing it would lock the user out.
 */
export const identitiesResponseSchema = z.object({
  identities: z.array(identityInfoSchema),
  available: z.object({ vk: z.boolean(), telegram: z.boolean() }),
  canUnlink: z.boolean(),
});
export type IdentitiesResponse = z.infer<typeof identitiesResponseSchema>;

/** `POST /auth/telegram` and `POST /me/identities/telegram` body: the raw
 * `Telegram.WebApp.initData` string, exactly as Telegram produced it. The
 * server verifies its signature; nothing in it is trusted before that. */
export const telegramInitDataRequestSchema = z.object({
  initData: z.string().min(1).max(8192),
});
export type TelegramInitDataRequest = z.infer<typeof telegramInitDataRequestSchema>;
