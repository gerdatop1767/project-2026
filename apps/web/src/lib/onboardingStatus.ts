import type { AuthUser } from '@zybrilka/shared';

/**
 * Whether the UI should send the signed-in user to onboarding.
 *
 * True ONLY when the server explicitly said `onboardingCompleted: false`.
 * A response that lacks the field (an older API build during a rolling
 * deploy/rollback, or any incompatible payload) is "unknown": treating
 * unknown as "pending" would trap the user in an onboarding loop that can
 * never clear (saving the profile can't add a field the API doesn't
 * send), so the UI falls back to the normal app instead.
 *
 * This is a UI-compatibility decision only. It grants nothing: whether a
 * request is allowed is decided by the server's session check on every
 * private endpoint, and unknown status is NOT taken as proof that
 * onboarding was completed — it simply doesn't block navigation.
 */
export function isOnboardingPending(
  user: Pick<AuthUser, 'onboardingCompleted'> | null | undefined,
) {
  return !!user && user.onboardingCompleted === false;
}
