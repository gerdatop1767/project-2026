import { useState } from 'react';
import { acknowledgeEssay } from './api.js';

/**
 * "Я решил" state for an essay task (e.g. EGE Russian 27) — deliberately
 * NOT a graded attempt (see `EssayNotGradableError`), just "the user
 * says they wrote it", persisted via `POST /tasks/:id/essay-ack` and
 * idempotent across repeat clicks. `initialAcknowledged` is whatever
 * the server already sent for this task (undefined while the task is
 * still loading); `acknowledgedLocal` only ever flips false -> true
 * from this hook's own `acknowledge()` call, so the two are simply
 * OR'd together — no effect needed to keep them in sync.
 */
export function useEssayAck(taskId: string | undefined, initialAcknowledged: boolean | undefined) {
  const [acknowledgedLocal, setAcknowledgedLocal] = useState(false);
  const [acknowledging, setAcknowledging] = useState(false);
  const acknowledged = (initialAcknowledged ?? false) || acknowledgedLocal;

  function acknowledge() {
    if (!taskId || acknowledged || acknowledging) return;
    setAcknowledging(true);
    void acknowledgeEssay(taskId)
      .then(() => setAcknowledgedLocal(true))
      .finally(() => setAcknowledging(false));
  }

  return { acknowledged, acknowledging, acknowledge };
}
