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

/** The signed launch string, or `null` outside Telegram. */
export function getTelegramInitData(): string | null {
  if (typeof window === 'undefined') return null;
  return window.Telegram?.WebApp?.initData || launchData;
}

export function isTelegramMiniApp(): boolean {
  return getTelegramInitData() !== null;
}

let prepared = false;

/**
 * Inside Telegram only: load the official helper script (never for ordinary
 * visitors), tell Telegram the app is ready, expand it, and mark the document
 * so CSS can apply Telegram's safe-area insets. Safe to call repeatedly.
 */
export function prepareTelegramApp(): void {
  if (prepared || !isTelegramMiniApp()) return;
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
