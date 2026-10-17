import { z } from 'zod';

/** Request body for POST /auth/magic-link. */
export const magicLinkRequestSchema = z.object({
  email: z.email(),
});
export type MagicLinkRequest = z.infer<typeof magicLinkRequestSchema>;

/**
 * Always the same shape whether or not `email` actually has an
 * account — the route never reveals which, to avoid letting a caller
 * enumerate registered emails (see apps/api's auth service).
 */
export const magicLinkResponseSchema = z.object({
  ok: z.literal(true),
});
export type MagicLinkResponse = z.infer<typeof magicLinkResponseSchema>;

/** Request body for POST /auth/verify (the token from the emailed link). */
export const verifyMagicLinkRequestSchema = z.object({
  token: z.string().min(1),
});
export type VerifyMagicLinkRequest = z.infer<typeof verifyMagicLinkRequestSchema>;

/**
 * The authenticated user, as returned by /auth/verify, /auth/vk/callback,
 * /auth/telegram and /auth/me. Everything here is server truth:
 * - `firstName`/`lastName` come from the identity provider (VK, Telegram)
 *   and are `null` when it never supplied them (e.g. email-only accounts);
 * - `customName` is what the user typed in their profile (it wins over the
 *   provider's name); `displayName` is the already-resolved name to show;
 * - `avatarUrl` is the already-resolved avatar to show (an uploaded image
 *   beats the provider's photo), `hasCustomAvatar` says the user uploaded
 *   one — so the client never re-implements the priority rules;
 * - `onboardingCompleted` is derived from the saved learning profile in
 *   the database — the client uses it to decide between onboarding and
 *   the main menu, never localStorage or a URL parameter.
 */
export const authUserSchema = z.object({
  id: z.uuid(),
  email: z.email().nullable(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  customName: z.string().nullable(),
  displayName: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  hasCustomAvatar: z.boolean(),
  onboardingCompleted: z.boolean(),
});
export type AuthUser = z.infer<typeof authUserSchema>;

export const meResponseSchema = z.object({
  user: authUserSchema.nullable(),
});
export type MeResponse = z.infer<typeof meResponseSchema>;
