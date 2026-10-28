import { useEffect, useState } from 'react';
import { getVariantAttempt } from './api.js';
import { hasDraft } from './answerDrafts.js';
import { registerPrivateCacheReset } from './privateCaches.js';

/**
 * What the number panel shows about each task of a variant attempt — only
 * what really happened: «верно» / «неверно» (its first answer in this
 * attempt was checked), «есть ответ» (typed here, not checked yet),
 * «открыто» (opened, no answer). Nothing for a task never opened —
 * opening alone never makes a task solved.
 */
export type TaskMark = 'correct' | 'incorrect' | 'draft' | 'opened';

type ServerMark = 'correct' | 'incorrect' | 'opened';

/** Last known marks per attempt: a newly opened task shows them at once
 * while the fresh ones load. */
const known = new Map<string, ReadonlyMap<string, ServerMark>>();
registerPrivateCacheReset(() => known.clear());

export function useVariantTaskMarks(
  sessionId: string | null,
  currentTaskId: string,
  taskIds: readonly string[],
): Readonly<Record<string, TaskMark>> {
  const [server, setServer] = useState<ReadonlyMap<string, ServerMark> | null>(() =>
    sessionId ? (known.get(sessionId) ?? null) : null,
  );

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    getVariantAttempt(sessionId)
      .then((detail) => {
        const marks = new Map<string, ServerMark>();
        for (const t of detail.tasks) {
          if (t.outcome === 'correct' || t.outcome === 'incorrect') marks.set(t.taskId, t.outcome);
          else if (t.outcome === 'skipped') marks.set(t.taskId, 'opened');
        }
        known.set(sessionId, marks);
        if (!cancelled) setServer(marks);
      })
      .catch(() => {
        // No marks — the panel still works, just without them.
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, currentTaskId]);

  if (!sessionId) return {};
  const out: Record<string, TaskMark> = {};
  for (const id of taskIds) {
    const mark = server?.get(id);
    if (mark === 'correct' || mark === 'incorrect') out[id] = mark;
    else if (id !== currentTaskId && hasDraft(id)) out[id] = 'draft';
    else if (mark === 'opened') out[id] = 'opened';
  }
  return out;
}
