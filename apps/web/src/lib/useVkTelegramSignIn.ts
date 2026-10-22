import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, claimVkHandoff, startVkHandoff } from './api.js';
import { openExternalLink } from './telegramMiniApp.js';

/**
 * VK ID sign-in from inside the Telegram Mini App.
 *
 * VK ID can't run in Telegram's WebView, so it opens in the device's
 * external browser (Telegram's official `WebApp.openLink`). The browser
 * has its own cookies, so the server hands the signed-in account back to
 * this WebView through a one-time handoff (see apps/api handoff.ts): this
 * hook prepares it, opens the browser, then claims the result — polling
 * while waiting and again the moment the visitor returns to Telegram.
 *
 * The handoff is prepared BEFORE the tap: Telegram honours `openLink` only
 * in direct response to a tap, so the tap itself must not wait for the
 * network.
 */
export type VkTelegramPhase =
  | 'preparing' // getting a fresh start link
  | 'ready' // the button opens VK ID right away
  | 'waiting' // VK ID is open in the browser; we wait for the result
  | 'done' // signed in here
  | 'unavailable'; // VK sign-in is not configured on the server

export type VkTelegramNotice = 'cancelled' | 'failed' | 'expired' | 'error' | null;

const POLL_MS = 2500;
/** A prepared link is renewed before the server's 10-minute expiry. */
const REFRESH_MS = 8 * 60 * 1000;
/** Give up waiting a little after the server would expire it anyway. */
const WAIT_LIMIT_MS = 11 * 60 * 1000;

/** Set when the tap opened the browser; survives a reload of this WebView
 * (Telegram may reload the Mini App while the visitor is in the browser),
 * so the reloaded app waits for THAT sign-in instead of starting over. */
const OPENED_KEY = 'zybrilka_vk_handoff_opened_at';
function markOpened(on: boolean) {
  try {
    if (on) window.sessionStorage.setItem(OPENED_KEY, String(Date.now()));
    else window.sessionStorage.removeItem(OPENED_KEY);
  } catch {
    // Storage blocked: a reload simply starts a fresh link.
  }
}
function openedRecently(): boolean {
  try {
    const at = Number(window.sessionStorage.getItem(OPENED_KEY));
    return at > 0 && Date.now() - at < WAIT_LIMIT_MS;
  } catch {
    return false;
  }
}

export function useVkTelegramSignIn(enabled: boolean, onSignedIn: () => Promise<void>) {
  const [phase, setPhase] = useState<VkTelegramPhase>('preparing');
  const [notice, setNotice] = useState<VkTelegramNotice>(null);
  const [startUrl, setStartUrl] = useState<string | null>(null);
  const generation = useRef(0);

  /** Asks the server for a fresh start link (state is only set when it answers). */
  const load = useCallback((mine: number) => {
    startVkHandoff()
      .then(({ startUrl: url }) => {
        if (generation.current !== mine) return;
        setStartUrl(url);
        setPhase('ready');
      })
      .catch((error: unknown) => {
        if (generation.current !== mine) return;
        if (error instanceof ApiError && error.status === 503) setPhase('unavailable');
        else {
          setNotice('error');
          setPhase('ready'); // the button retries the preparation
        }
      });
  }, []);

  const prepare = useCallback(() => {
    const mine = ++generation.current;
    setPhase('preparing');
    setStartUrl(null);
    load(mine);
  }, [load]);

  // On arrival, first ask about a handoff this WebView may already have —
  // Telegram can reload the Mini App while the visitor is in the browser:
  // a finished sign-in is collected right away, one still open in the
  // browser is waited for, and only otherwise a new link is prepared.
  useEffect(() => {
    if (!enabled) return;
    const mine = ++generation.current;
    claimVkHandoff()
      .then(async ({ status, started }) => {
        if (generation.current !== mine) return;
        if (status === 'ok') {
          markOpened(false);
          await onSignedIn();
          setPhase('done');
        } else if (status === 'pending' && (started || openedRecently())) {
          setPhase('waiting');
        } else {
          markOpened(false);
          load(mine);
        }
      })
      .catch(() => {
        if (generation.current === mine) load(mine);
      });
    return () => {
      generation.current++;
    };
  }, [enabled, load, onSignedIn]);

  // Keep the prepared link fresh while the visitor reads the screen.
  useEffect(() => {
    if (phase !== 'ready' || !startUrl) return;
    const id = window.setTimeout(prepare, REFRESH_MS);
    return () => window.clearTimeout(id);
  }, [phase, startUrl, prepare]);

  /** The tap on «Продолжить через VK ID». */
  const open = useCallback(() => {
    if (phase !== 'ready') return;
    if (!startUrl) {
      prepare();
      return;
    }
    setNotice(null);
    markOpened(true);
    if (!openExternalLink(startUrl)) window.open(startUrl, '_blank', 'noopener');
    setPhase('waiting');
  }, [phase, startUrl, prepare]);

  /** Back to the button with a brand-new link (the old one is abandoned). */
  const restart = useCallback(() => {
    markOpened(false);
    setNotice(null);
    prepare();
  }, [prepare]);

  // Waiting: ask now and then, and right away when Telegram is back in view.
  useEffect(() => {
    if (phase !== 'waiting') return;
    const mine = generation.current;
    const startedAt = Date.now();
    let busy = false;
    let finished = false;

    async function check() {
      if (busy || finished || generation.current !== mine) return;
      if (Date.now() - startedAt > WAIT_LIMIT_MS) {
        finished = true;
        markOpened(false);
        setNotice('expired');
        prepare();
        return;
      }
      busy = true;
      try {
        const { status } = await claimVkHandoff();
        if (finished || generation.current !== mine) return;
        if (status === 'pending') return;
        finished = true;
        markOpened(false);
        if (status === 'ok') {
          await onSignedIn();
          setPhase('done');
          return;
        }
        setNotice(
          status === 'cancelled' ? 'cancelled' : status === 'failed' ? 'failed' : 'expired',
        );
        prepare();
      } catch {
        // A network blip while waiting: just ask again on the next tick.
      } finally {
        busy = false;
      }
    }

    const id = window.setInterval(() => void check(), POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      finished = true;
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [phase, onSignedIn, prepare]);

  return { phase, notice, open, restart };
}
