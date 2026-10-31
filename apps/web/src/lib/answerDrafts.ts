import { registerPrivateCacheReset } from './privateCaches.js';

/**
 * Answers typed but not yet checked, per task — so moving between task
 * numbers (a variant's number panel, prev/next) never loses them. Kept for
 * this tab only (sessionStorage, plus memory when storage is unavailable)
 * and forgotten on sign-out. A draft is never an answer: nothing is sent
 * or counted until «Проверить».
 */
export type AnswerDraft = string | Readonly<Record<string, string>>;

const PREFIX = 'zb:answer-draft:';
const memory = new Map<string, AnswerDraft>();

function storage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function isEmpty(draft: AnswerDraft): boolean {
  return typeof draft === 'string'
    ? draft.trim() === ''
    : Object.values(draft).every((v) => v.trim() === '');
}

export function readDraft(taskId: string): AnswerDraft | null {
  if (memory.has(taskId)) return memory.get(taskId)!;
  try {
    const raw = storage()?.getItem(PREFIX + taskId);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'string') return parsed;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const entries = Object.entries(parsed).filter(
        (e): e is [string, string] => typeof e[1] === 'string',
      );
      return Object.fromEntries(entries);
    }
  } catch {
    // Unreadable — as if there were none.
  }
  return null;
}

export function saveDraft(taskId: string, draft: AnswerDraft): void {
  if (isEmpty(draft)) {
    clearDraft(taskId);
    return;
  }
  memory.set(taskId, draft);
  try {
    storage()?.setItem(PREFIX + taskId, JSON.stringify(draft));
  } catch {
    // Full or blocked: the in-memory copy still covers this visit.
  }
}

export function clearDraft(taskId: string): void {
  memory.delete(taskId);
  try {
    storage()?.removeItem(PREFIX + taskId);
  } catch {
    // Nothing to do.
  }
}

export function hasDraft(taskId: string): boolean {
  const draft = readDraft(taskId);
  return draft !== null && !isEmpty(draft);
}

registerPrivateCacheReset(() => {
  memory.clear();
  const s = storage();
  if (!s) return;
  try {
    for (let i = s.length - 1; i >= 0; i--) {
      const key = s.key(i);
      if (key?.startsWith(PREFIX)) s.removeItem(key);
    }
  } catch {
    // Nothing to do.
  }
});
