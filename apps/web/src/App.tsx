import { useEffect } from 'react';
import { useAuth } from './lib/authContext.js';
import { isOnboardingPending } from './lib/onboardingStatus.js';
import { useNavigation, type OverlayRoute } from './lib/navigation.js';
import { useIsDesktop } from './lib/useIsDesktop.js';
import { useToast } from './ui/Toast/ToastProvider.js';
import { AppMobile } from './AppMobile.js';
import { AppDesktop } from './AppDesktop.js';
import { Landing } from './screens/Landing/Landing.js';
import { InfoPage, type InfoPageKind } from './screens/Info/InfoPage.js';
import { Login } from './screens/Login/Login.js';
import { TelegramReturn } from './screens/TelegramReturn/TelegramReturn.js';
import { AccountGateProvider, accountFeatureForRoute } from './lib/accountGate.js';
import { LANDING_AS_HOME } from './lib/features.js';

/** Public info pages that render standalone (landing header/footer, no app
 * shell) for everyone — a privacy policy must never sit behind sign-in or
 * onboarding. */
const infoPages: ReadonlySet<OverlayRoute['screen']> = new Set(['faq', 'privacy', 'terms']);

function LoadingScreen() {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center' }}
    >
      Загрузка…
    </div>
  );
}

/**
 * App root (S1 Block 6, approved design): desktop and mobile are
 * separate compositions, so this just decides which tree mounts —
 * `AppMobile` / `AppDesktop` own everything else.
 *
 * It is also the single access gate, driven only by server truth from
 * `/auth/me` (never localStorage or a URL parameter):
 * - not checked yet → neutral loading state;
 * - signed out → GUEST MODE: the trainer itself, free to use; what needs
 *   an account (Статистика, Мои ошибки, …) opens a «нужна регистрация»
 *   window (lib/accountGate). The marketing landing lives at /landing
 *   (and is the start page again with VITE_LANDING_AS_HOME=true);
 * - signed in with onboarding not completed (new account, or one that
 *   was left unfinished) → onboarding (the welcome with the subject
 *   choice) — only ever after signing in, never for a guest;
 * - signed in and onboarded → the trainer / main menu.
 */
export function App() {
  const { tab, overlay, navigate } = useNavigation();
  const { clear } = useToast();
  const isDesktop = useIsDesktop();
  const { user } = useAuth();

  // A toast from the previous screen renders in the same top-of-screen
  // spot as an overlay's back button — never let it survive a
  // navigation and cover the new screen's controls.
  useEffect(() => {
    clear();
  }, [tab, overlay, clear]);

  const needsOnboarding = isOnboardingPending(user);
  const onOnboarding = overlay?.screen === 'onboarding';
  // Standalone pages that never get redirected (onboarding included): the
  // public info pages, and the external browser's Telegram return page.
  const onInfoPage =
    overlay !== null && (infoPages.has(overlay.screen) || overlay.screen === 'telegramReturn');
  const guestLanding = LANDING_AS_HOME && user === null && tab === 'home' && overlay === null;
  // A guest on an account-only screen (typed/bookmarked URL, or Back into
  // one): the trainer home underneath, with the sign-in window on top.
  const lockedFeature = user === null ? accountFeatureForRoute(overlay ?? { screen: tab }) : null;
  const guestOnOnboarding = user === null && onOnboarding;

  // Keep the address bar truthful. A signed-in user who still owes
  // onboarding is moved to /onboarding; a guest on a locked or
  // onboarding URL is moved home. Redirects the user did not ask for
  // REPLACE the entry, so Back never bounces into the same redirect.
  useEffect(() => {
    if (lockedFeature || guestOnOnboarding) {
      navigate({ screen: 'home' }, { replace: true });
    } else if (needsOnboarding && !onOnboarding && overlay?.screen !== 'login' && !onInfoPage) {
      navigate({ screen: 'onboarding' }, { replace: true });
    }
  }, [
    lockedFeature,
    guestOnOnboarding,
    needsOnboarding,
    onOnboarding,
    onInfoPage,
    overlay?.screen,
    navigate,
  ]);

  // `needsOnboarding && !onOnboarding` lasts one render: the effect above
  // is already navigating to /onboarding. Never flash the trainer there.
  if (overlay?.screen === 'telegramReturn') return <TelegramReturn />;

  if (overlay !== null && onInfoPage) {
    return <InfoPage kind={overlay.screen as InfoPageKind} />;
  }

  if (user === undefined || (needsOnboarding && !onOnboarding && overlay?.screen !== 'login')) {
    return <LoadingScreen />;
  }

  // Rendered standalone, bypassing the normal app shell — reachable from
  // any «Войти» button, or directly via a VK ID / Yandex ID redirect.
  if (overlay?.screen === 'login') {
    return <Login />;
  }

  // The marketing landing: kept, at /landing (or as the guest start page
  // when VITE_LANDING_AS_HOME=true). Signed-in users are never shown it
  // as their home.
  if (overlay?.screen === 'landing' || guestLanding) {
    return <Landing />;
  }

  return (
    <AccountGateProvider lockedOnArrival={lockedFeature}>
      {isDesktop ? <AppDesktop /> : <AppMobile />}
    </AccountGateProvider>
  );
}
