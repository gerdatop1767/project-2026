import { useConsent } from '../../lib/consent.js';
import { useNavigation, type OverlayRoute } from '../../lib/navigation.js';
import { useIsDesktop } from '../../lib/useIsDesktop.js';
import { CookieBanner } from '../CookieBanner/CookieBanner.js';
import { TelegramPromo } from '../TelegramPromo/TelegramPromo.js';

/** Screens whose bottom area is working space (answer, check button, sign
 * in, the menu): the Telegram button stays away from them. */
const promoFreeScreens: ReadonlySet<OverlayRoute['screen']> = new Set([
  'task',
  'result',
  'learningSession',
  'menu',
  'login',
  'onboarding',
  'telegramReturn',
]);

/**
 * The page's fixed bottom elements, coordinated in one place: the cookie
 * banner first; the Telegram button only once the cookie choice is made,
 * so the two are never on screen together. On a phone the button shows on
 * the home screen only — elsewhere it would sit over lists and answers; on
 * a desktop the corner is free on every screen except the working ones.
 */
export function FloatingLayer() {
  const consent = useConsent();
  const { tab, overlay } = useNavigation();
  const isDesktop = useIsDesktop();
  const placeAllowed = isDesktop
    ? !(overlay && promoFreeScreens.has(overlay.screen))
    : overlay === null && tab === 'home';
  const promoAllowed = consent !== null && placeAllowed;
  return (
    <>
      <CookieBanner />
      {promoAllowed && <TelegramPromo />}
    </>
  );
}
