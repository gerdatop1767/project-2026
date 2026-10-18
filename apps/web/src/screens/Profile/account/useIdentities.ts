import { useCallback, useEffect, useState } from 'react';
import type { IdentitiesResponse } from '@zybrilka/shared';
import { getIdentities } from '../../../lib/api.js';

export interface IdentitiesState {
  data: IdentitiesResponse | null;
  failed: boolean;
  reload: () => void;
  /** Use the fresh list a mutation (unlink) already returned. */
  replace: (next: IdentitiesResponse) => void;
}

/**
 * The account's sign-in methods, loaded once per profile screen and shared by
 * the identity card (which names how you sign in) and the «Способы входа»
 * section (which manages them), so the two can never disagree.
 */
export function useIdentities(): IdentitiesState {
  const [data, setData] = useState<IdentitiesResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getIdentities()
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const reload = useCallback(() => {
    setFailed(false);
    setReloadKey((key) => key + 1);
  }, []);

  return { data, failed, reload, replace: setData };
}
