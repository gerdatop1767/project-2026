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
import { getCurrentUser, logout as apiLogout, onUnauthorized } from './api.js';

/**
 * The one real source of "is anyone signed in" (S3 auth — magic-link +
 * VK ID). `undefined` means "not checked yet" (callers must not assume
 * signed-out before this resolves — the app shows a neutral loading
 * state instead of flashing the login screen at a signed-in user);
 * `null` is a real, resolved "signed out". One provider at the app root,
 * same pattern as `StreakProvider`, so every screen reads the identical
 * session state instead of each one running its own `/auth/me` request.
 *
 * Everything on `user` is server truth, including `onboardingCompleted`
 * (derived from the saved learning profile in the database) — it is what
 * decides between onboarding and the main menu.
 */
interface AuthContextValue {
  readonly user: AuthUser | null | undefined;
  /** Re-checks `/auth/me` — call after a successful magic-link verify,
   * a VK callback redirect, or finishing onboarding, so the app picks up
   * the new server state without a full page reload. Resolves once the
   * state is updated. */
  readonly refresh: () => Promise<void>;
  /** Ends the session on the server first and only then clears local
   * state — rejects (leaving the user signed in) if the server could not
   * be told, instead of pretending to sign out while the real session
   * stays alive. */
  readonly logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue>({
  user: undefined,
  refresh: async () => {},
  logout: async () => {},
});

/** After a real logout, replace the whole document: it drops every
 * in-memory cache (progress, streak, learning session, favorites, open
 * task…) that belonged to the previous account in one go, and leaves
 * the browser history pointing at the login page. */
function hardRedirectToLogin() {
  window.location.replace('/login');
}

export function AuthProvider({
  children,
  onSignedOut = hardRedirectToLogin,
}: {
  children: ReactNode;
  /** Runs after a successful logout (tests pass a spy; production
   * reloads to /login). */
  onSignedOut?: () => void;
}) {
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined);

  const refresh = useCallback(
    () =>
      getCurrentUser()
        .then((res) => setUser(res.user))
        .catch(() => {
          // No backend / offline — treat as signed out rather than
          // leaving the UI stuck on "checking". Private data is
          // unreachable anyway.
          setUser(null);
        }),
    [],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Any private endpoint answering 401 means the session ended behind
  // our back (expiry, revoked, deleted) — drop signed-in state so the
  // app closes the private screens instead of showing a broken trainer.
  useEffect(() => onUnauthorized(() => setUser(null)), []);

  const logout = useCallback(async () => {
    await apiLogout();
    setUser(null);
    onSignedOut();
  }, [onSignedOut]);

  const value = useMemo<AuthContextValue>(
    () => ({ user, refresh, logout }),
    [user, refresh, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
