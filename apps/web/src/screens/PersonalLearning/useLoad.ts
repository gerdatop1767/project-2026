import { useEffect, useState } from 'react';

export type Load<T> =
  { status: 'loading' } | { status: 'error'; notFound: boolean } | { status: 'ready'; data: T };

/** Fetches `fetcher()` for `key`; `reload()` fetches again, `set` replaces the data. */
export function useLoad<T>(key: string, fetcher: () => Promise<T>) {
  const [attempt, setAttempt] = useState(0);
  const fullKey = `${key}|${attempt}`;
  const [result, setResult] = useState<{ key: string; state: Load<T> } | null>(null);
  const state: Load<T> = result && result.key === fullKey ? result.state : { status: 'loading' };
  useEffect(() => {
    let live = true;
    fetcher().then(
      (data) => live && setResult({ key: fullKey, state: { status: 'ready', data } }),
      (error: unknown) =>
        live &&
        setResult({
          key: fullKey,
          state: { status: 'error', notFound: (error as { status?: number })?.status === 404 },
        }),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the key names the request
  }, [fullKey]);
  return {
    state,
    reload: () => setAttempt((n) => n + 1),
    set: (data: T) => setResult({ key: fullKey, state: { status: 'ready', data } }),
  };
}
