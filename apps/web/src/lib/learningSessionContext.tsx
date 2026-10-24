import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { track } from './analytics.js';
import type {
  LearningSessionResponse,
  LearningSessionSummary,
  LearningSessionVariantInfo,
} from '@zybrilka/shared';
import type { Route } from './navigation.js';
import { registerPrivateCacheReset } from './privateCaches.js';

/**
 * ZUBRILKA LEARNING INTELLIGENCE, Phase 10 — the one explicit boundary
 * around "am I currently inside a real backend learning session, and
 * which task/position is it on". Nothing here computes a
 * recommendation, score, or next task — it only remembers what the
 * backend last reported (either the active task/position, or the final
 * summary), so the existing Task/Result screens can show a small,
 * optional indicator and an extra "next"/"finish" action WITHOUT
 * branching their whole render tree on a boolean
 * (`if (learningMode) {...}` spread everywhere) and without a second
 * task-solving system.
 *
 * `currentTaskId` is what makes this safe to use from normal task
 * navigation too: Task/Result only render session UI when the task
 * they're showing actually matches `currentTaskId` — a sibling, retry,
 * or "Другие задания" jump (all genuinely outside the session) simply
 * won't match, so normal task mode stays independent without this
 * context ever needing to actively "detect" and clear itself for
 * those cases.
 */
export type LearningSessionState =
  | {
      readonly status: 'active';
      readonly sessionId: string;
      readonly subjectId: string;
      readonly currentTaskId: string;
      readonly currentTaskNumber: number;
      readonly position: number;
      readonly total: number;
      /** Present only for a VARIANT session (Training's "Вариант" mode) —
       * absent for Smart Training. */
      readonly variant?: LearningSessionVariantInfo;
    }
  | {
      readonly status: 'completed';
      readonly sessionId: string;
      readonly subjectId: string;
      readonly position: number;
      readonly total: number;
      readonly summary: LearningSessionSummary;
      readonly variant?: LearningSessionVariantInfo;
    };

interface LearningSessionContextValue {
  readonly session: LearningSessionState | null;
  readonly setSession: (session: LearningSessionState) => void;
  readonly clearSession: () => void;
}

/** No-op default — used when a consumer renders outside
 * `LearningSessionProvider` (the real app always wraps via `main.tsx`;
 * this only matters for screens/tests that render Task/Result/Training
 * in isolation and don't care about sessions at all). */
const noopSessionContext: LearningSessionContextValue = {
  session: null,
  setSession: () => undefined,
  clearSession: () => undefined,
};

const LearningSessionContext = createContext<LearningSessionContextValue>(noopSessionContext);

export function LearningSessionProvider({ children }: { children: ReactNode }) {
  const [session, setSessionState] = useState<LearningSessionState | null>(null);

  const setSession = useCallback((next: LearningSessionState) => {
    setSessionState(next);
  }, []);
  const clearSession = useCallback(() => {
    setSessionState(null);
  }, []);

  // The active session (task, position, summary) is the signed-in
  // account's: forget it on sign-out / account change.
  useEffect(() => registerPrivateCacheReset(clearSession), [clearSession]);

  const value = useMemo(
    () => ({ session, setSession, clearSession }),
    [session, setSession, clearSession],
  );

  return (
    <LearningSessionContext.Provider value={value}>{children}</LearningSessionContext.Provider>
  );
}

/** Always available (never throws) — most consumers (normal Task/Result)
 * are OUTSIDE any session and should just get `null`, not be forced
 * into a Provider they don't care about. */
export function useLearningSessionContext(): LearningSessionContextValue {
  return useContext(LearningSessionContext);
}

/** Convenience for Task/Result: the active session state ONLY when it
 * matches the task currently being shown — see the type doc above for
 * why this is what keeps normal task mode independent. */
export function useActiveLearningSessionForTask(
  taskId: string,
): Extract<LearningSessionState, { status: 'active' }> | null {
  const { session } = useLearningSessionContext();
  return session && session.status === 'active' && session.currentTaskId === taskId
    ? session
    : null;
}

/**
 * The one place that turns a raw `LearningSessionResponse` (from
 * `startLearningSession`/`getLearningSessionNext`/`getLearningSession`)
 * into context state + navigation — shared by Training's "Умная
 * тренировка" start, Result's "Следующее задание", and the
 * `LearningSession` recovery screen, so each of those call sites does
 * nothing but call this instead of re-deriving the same branching.
 * `null` (no session could be started/continued) is left to the caller
 * to report — this never silently swallows it.
 */
export function applyLearningSessionResponse(
  response: LearningSessionResponse,
  setSession: (session: LearningSessionState) => void,
  navigate: (route: Route) => void,
): 'active' | 'completed' | 'none' {
  if (!response) return 'none';

  if (response.status === 'completed') {
    track('training_completed', { subjectId: response.subject });
    setSession({
      status: 'completed',
      sessionId: response.sessionId,
      subjectId: response.subject,
      position: response.position,
      total: response.total,
      summary: response.summary,
      variant: response.variant,
    });
    navigate({ screen: 'learningSession', sessionId: response.sessionId });
    return 'completed';
  }

  setSession({
    status: 'active',
    sessionId: response.sessionId,
    subjectId: response.subject,
    currentTaskId: response.task.id,
    currentTaskNumber: response.task.taskNumber,
    position: response.position,
    total: response.total,
    variant: response.variant,
  });
  navigate({
    screen: 'task',
    subjectId: response.task.subjectId,
    taskNumber: response.task.taskNumber,
    taskId: response.task.id,
    returnTo: { screen: 'learningSession', sessionId: response.sessionId },
  });
  return 'active';
}
