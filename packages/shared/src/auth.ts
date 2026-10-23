import { z } from 'zod';

/**
 * The authenticated user, as returned by /auth/login, /auth/telegram and
 * /auth/me (VK ID and Yandex ID sign in by redirect and set the same session). Everything here is server truth:
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
});
export type MeResponse = z.infer<typeof meResponseSchema>;

// ------------------------------------------------------- email + password

/** Upper bound for a password sent to sign-in — stops a huge string from
 * being fed to the hash function. (Registration and password reset were
 * removed together with email sending; only sign-in remains.) */
export const PASSWORD_MAX_LENGTH = 128;

/** POST /auth/login — for accounts that already have a password. */
export const passwordLoginRequestSchema = z.object({
  email: z.email().max(254),
  password: z
    .string()
    .min(1)
    .max(PASSWORD_MAX_LENGTH + 1),
});
export type PasswordLoginRequest = z.infer<typeof passwordLoginRequestSchema>;
