import { AsyncLocalStorage } from 'node:async_hooks';
import type { HttpFetch } from './deps.js';

/**
 * The running queue task's cancellation scope. The queue runs every handler
 * inside `runInTaskScope`; the AI gateway and the integrations' fetch read
 * the signal from here, so a timeout or an emergency stop aborts the model
 * call / HTTP request in flight — not just the bookkeeping around it —
 * without threading a signal through every agent function.
 */
interface TaskScope {
  signal: AbortSignal;
  taskId: string;
}

const storage = new AsyncLocalStorage<TaskScope>();

export function runInTaskScope<T>(scope: TaskScope, fn: () => Promise<T>): Promise<T> {
  return storage.run(scope, fn);
}

export function currentTaskSignal(): AbortSignal | undefined {
  return storage.getStore()?.signal;
}

/** Throws the abort reason if the current task was cancelled. */
export function throwIfTaskAborted() {
  storage.getStore()?.signal.throwIfAborted();
}

/** A fetch whose requests are cancelled together with the current task. */
export function taskScopedFetch(inner: HttpFetch): HttpFetch {
  return (url, init) => {
    const taskSignal = currentTaskSignal();
    if (!taskSignal) return inner(url, init);
    const signal = init?.signal ? AbortSignal.any([init.signal, taskSignal]) : taskSignal;
    return inner(url, { ...init, signal });
  };
}
