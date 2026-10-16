import { initialCanvasState, type CanvasState } from './canvasEngine.js';
import { registerPrivateCacheReset } from './privateCaches.js';

/**
 * Session-scoped canvas persistence, keyed by taskId (Task Workspace
 * block 4). Deliberately an in-memory module-level Map, not
 * sessionStorage/IndexedDB or a DB table — CLAUDE.md Section 13 asks
 * for "a comfortable digital draft board", never a permanent
 * per-user artifact, and the one hard requirement ("don't lose the
 * drawing on open/close, or when navigating between tasks and back")
 * is fully satisfied by state that survives for the tab's lifetime.
 *
 * Why not plain React state owned by TaskDesktop/TaskMobile: those
 * components remount on every task change (`key={taskId}` — see
 * AppDesktop.tsx/AppMobile.tsx), which would lose task #6's drawing
 * the moment the user opens task #7, even though the spec explicitly
 * requires it to still be there on returning to #6 "пока продолжается
 * текущая Task session". A module-level store keyed by taskId outlives
 * any single mount, so navigating away and back restores it, while
 * `clearCanvasState` (called on a real attempt submission — see
 * TaskDesktop/TaskMobile's handleCheck) gives the "new attempt starts
 * with an empty canvas" boundary the spec also asks for.
 */
const store = new Map<string, CanvasState>();

// A drawing is the previous account's scratch work: drop every draft when
// the signed-in identity ends or changes (NOT on refresh / same-user
// re-checks — see privateCaches.ts).
registerPrivateCacheReset(() => store.clear());

export function getCanvasState(taskId: string): CanvasState {
  return store.get(taskId) ?? initialCanvasState();
}

export function setCanvasState(taskId: string, state: CanvasState): void {
  store.set(taskId, state);
}

export function clearCanvasState(taskId: string): void {
  store.delete(taskId);
}

/** Test-only: the module-level map otherwise outlives a single `it()`
 * within a test file. */
export function resetCanvasStoreForTests(): void {
  store.clear();
}
