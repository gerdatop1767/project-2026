/**
 * The floating «Telegram» button (ui/TelegramPromo): hidden for 24 hours
 * after it is closed with × or followed. The moment is kept in
 * localStorage; when storage is unavailable (private mode, blocked site
 * data) the choice lasts for this page view only — never an error.
 */
export const TELEGRAM_CHANNEL_URL = 'https://t.me/zybr1lka';
export const PROMO_HIDE_MS = 24 * 60 * 60 * 1000;
const STORAGE_KEY = 'zybrilka-tg-promo-hidden-until';

let memoryHiddenUntil = 0;

export function promoHiddenUntil(): number {
  let stored = 0;
  try {
    stored = Number(window.localStorage.getItem(STORAGE_KEY) ?? 0) || 0;
  } catch {
    stored = 0;
  }
  return Math.max(stored, memoryHiddenUntil);
}

export function isPromoHidden(now = Date.now()): boolean {
  return promoHiddenUntil() > now;
}

/** × or a click on the button: not shown again for 24 hours. */
export function hidePromo(now = Date.now()): void {
  const until = now + PROMO_HIDE_MS;
  memoryHiddenUntil = until;
  try {
    window.localStorage.setItem(STORAGE_KEY, String(until));
  } catch {
    // Storage unavailable: remembered for this page view only.
  }
}

/** For tests. */
export function resetPromoForTests(): void {
  memoryHiddenUntil = 0;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
