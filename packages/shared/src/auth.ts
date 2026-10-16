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
 * The authenticated user, as returned by /auth/verify, /auth/vk/callback
 * and /auth/me. Everything here is server truth:
 * - `firstName`/`lastName`/`avatarUrl` come from the identity provider
 *   (VK ID) and are `null` when it never supplied them (e.g. email-only
 *   accounts);
 * - `onboardingCompleted` is derived from the saved learning profile in
 *   the database — the client uses it to decide between onboarding and
 *   the main menu, never localStorage or a URL parameter.
 */
export const authUserSchema = z.object({
  id: z.uuid(),
  email: z.email().nullable(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  onboardingCompleted: z.boolean(),
});
export type AuthUser = z.infer<typeof authUserSchema>;

export const meResponseSchema = z.object({
  user: authUserSchema.nullable(),
});
export type MeResponse = z.infer<typeof meResponseSchema>;
