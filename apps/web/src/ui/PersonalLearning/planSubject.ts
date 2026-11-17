import { useCallback, useSyncExternalStore } from 'react';

/** The subjects a personal plan exists for, in the switcher's order. */
export const PLAN_SUBJECTS = [
  { id: 'russian', label: 'Русский язык' },
  { id: 'math', label: 'Профильная математика' },
] as const;

export type PlanSubject = (typeof PLAN_SUBJECTS)[number]['id'];

const KEY = 'zybrilka.personalPlan.subject';
const listeners = new Set<() => void>();
let memory: PlanSubject | null = null;

function read(): PlanSubject {
  if (memory) return memory;
  try {
    const v = window.localStorage.getItem(KEY);
    if (v === 'math' || v === 'russian') return (memory = v);
  } catch {
    // Storage blocked (private mode, WebView): the in-memory value is used.
  }
  return 'math';
}

export function isPlanSubject(v: unknown): v is PlanSubject {
  return v === 'math' || v === 'russian';
}

/** Remembers the chosen subject (for this tab and the next visits). */
export function rememberPlanSubject(subject: PlanSubject): void {
  memory = subject;
  try {
    window.localStorage.setItem(KEY, subject);
  } catch {
    // Not persisted; kept for this session in memory.
  }
  listeners.forEach((l) => l());
}

/**
 * The personal plan's subject: one choice shared by every plan view
 * (learning centre, recommendations, home), kept across screens and
 * visits. Every request is made for this one subject — never mixed.
 */
export function usePlanSubject(): [PlanSubject, (s: PlanSubject) => void] {
  const subject = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    read,
    () => 'math' as PlanSubject,
  );
  const set = useCallback((s: PlanSubject) => rememberPlanSubject(s), []);
  return [subject, set];
}

/** Test helper: forget the in-memory choice. */
export function resetPlanSubjectForTests(): void {
  memory = null;
}
