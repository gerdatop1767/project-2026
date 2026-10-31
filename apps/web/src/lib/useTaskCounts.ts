import { useEffect, useMemo, useState } from 'react';
import type { TaskCountsBySubjectResponse } from '@zybrilka/shared';
import { getTaskCountsBySubject } from './api.js';

type TaskCountItem = TaskCountsBySubjectResponse['items'][number];

/**
 * GET /tasks/counts by subject id (one cached request shared by every
 * caller). `null` until loaded or on failure — callers show a neutral
 * placeholder rather than a fabricated number; a subject absent from the
 * response has no available tasks.
 */
export function useTaskCountItems(): Record<string, TaskCountItem> | null {
  const [items, setItems] = useState<Record<string, TaskCountItem> | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Started inside a promise chain so even a synchronous failure lands in
    // the `.catch` below instead of escaping the effect.
    void Promise.resolve()
      .then(() => getTaskCountsBySubject())
      .then((res) => {
        if (cancelled) return;
        const map: Record<string, TaskCountItem> = {};
        for (const item of res.items) map[item.subjectId] = item;
        setItems(map);
      })
      .catch(() => {
        // Stays null — callers show a neutral placeholder.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return items;
}

/**
 * Distinct tasks a student can open, per subject, from every source
 * (`countAllSources`) — the one number Home, the subject catalog, the
 * subject picker, Subject's «из N» and Statistics all show, so no two
 * screens disagree about a subject's size.
 */
export function useTaskCountsBySubject(): Record<string, number> | null {
  const items = useTaskCountItems();
  return useMemo(() => {
    if (!items) return null;
    const counts: Record<string, number> = {};
    for (const [subjectId, item] of Object.entries(items)) counts[subjectId] = item.countAllSources;
    return counts;
  }, [items]);
}
