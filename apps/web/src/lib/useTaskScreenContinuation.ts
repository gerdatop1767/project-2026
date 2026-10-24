import { useEffect, useState } from 'react';

/** When the previous task screen went away (performance.now()). */
let lastTaskScreenLeftAt = Number.NEGATIVE_INFINITY;

/** A remount this soon after another task screen unmounted is a switch
 * between tasks, not a fresh arrival. */
const SWITCH_WINDOW_MS = 500;

/**
 * Whether this task screen REPLACES another one that has just gone away —
 * Prev/Next, a number in the strip, a row in the task list. The router
 * remounts the task screen for every task (key={taskId}), so without this
 * each switch re-played the whole screen's entrance: the strip, header and
 * progress faded and rose again, as if the user had left and come back.
 * On a switch the chrome should simply stay put, and only the task's own
 * content changes.
 */
export function useTaskScreenContinuation(): boolean {
  const [continuing] = useState(() => performance.now() - lastTaskScreenLeftAt < SWITCH_WINDOW_MS);
  useEffect(
    () => () => {
      lastTaskScreenLeftAt = performance.now();
    },
    [],
  );
  return continuing;
}
