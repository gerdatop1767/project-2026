/**
 * Telegram Mini App glue. The ONLY thing sent to our server is the raw
 * `initData` string; the server verifies its signature with the bot token
 * (which never reaches the browser) and decides who the user is. Nothing
 * read here (`initDataUnsafe`, names, ids) is used for identity.
 */

interface TelegramWebApp {
  initData?: string;
  ready?: () => void;
  expand?: () => void;
  /** Opens a link in the device's external browser; the Mini App stays
   * open. Telegram only honours it in response to a user tap. */
  openLink?: (url: string, options?: { try_instant_view?: boolean }) => void;
}
declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

const SCRIPT_URL = 'https://telegram.org/js/telegram-web-app.js';

/** Telegram opens the Mini App with the launch data in the URL hash
 * (`#tgWebAppData=<initData>&tgWebAppVersion=…`). Read it once, at startup,
 * before anything (router, redirects) can rewrite the URL. */
function readLaunchHash(): string | null {
  try {
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    return params.get('tgWebAppData') || null;
  } catch {
    return null;
  }
}

const launchData = typeof window === 'undefined' ? null : readLaunchHash();

/** Remembered for this WebView session: a page reload inside the Mini App
 * (e.g. after signing out, `location.replace('/')`) drops the launch hash,
 * but it is still the same Telegram WebView. Telegram's own script restores
 * `initData` from its sessionStorage once it is loaded again. */
const TG_SESSION_KEY = 'zybrilka_tg_webview';
function rememberTelegramSession(): boolean {
  try {
    if (launchData) window.sessionStorage.setItem(TG_SESSION_KEY, '1');
    return window.sessionStorage.getItem(TG_SESSION_KEY) === '1';
  } catch {
    return launchData !== null;
  }
}
const telegramSession = typeof window === 'undefined' ? false : rememberTelegramSession();

/** The signed launch string, or `null` outside Telegram. */
export function getTelegramInitData(): string | null {
  if (typeof window === 'undefined') return null;
  return window.Telegram?.WebApp?.initData || launchData;
}

export function isTelegramMiniApp(): boolean {
  return getTelegramInitData() !== null;
}

/** Running inside Telegram's WebView (this load or earlier in the same
 * WebView session) — decides how external sign-in pages are opened. */
export function isInTelegramWebView(): boolean {
  return isTelegramMiniApp() || telegramSession;
}

/**
 * Opens `url` OUTSIDE Telegram — in Safari/Chrome — through Telegram's
 * official `WebApp.openLink` (VK ID can't run inside the WebView). Must be
 * called synchronously from a tap. Returns false when the Telegram API is
 * not available, so the caller can offer a plain link instead.
 */
export function openExternalLink(url: string): boolean {
  const openLink = window.Telegram?.WebApp?.openLink;
  if (!openLink) return false;
  openLink(url);
  return true;
}

let prepared = false;

/**
 * Inside Telegram only: load the official helper script (never for ordinary
 * visitors), tell Telegram the app is ready, expand it, and mark the document
 * so CSS can apply Telegram's safe-area insets. Safe to call repeatedly.
 */
export function prepareTelegramApp(): void {
  if (prepared || !isInTelegramWebView()) return;
  prepared = true;
  document.documentElement.dataset.telegram = 'true';

  const start = () => {
    window.Telegram?.WebApp?.ready?.();
    window.Telegram?.WebApp?.expand?.();
  };
  if (window.Telegram?.WebApp) {
    start();
    return;
  }
  const script = document.createElement('script');
  script.src = SCRIPT_URL;
  script.async = true;
  script.onload = start;
  document.head.appendChild(script);
}
