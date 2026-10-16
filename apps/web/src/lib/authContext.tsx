import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { AuthUser } from '@zybrilka/shared';
import { getCurrentUser, logout as apiLogout } from './api.js';

/**
 * The one real source of "is anyone signed in" (S3 auth — magic-link +
 * VK ID). `undefined` means "not checked yet" (callers must not assume
 * signed-out before this resolves — e.g. Home's "Войти" button should
 * not flash and then disappear); `null` is a real, resolved "signed
 * out". One provider at the app root, same pattern as `StreakProvider`,
 * so every screen reads the identical session state instead of each
 * one running its own `/auth/me` request.
 */
interface AuthContextValue {
  readonly user: AuthUser | null | undefined;
  /** Re-checks `/auth/me` — call after a successful magic-link verify
   * or VK callback redirect so the header picks up the new session
   * without a full page reload. */
  readonly refresh: () => void;
  /** Clears the session server-side, then updates local state — never
   * just hides the UI while the cookie (and thus the real session)
   * stays alive. */
  readonly logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: undefined,
  refresh: () => {},
  logout: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined);

  const refresh = useCallback(() => {
    void getCurrentUser()
      .then((res) => setUser(res.user))
      .catch(() => {
        // No backend / offline — treat as signed out rather than
        // leaving the UI stuck on "checking", same honest-fallback
        // rule App.tsx's onboarding check already uses.
        setUser(null);
      });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    await apiLogout();
    setUser(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, refresh, logout }),
    [user, refresh, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
