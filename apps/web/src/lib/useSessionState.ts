import { useEffect, useState } from 'react';

function read<T>(key: string, fallback: T): T {
  try {
    const raw = window.sessionStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

/**
 * State that survives leaving the screen and coming back in the same tab
 * (Training → a task → Back): kept in sessionStorage. A convenience only —
 * storage may be unavailable (private mode, Telegram WebView quirks), and
 * then this is plain useState.
 */
export function useSessionState<T>(
  key: string,
  initial: T,
): [T, (value: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => read(key, initial));
  useEffect(() => {
    try {
      window.sessionStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Not kept — the screen still works.
    }
  }, [key, value]);
  return [value, setValue];
}
