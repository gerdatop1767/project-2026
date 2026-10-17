import type { AuthUser } from '@zybrilka/shared';

/** "Имя Фамилия" from whichever parts VK supplied; `null` when it supplied
 * neither (email-only account, or VK withheld them) so callers can show
 * their own neutral fallback instead of a fake name. */
export function displayName(user: Pick<AuthUser, 'firstName' | 'lastName'> | null | undefined) {
  const parts = [user?.firstName, user?.lastName].filter((part): part is string => !!part?.trim());
  return parts.length > 0 ? parts.join(' ') : null;
}
