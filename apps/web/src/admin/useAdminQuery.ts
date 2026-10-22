import { useCallback, useEffect, useState } from 'react';
import { adminApi, type Query } from './adminApi.js';

export type QueryState<T> =
  | { status: 'loading'; data: T | null; error: null }
  | { status: 'error'; data: T | null; error: unknown }
  | { status: 'ready'; data: T; error: null };

interface Settled<T> {
  key: string;
  data: T | null;
  error: unknown;
}

/**
 * GET an admin endpoint. A change of path/query aborts the request in
 * flight (no stale response can overwrite a newer one); `reload()` asks
 * again. While a new request runs, the previous data stays visible.
 */
export function useAdminQuery<T>(path: string | null, query?: Query) {
  const queryJson = JSON.stringify(query ?? {});
  const [nonce, setNonce] = useState(0);
  const key = `${path}|${queryJson}|${nonce}`;
  const [settled, setSettled] = useState<Settled<T>>({ key: '', data: null, error: null });

  useEffect(() => {
    if (path === null) return;
    const controller = new AbortController();
    adminApi
      .get<T>(path, JSON.parse(queryJson) as Query, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setSettled({ key, data, error: null });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setSettled((prev) => ({ key, data: prev.data, error }));
      });
    return () => controller.abort();
  }, [path, queryJson, key]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  let state: QueryState<T>;
  if (settled.key !== key) state = { status: 'loading', data: settled.data, error: null };
  else if (settled.error !== null)
    state = { status: 'error', data: settled.data, error: settled.error };
  else state = { status: 'ready', data: settled.data as T, error: null };
  return { ...state, reload };
}
