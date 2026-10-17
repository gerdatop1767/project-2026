import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { StreakResponse } from '@zybrilka/shared';
import { getStreak } from './api.js';
import { useAuth } from './authContext.js';

/**
 * The one real source of streak state (CLAUDE.md's "система серий"):
 * backend-computed via `GET /progress/streak`, never calculated on the
 * frontend. One provider at the app root means Mobile's `StatusChips`
 * and Desktop's `StatusChips` — the exact same component, mounted in
 * `MobileShell`/`DesktopShell` — always read the identical value from
 * the same fetch, rather than each shell running its own request and
 * risking a mismatch.
 *
 * `null` means "not loaded yet" (StatusChips shows the existing '—'
 * placeholder, same honest-loading rule as everywhere else in the
 * app) — never confused with a real `currentStreak: 0`.
 */
interface StreakContextValue {
  readonly streak: StreakResponse | null;
  /** Re-fetches the real streak from the backend — called after a
   * task attempt is actually submitted (never on a bare UI click), so
   * the header reflects the new state without a full page reload. */
  readonly refreshStreak: () => void;
}

const StreakContext = createContext<StreakContextValue>({
  streak: null,
  refreshStreak: () => {},
});

export function StreakProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  // Remember WHOSE streak this is: after sign-out or an account switch
  // the previous account's value must never be shown for the new state.
  const [loaded, setLoaded] = useState<{ userId: string; streak: StreakResponse } | null>(null);
  const streak = loaded && loaded.userId === userId ? loaded.streak : null;

  const refreshStreak = useCallback(() => {
    if (!userId) return;
    void getStreak()
      .then((fresh) => setLoaded({ userId, streak: fresh }))
      .catch(() => {
        // Leave whatever was last successfully loaded (or null) rather
        // than showing a fabricated value on a failed refresh.
      });
  }, [userId]);

  // The streak is per account: load it only while someone is signed in
  // (the endpoint is private), reload when the account changes, and
  // never keep a previous account's value around after sign-out.
  useEffect(() => {
    refreshStreak();
  }, [refreshStreak]);

  const value = useMemo<StreakContextValue>(
    () => ({ streak, refreshStreak }),
    [streak, refreshStreak],
  );

  return <StreakContext.Provider value={value}>{children}</StreakContext.Provider>;
}

export function useStreakContext(): StreakContextValue {
  return useContext(StreakContext);
}
