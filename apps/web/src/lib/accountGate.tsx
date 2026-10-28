import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useAuth } from './authContext.js';
import { useNavigation, useOptionalNavigation, type Route } from './navigation.js';
import { SignInRequiredDialog } from '../ui/AccountGate/SignInRequiredDialog.js';

/**
 * Guest mode. Without an account a visitor can train freely — pick a
 * subject and mode, open tasks by topic/variant/number, answer and see the
 * check (the server checks a guest's answer but records nothing). What
 * needs an account — anything built from a personal history — opens a
 * small «нужна регистрация» window instead, over the current screen,
 * which stays exactly as it was.
 *
 * The server enforces the same split (statistics/mistakes/favorites/
 * learning answer 401 without a session); this only decides what to show.
 */
export type AccountFeature =
  | 'statistics'
  | 'mistakes'
  | 'favorites'
  | 'smartTraining'
  | 'unseen'
  | 'essay'
  | 'level'
  | 'gameProgress';

/** Screens that are built from a personal history. */
export function accountFeatureForRoute(route: Route): AccountFeature | null {
  switch (route.screen) {
    case 'statistics':
    case 'achievements':
    case 'variantAttempt':
      return 'statistics';
    case 'mistakes':
      return 'mistakes';
    case 'favorites':
      return 'favorites';
    case 'learningSession':
      return 'smartTraining';
    case 'level':
      return 'level';
    default:
      return null;
  }
}

interface AccountGateValue {
  isGuest: boolean;
  /** True when allowed; for a guest opens the sign-in window and returns false. */
  requireAccount: (feature: AccountFeature) => boolean;
  /** `navigate`, except that a guest gets the window instead of a locked screen. */
  navigateGuarded: (route: Route) => void;
  /** Opens the window (e.g. a guest arriving at a locked URL). */
  showSignIn: (feature: AccountFeature) => void;
}

const AccountGateContext = createContext<AccountGateValue | null>(null);

export function AccountGateProvider({
  children,
  lockedOnArrival = null,
}: {
  children: ReactNode;
  /** A guest arrived at an account-only URL: explain why they are home. */
  lockedOnArrival?: AccountFeature | null;
}) {
  const { user } = useAuth();
  const { navigate } = useNavigation();
  const isGuest = user === null;
  const [feature, setFeature] = useState<AccountFeature | null>(lockedOnArrival);
  // A guest arriving at an account-only URL later on (e.g. Back into one):
  // open the window for it — adjusted during render, not in an effect.
  const [arrival, setArrival] = useState(lockedOnArrival);
  if (lockedOnArrival !== arrival) {
    setArrival(lockedOnArrival);
    if (lockedOnArrival) setFeature(lockedOnArrival);
  }

  const requireAccount = useCallback(
    (wanted: AccountFeature) => {
      if (!isGuest) return true;
      setFeature(wanted);
      return false;
    },
    [isGuest],
  );

  const navigateGuarded = useCallback(
    (route: Route) => {
      const locked = accountFeatureForRoute(route);
      if (locked && !requireAccount(locked)) return;
      navigate(route);
    },
    [navigate, requireAccount],
  );

  const value = useMemo(
    () => ({ isGuest, requireAccount, navigateGuarded, showSignIn: setFeature }),
    [isGuest, requireAccount, navigateGuarded],
  );

  return (
    <AccountGateContext.Provider value={value}>
      {children}
      <SignInRequiredDialog
        feature={isGuest ? feature : null}
        onClose={() => setFeature(null)}
        onSignIn={() => {
          setFeature(null);
          navigate({ screen: 'login' });
        }}
      />
    </AccountGateContext.Provider>
  );
}

/** Outside the provider (isolated screen tests) everything is allowed. */
const OPEN_GATE: AccountGateValue = {
  isGuest: false,
  requireAccount: () => true,
  navigateGuarded: () => {},
  showSignIn: () => {},
};

export function useAccountGate(): AccountGateValue {
  const ctx = useContext(AccountGateContext);
  const navigation = useOptionalNavigation();
  return ctx ?? { ...OPEN_GATE, navigateGuarded: navigation?.navigate ?? (() => {}) };
}
