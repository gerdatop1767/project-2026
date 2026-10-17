import type { ReactNode } from 'react';
import type { AuthUser } from '@zybrilka/shared';
import { AuthContext } from './authContext.js';

/** A signed-in, fully onboarded user with VK-style profile data. */
export function makeAuthUser(overrides: Partial<AuthUser> = {}): AuthUser {
  const user: AuthUser = {
    id: '11111111-1111-4111-8111-111111111111',
    email: null,
    firstName: 'Иван',
    lastName: 'Петров',
    customName: null,
    displayName: null,
    avatarUrl: null,
    hasCustomAvatar: false,
    onboardingCompleted: true,
    ...overrides,
  };
  // Like the server: the shown name is the custom one, else the provider's.
  if (!('displayName' in overrides)) {
    const providerName = [user.firstName, user.lastName].filter(Boolean).join(' ');
    user.displayName = user.customName ?? (providerName || null);
  }
  return user;
}

/** Test-only auth context with a fixed state (no network). */
export function TestAuthProvider({
  user,
  children,
  logout = async () => {},
  refresh = async () => {},
  updateUser = () => {},
  telegramError = null,
}: {
  user: AuthUser | null | undefined;
  children: ReactNode;
  logout?: () => Promise<void>;
  refresh?: () => Promise<void>;
  updateUser?: (user: AuthUser) => void;
  telegramError?: string | null;
}) {
  return (
    <AuthContext.Provider value={{ user, logout, refresh, updateUser, telegramError }}>
      {children}
    </AuthContext.Provider>
  );
}
