import { useConsent } from '../../lib/consent.js';
import { useNavigation, type OverlayRoute } from '../../lib/navigation.js';
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
 * so the two are never on screen together.
 */
export function FloatingLayer() {
  const consent = useConsent();
  const { overlay } = useNavigation();
  const promoAllowed = consent !== null && !(overlay && promoFreeScreens.has(overlay.screen));
  return (
    <>
      <CookieBanner />
      {promoAllowed && <TelegramPromo />}
    </>
  );
}
