import { useCallback, useSyncExternalStore } from 'react';

/**
 * The colour theme: dark (Zybrilka's own look, the default) or light.
 *
 * One source of truth: the `data-theme` attribute on <html>, which
 * tokens.css keys its light palette off. The choice is kept in
 * localStorage, and index.html applies it with a tiny inline script BEFORE
 * the app's CSS and JS load, so a light-theme visitor never sees a dark
 * frame first (or the other way round). This module keeps React in step
 * with that attribute and changes it when the visitor flips the switch.
 */
export type Theme = 'dark' | 'light';

/** localStorage key — also read by the inline script in index.html. */
export const THEME_STORAGE_KEY = 'zybrilka-theme';

/** Browser chrome / Telegram header colour per theme (= --color-bg-base). */
const CHROME_COLOR: Record<Theme, string> = { dark: '#05070f', light: '#f4f3fb' };

const listeners = new Set<() => void>();

export function currentTheme(): Theme {
  if (typeof document === 'undefined') return 'dark';
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

interface TelegramThemeApi {
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
}

/** Puts the theme on the page (attribute, browser chrome, Telegram's own bars). */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', CHROME_COLOR[theme]);
  const webApp = (window as unknown as { Telegram?: { WebApp?: TelegramThemeApi } }).Telegram
    ?.WebApp;
  try {
    webApp?.setHeaderColor?.(CHROME_COLOR[theme]);
    webApp?.setBackgroundColor?.(CHROME_COLOR[theme]);
  } catch {
    // Older Telegram clients reject custom colours — the page itself is still themed.
  }
  for (const listener of [...listeners]) listener();
}

/** Applies and remembers the visitor's choice. */
export function setTheme(theme: Theme): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Storage blocked (private mode): the theme still applies for this visit.
  }
  applyTheme(theme);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The current theme and a way to change it, for the menu switches. */
export function useTheme(): [Theme, (theme: Theme) => void] {
  const theme = useSyncExternalStore(subscribe, currentTheme, () => 'dark' as Theme);
  const change = useCallback((next: Theme) => setTheme(next), []);
  return [theme, change];
}
