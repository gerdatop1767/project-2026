import type { ReactNode } from 'react';
import type { AuthUser } from '@zybrilka/shared';
import { AuthContext } from './authContext.js';

/** A signed-in, fully onboarded user with VK-style profile data. */
export function makeAuthUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    email: null,
    firstName: 'Иван',
    lastName: 'Петров',
    avatarUrl: null,
    onboardingCompleted: true,
    ...overrides,
  };
}

/** Test-only auth context with a fixed state (no network). */
export function TestAuthProvider({
  user,
  children,
  logout = async () => {},
  refresh = async () => {},
}: {
  user: AuthUser | null | undefined;
  children: ReactNode;
  logout?: () => Promise<void>;
  refresh?: () => Promise<void>;
}) {
  return <AuthContext.Provider value={{ user, logout, refresh }}>{children}</AuthContext.Provider>;
}
