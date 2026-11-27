import { registerPrivateCacheReset } from './privateCaches.js';

/**
 * The latest server-checked result of each task answered in this visit
 * (tab), by task id. It lets a «По номерам» / «Мои ошибки» list mark its
 * numbers the way a variant attempt does — only what really happened:
 * the server's verdict on an answer actually sent, never a guess. Cleared
 * with the other private caches on sign-out.
 */
const results = new Map<string, 'correct' | 'incorrect'>();
const listeners = new Set<() => void>();
let version = 0;

function changed() {
  version++;
  for (const fn of listeners) fn();
}

registerPrivateCacheReset(() => {
  results.clear();
  changed();
});

export function recordTaskResult(taskId: string, correct: boolean): void {
  results.set(taskId, correct ? 'correct' : 'incorrect');
  changed();
}

/** Bumps on every change — a snapshot for useSyncExternalStore. */
export function taskResultsVersion(): number {
  return version;
}

export function taskResult(taskId: string): 'correct' | 'incorrect' | undefined {
  return results.get(taskId);
}

export function subscribeTaskResults(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
