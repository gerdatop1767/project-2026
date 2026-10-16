import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { AuthUser } from '@zybrilka/shared';
import {
  ApiError,
  getCurrentUser,
  loginWithTelegram,
  logout as apiLogout,
  onUnauthorized,
} from './api.js';
import { getTelegramInitData, prepareTelegramApp } from './telegramMiniApp.js';
import { resetPrivateCaches } from './privateCaches.js';

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
  /** Replaces the signed-in user with a fresher copy the server just
   * returned (name/avatar edits, linking) so every screen updates at once,
   * without another `/auth/me` round trip. Same account only. */
  readonly updateUser: (user: AuthUser) => void;
  /** Why the automatic Telegram sign-in failed (`null` = not attempted or
   * fine). A short server code such as `telegram_data_expired`. */
  readonly telegramError: string | null;
}

export const AuthContext = createContext<AuthContextValue>({
  user: undefined,
  refresh: async () => {},
  logout: async () => {},
  updateUser: () => {},
  telegramError: null,
});

/** After an explicit sign-out inside Telegram, don't sign straight back in
 * on the reload. Per WebView session only. */
const TG_OPT_OUT_KEY = 'zybrilka_tg_signed_out';
function telegramOptedOut(): boolean {
  try {
    return window.sessionStorage.getItem(TG_OPT_OUT_KEY) === '1';
  } catch {
    return false;
  }
}
function setTelegramOptOut(value: boolean) {
  try {
    if (value) window.sessionStorage.setItem(TG_OPT_OUT_KEY, '1');
    else window.sessionStorage.removeItem(TG_OPT_OUT_KEY);
  } catch {
    // storage unavailable — worst case the user is signed in again on reload
  }
}

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
  // The account id the app last settled on (`undefined` until the first
  // check resolves) — lets `applyUser` tell "same user re-checked" from
  // "signed out / switched account".
  const currentUserId = useRef<string | null | undefined>(undefined);
  const [telegramError, setTelegramError] = useState<string | null>(null);

  const applyUser = useCallback((next: AuthUser | null) => {
    const previousId = currentUserId.current;
    const nextId = next?.id ?? null;
    // Leaving a signed-in identity (sign-out, lost session, or another
    // account appearing) must not leave that account's cached/private
    // data around for whoever uses this tab next. A same-user re-check
    // (refresh, finishing onboarding) keeps everything, e.g. the canvas.
    if (previousId && previousId !== nextId) resetPrivateCaches();
    currentUserId.current = nextId;
    setUser(next);
  }, []);

  /** Inside a Telegram Mini App with no session yet: sign in (or register)
   * with the signed launch data. The server verifies it; any failure just
   * leaves the normal login screen in place. */
  const signInWithTelegram = useCallback(async (): Promise<AuthUser | null> => {
    const initData = getTelegramInitData();
    if (!initData || telegramOptedOut()) return null;
    try {
      const res = await loginWithTelegram(initData);
      setTelegramError(null);
      return res.user;
    } catch (error) {
      const code =
        error instanceof ApiError && (error.body as { error?: unknown } | undefined)?.error;
      setTelegramError(typeof code === 'string' ? code : 'telegram_unavailable');
      return null;
    }
  }, []);

  const refresh = useCallback(
    () =>
      getCurrentUser()
        .then(async (res) => applyUser(res.user ?? (await signInWithTelegram())))
        .catch(() => {
          // No backend / offline — treat as signed out rather than
          // leaving the UI stuck on "checking". Private data is
          // unreachable anyway.
          applyUser(null);
        }),
    [applyUser, signInWithTelegram],
  );

  useEffect(() => {
    prepareTelegramApp();
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Any private endpoint answering 401 means the session ended behind
  // our back (expiry, revoked, deleted) — drop signed-in state so the
  // app closes the private screens instead of showing a broken trainer.
  useEffect(() => onUnauthorized(() => applyUser(null)), [applyUser]);

  const logout = useCallback(async () => {
    await apiLogout();
    if (getTelegramInitData()) setTelegramOptOut(true);
    applyUser(null);
    onSignedOut();
  }, [applyUser, onSignedOut]);

  const updateUser = useCallback(
    (next: AuthUser) => {
      // A profile response always belongs to the signed-in account; ignore
      // one that doesn't (e.g. a late response after switching accounts).
      if (currentUserId.current === next.id) applyUser(next);
    },
    [applyUser],
  );

  const value = useMemo<AuthContextValue>(
    () => ({ user, refresh, logout, updateUser, telegramError }),
    [user, refresh, logout, updateUser, telegramError],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
