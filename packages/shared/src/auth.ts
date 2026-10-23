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
  /** The signed-in user is the project owner (server-side
   * ADMIN_OWNER_USER_IDS). A UI hint for the «Админ-панель» link only —
   * the admin API checks access on every request regardless. */
  isOwner: z.boolean().optional(),
});
export type MeResponse = z.infer<typeof meResponseSchema>;

// ------------------------------------------------------- email + password

/** Password rules (checked on the server; the form shows the same hints).
 * Length is what matters most; the upper bound stops a huge string from
 * being fed to the hash function. */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

/** Why a password was refused (the client turns these into messages). */
export type PasswordProblem = 'too_short' | 'too_long' | 'too_simple';

const TOO_SIMPLE = new Set([
  '12345678',
  '123456789',
  '1234567890',
  'qwertyui',
  'qwertyuiop',
  'password',
  'password1',
  'iloveyou',
  '11111111',
  '00000000',
  'йцукенгш',
  'zybrilka',
  'зубрилка',
]);

export function passwordProblem(password: string, email?: string): PasswordProblem | null {
  if (password.length < PASSWORD_MIN_LENGTH) return 'too_short';
  if (password.length > PASSWORD_MAX_LENGTH) return 'too_long';
  const lower = password.toLowerCase();
  if (TOO_SIMPLE.has(lower) || new Set(lower).size < 3) return 'too_simple';
  if (email && lower === email.trim().toLowerCase()) return 'too_simple';
  if (email && lower === email.trim().toLowerCase().split('@')[0]) return 'too_simple';
  return null;
}

const emailField = z.email().max(254);
const passwordField = z
  .string()
  .min(1)
  .max(PASSWORD_MAX_LENGTH + 1);

/** POST /auth/register */
export const registerRequestSchema = z.object({ email: emailField, password: passwordField });
export type RegisterRequest = z.infer<typeof registerRequestSchema>;

/** POST /auth/login */
export const passwordLoginRequestSchema = z.object({ email: emailField, password: passwordField });
export type PasswordLoginRequest = z.infer<typeof passwordLoginRequestSchema>;

/** POST /auth/register/confirm and token checks */
export const emailTokenRequestSchema = z.object({ token: z.string().min(16).max(200) });
export type EmailTokenRequest = z.infer<typeof emailTokenRequestSchema>;

/** POST /auth/register/resend — the address, or the (possibly expired) link's token. */
export const resendConfirmationRequestSchema = z.union([
  z.object({ email: emailField }),
  z.object({ token: z.string().min(16).max(200) }),
]);
export type ResendConfirmationRequest = z.infer<typeof resendConfirmationRequestSchema>;

/** POST /auth/password/forgot */
export const forgotPasswordRequestSchema = z.object({ email: emailField });
export type ForgotPasswordRequest = z.infer<typeof forgotPasswordRequestSchema>;

/** POST /auth/password/reset */
export const resetPasswordRequestSchema = z.object({
  token: z.string().min(16).max(200),
  password: passwordField,
});
export type ResetPasswordRequest = z.infer<typeof resetPasswordRequestSchema>;
