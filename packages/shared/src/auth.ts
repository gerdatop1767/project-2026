import { z } from 'zod';

/**
 * The authenticated user, as returned by /auth/telegram and
 * /auth/me (VK ID and Yandex ID sign in by redirect and set the same session).
 * Everything here is server truth:
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
  /** The signed-in user is the project owner (server-side
   * ADMIN_OWNER_USER_IDS). A UI hint for the «Админ-панель» link only —
   * the admin API checks access on every request regardless. */
  isOwner: z.boolean().optional(),
  /** The signed-in account has no working sign-in method (VK, Yandex ID,
   * Telegram) — e.g. one created with the removed email sign-in. Once this
   * session ends it could not sign in again, so the app asks the user to
   * connect VK or Yandex. Present only when true. */
  needsSignInMethod: z.boolean().optional(),
});
export type MeResponse = z.infer<typeof meResponseSchema>;
