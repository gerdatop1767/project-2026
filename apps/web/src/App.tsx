import { useEffect } from 'react';
import { useAuth } from './lib/authContext.js';
import { isOnboardingPending } from './lib/onboardingStatus.js';
import { useNavigation, type OverlayRoute } from './lib/navigation.js';
import { useIsDesktop } from './lib/useIsDesktop.js';
import { useToast } from './ui/Toast/ToastProvider.js';
import { AppMobile } from './AppMobile.js';
import { AppDesktop } from './AppDesktop.js';
import { LandingDesktop } from './screens/Landing/LandingDesktop.js';
import { LandingMobile } from './screens/Landing/LandingMobile.js';
import { Login } from './screens/Login/Login.js';

/** Overlays that hold no per-user data and stay reachable while signed
 * out. Everything else is the trainer itself and needs a session (the
 * API enforces the same on the server — this only decides what to
 * render). */
const publicOverlays: ReadonlySet<OverlayRoute['screen']> = new Set(['login', 'about', 'help']);

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
 * - signed out → public landing at `/`, the login screen, and a couple
 *   of static info pages; any other URL shows the login screen;
 * - signed in with onboarding not completed (new account, or one that
 *   was left unfinished) → onboarding;
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
  const onPublicPage = overlay === null ? tab === 'home' : publicOverlays.has(overlay.screen);

  // Keep the address bar truthful: a signed-out visitor on a private URL
  // is moved to /login; a signed-in user who still owes onboarding is
  // moved to /onboarding. (The screens below render the right thing
  // immediately; this just fixes the URL so refresh/back stay coherent.)
  useEffect(() => {
    if (user === null && !onPublicPage) {
      navigate({ screen: 'login' });
    } else if (needsOnboarding && !onOnboarding && overlay?.screen !== 'login') {
      navigate({ screen: 'onboarding' });
    }
  }, [user, onPublicPage, needsOnboarding, onOnboarding, overlay?.screen, navigate]);

  // `needsOnboarding && !onOnboarding` lasts one render: the effect above
  // is already navigating to /onboarding. Never flash the trainer there.
  if (user === undefined || (needsOnboarding && !onOnboarding && overlay?.screen !== 'login')) {
    return <LoadingScreen />;
  }

  // Rendered standalone, bypassing the normal dark app shell — the
  // approved auth reference is its own light full-page screen, reachable
  // from Landing's "Войти" button, a private URL while signed out, or
  // directly via a magic-link/VK-login redirect.
  if (overlay?.screen === 'login' || (user === null && !onPublicPage)) {
    return <Login />;
  }

  // The public landing is the signed-out face of `/`; signed-in users
  // never see it.
  if (user === null && tab === 'home' && overlay === null) {
    return isDesktop ? <LandingDesktop /> : <LandingMobile />;
  }

  return isDesktop ? <AppDesktop /> : <AppMobile />;
}
