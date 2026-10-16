import { useEffect, useState } from 'react';
import { addFavorite, listFavoriteTaskIds, removeFavorite } from './api.js';
import { registerPrivateCacheReset } from './privateCaches.js';

// Module-scoped so every `useFavorite` call across the app (Task
// screen, later a favorites list, ...) shares one fetch instead of
// each task mount re-requesting the full set — there's only ever one
// "this browser"'s favorites (see apps/api's anonymous identity), so a
// single cache is correct, not just an optimization. Invalidated after
// every successful add/remove so the next task to mount (or this one,
// on a slow network re-check) always sees the latest server state.
let cache: Promise<ReadonlySet<string>> | null = null;

function loadFavoriteIds(): Promise<ReadonlySet<string>> {
  cache ??= listFavoriteTaskIds()
    .then((r) => new Set(r.taskIds))
    .catch(() => new Set<string>());
  return cache;
}

function invalidate() {
  cache = null;
}

// Favorites belong to one account: forget them on sign-out / account
// change (see privateCaches.ts), or the next account would be shown the
// previous one's bookmarks — and a failed (signed-out) fetch, which
// resolves to an empty set, would stay cached across the next sign-in.
registerPrivateCacheReset(invalidate);

/**
 * Invalidates the shared favorites cache from outside `useFavorite`
 * itself — used by the real favorites list (Subject → Избранное) after
 * it removes a task directly, so a bookmark button elsewhere (e.g. if
 * the user reopens that task) re-fetches instead of showing stale
 * "favorited" state from before the removal.
 */
export function invalidateFavoritesCache() {
  invalidate();
}

/** Test-only: the module-level cache otherwise outlives a single `it()`
 * within a test file (there's only one real "this browser" in
 * production, so one cache is correct there), which would leak one
 * test's favorited state into the next. */
export function resetFavoritesCacheForTests() {
  cache = null;
}

export interface UseFavoriteResult {
  /** null while the initial fetch is still in flight. */
  isFavorite: boolean | null;
  toggle: () => void;
}

/**
 * Real, server-backed favorite state for one task (Task Workspace
 * block — "избранное must be real, never local-only state"). Task A
 * favorited, Task B not, back to Task A still favorited: each mount
 * re-derives its own boolean from the shared set keyed by `taskId`, so
 * navigating between tasks never leaks one task's state into another.
 */
export function useFavorite(taskId: string): UseFavoriteResult {
  // Starts null (unknown) rather than reset-on-taskId-change: every
  // caller (TaskDesktop, TaskChrome) is itself remounted by its parent
  // whenever the task changes (`key={taskId}` — see AppDesktop.tsx/
  // AppMobile.tsx), so a fresh `null` on mount is already guaranteed
  // without an extra synchronous setState in this effect.
  const [isFavorite, setIsFavorite] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadFavoriteIds().then((ids) => {
      if (!cancelled) setIsFavorite(ids.has(taskId));
    });
    return () => {
      cancelled = true;
    };
  }, [taskId]);

  function toggle() {
    if (isFavorite === null) return;
    const next = !isFavorite;
    setIsFavorite(next);
    const request = next ? addFavorite(taskId) : removeFavorite(taskId);
    void request
      .then(() => invalidate())
      .catch(() => {
        // Revert the optimistic flip — the server never applied it, so
        // showing it as changed would lie about real state (Task
        // Workspace block: "must be real, not local-only").
        setIsFavorite(!next);
      });
  }

  return { isFavorite, toggle };
}
