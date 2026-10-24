import { useEffect, useState } from 'react';
import { getTaskCountsBySubject } from './api.js';

/**
 * Real published-task counts per subject (one request), shared by every
 * screen that needs to replace the static `subjects.ts` demo
 * `taskCount` field — Home's subject cards, Subject's hero, and the
 * Subject Catalog grid (Desktop + Mobile) all want the exact same data,
 * so this is the one place that fetches it instead of each screen
 * duplicating the same effect. `null` until loaded (or on failure) —
 * callers show a neutral placeholder rather than a fabricated number.
 */
export function useTaskCountsBySubject(): Record<string, number> | null {
  const [counts, setCounts] = useState<Record<string, number> | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Started inside a promise chain so even a synchronous failure lands in
    // the `.catch` below instead of escaping the effect.
    void Promise.resolve()
      .then(() => getTaskCountsBySubject())
      .then((res) => {
        if (cancelled) return;
        const map: Record<string, number> = {};
        for (const item of res.items) map[item.subjectId] = item.count;
        setCounts(map);
      })
      .catch(() => {
        // Stays null — callers show a neutral placeholder.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return counts;
}
