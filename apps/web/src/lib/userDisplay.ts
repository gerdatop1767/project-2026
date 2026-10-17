import type { AuthUser } from '@zybrilka/shared';

/** The name to show for a user: the server-resolved `displayName` (the user's
 * own name when set, otherwise the provider's first + last name); `null` when
 * there is none (email-only account, provider withheld it) so callers can show
 * their own neutral fallback instead of a fake name. */
export function displayName(
  user:
    | (Pick<AuthUser, 'firstName' | 'lastName'> & Partial<Pick<AuthUser, 'displayName'>>)
    | null
    | undefined,
) {
  const resolved = user?.displayName?.trim();
  if (resolved) return resolved;
  const parts = [user?.firstName, user?.lastName].filter((part): part is string => !!part?.trim());
  return parts.length > 0 ? parts.join(' ') : null;
}
