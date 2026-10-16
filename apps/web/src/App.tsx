import { useEffect, useRef, useState } from 'react';
import { getLearningProfile } from './lib/api.js';
import { useAuth } from './lib/authContext.js';
import { useNavigation } from './lib/navigation.js';
import { useIsDesktop } from './lib/useIsDesktop.js';
import { useToast } from './ui/Toast/ToastProvider.js';
import { AppMobile } from './AppMobile.js';
import { AppDesktop } from './AppDesktop.js';
import { LandingDesktop } from './screens/Landing/LandingDesktop.js';
import { LandingMobile } from './screens/Landing/LandingMobile.js';
import { Login } from './screens/Login/Login.js';

/**
 * App root (S1 Block 6, approved design): desktop and mobile are
 * separate compositions, so this just decides which tree mounts —
 * `AppMobile` / `AppDesktop` own everything else.
 */
export function App() {
  const { tab, overlay } = useNavigation();
  const { clear } = useToast();
  const isDesktop = useIsDesktop();
  const { user } = useAuth();

  // A toast from the previous screen renders in the same top-of-screen
  // spot as an overlay's back button — never let it survive a
  // navigation and cover the new screen's controls.
  useEffect(() => {
    clear();
  }, [tab, overlay, clear]);

  // Public landing gate (DB is the source of truth, never localStorage
  // — see apps/api's learningProfile module). `null` (not yet known)
  // renders the normal app immediately, same as before this existed —
  // only once the check resolves `false` does a visitor still sitting
  // on the plain `home` tab with no overlay/deep link open see the
  // public landing instead; its own "Начать бесплатно" is what starts
  // onboarding now, not an automatic redirect (Landing{Desktop,Mobile}).
  // A deep link into any other screen/overlay is never interrupted,
  // same guarantee the old redirect-based gate made.
  const [onboardingCompleted, setOnboardingCompleted] = useState<boolean | null>(null);
  const checkedOnboarding = useRef(false);
  useEffect(() => {
    if (checkedOnboarding.current) return;
    checkedOnboarding.current = true;
    getLearningProfile()
      .then((profile) => setOnboardingCompleted(profile.onboardingCompleted))
      .catch(() => {
        // No DB / offline — fall through to the normal app rather than
        // blocking on a profile check that can't succeed.
        setOnboardingCompleted(true);
      });
  }, []);

  // Rendered standalone, bypassing both the normal dark app shell and
  // the onboarding/landing gate above — the approved auth reference is
  // its own light full-page screen, reachable from Home/Landing's
  // "Войти" button or directly via a magic-link/VK-login redirect.
  if (overlay?.screen === 'login') {
    return <Login />;
  }

  // A signed-in visitor never sees the public landing again, even if
  // their (per-account) learning profile has no diagnostic yet — the
  // auth funnel now comes before onboarding, and "Начать бесплатно"
  // sends them to /login rather than onboarding directly (see
  // LandingDesktop/Mobile), so after a real sign-in they must land on
  // Home/the trainer, not bounce back to this anonymous-visitor gate.
  const showLanding = !user && onboardingCompleted === false && tab === 'home' && overlay === null;
  if (showLanding) {
    return isDesktop ? <LandingDesktop /> : <LandingMobile />;
  }

  return isDesktop ? <AppDesktop /> : <AppMobile />;
}
