import { useSyncExternalStore } from 'react';

/**
 * The visitor's cookie choice (docs/COOKIES.md).
 *
 * Kept in the first-party cookie `zc` (`a1` — optional analytics accepted,
 * `a0` — declined) so the API sees it too: until it says `a1` the server
 * neither sets nor reads the `zv` analytics cookie. A localStorage copy
 * covers a browser that drops the cookie; if neither can be written the
 * choice simply lasts for this page view and the banner asks again next
 * time — the site keeps working either way.
 *
 * Strictly necessary storage (the httpOnly session cookie, this choice
 * itself, the theme, small UI state) needs no consent and is not governed
 * here. There is no advertising or third-party analytics on the site, so
 * there is no category to switch on for them.
 */
export type ConsentChoice = { analytics: boolean };

export const CONSENT_COOKIE = 'zc';
const STORAGE_KEY = 'zybrilka-cookie-consent';
const MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

function readCookie(): string | null {
  try {
    const match = document.cookie.match(/(?:^|;\s*)zc=([^;]*)/);
    return match ? decodeURIComponent(match[1]!) : null;
  } catch {
    return null;
  }
}

function parse(value: string | null): ConsentChoice | null {
  if (value === 'a1') return { analytics: true };
  if (value === 'a0') return { analytics: false };
  return null;
}

function readStored(): ConsentChoice | null {
  const fromCookie = parse(readCookie());
  if (fromCookie) return fromCookie;
  try {
    return parse(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

let current: ConsentChoice | null | undefined;
const listeners = new Set<() => void>();

export function getConsent(): ConsentChoice | null {
  if (current === undefined) current = typeof document === 'undefined' ? null : readStored();
  return current;
}

export function setConsent(choice: ConsentChoice): void {
  const value = choice.analytics ? 'a1' : 'a0';
  try {
    const secure = window.location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${CONSENT_COOKIE}=${value}; Max-Age=${MAX_AGE_SECONDS}; Path=/; SameSite=Lax${secure}`;
  } catch {
    // Cookies blocked: the localStorage copy (or this page view) still holds it.
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // Storage unavailable (private mode, quota): remembered for this view only.
  }
  current = choice;
  for (const listener of listeners) listener();
}

/** Forgets the choice so the banner asks again («Настройки cookie»). */
export function resetConsent(): void {
  try {
    document.cookie = `${CONSENT_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax`;
  } catch {
    // ignore
  }
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
  current = null;
  for (const listener of listeners) listener();
}

export function subscribeConsent(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useConsent(): ConsentChoice | null {
  return useSyncExternalStore(subscribeConsent, getConsent, () => null);
}

/** For tests: start from «no choice yet». */
export function resetConsentCacheForTests(): void {
  current = undefined;
}
