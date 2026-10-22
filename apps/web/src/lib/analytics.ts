import type { Route } from './navigation.js';
import { getTelegramStartParam, isInTelegramWebView } from './telegramMiniApp.js';

/**
 * Product events for the owner's admin analytics (docs/ADMIN.md §События).
 * Fire-and-forget, batched, never blocks or breaks the UI. Sends only the
 * event type and ids (subject, task) — never an answer, a name or anything
 * typed by the user. The server identifies the browser by its own
 * httpOnly first-party cookie; nothing is stored here.
 *
 * Off in unit tests (fetch mocks there count requests) unless a test turns
 * it on explicitly.
 */
export type ClientEventType = 'visit' | 'subject_selected' | 'task_started' | 'training_completed';

interface QueuedEvent {
  id: string;
  type: ClientEventType;
  subjectId?: string;
  taskId?: string;
}

let enabled = import.meta.env.MODE !== 'test';
const queue: QueuedEvent[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let campaignSent = false;
let lastSubject: string | null = null;
let lastTask: string | null = null;
const FLUSH_DELAY_MS = 1500;
const SUBJECT_RE = /^[a-z_]{1,32}$/;

export function setAnalyticsEnabled(value: boolean) {
  enabled = value;
  queue.length = 0;
  campaignSent = false;
  lastSubject = null;
  lastTask = null;
  started = false;
}

function newId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function track(type: ClientEventType, extra: { subjectId?: string; taskId?: string } = {}) {
  if (!enabled) return;
  const event: QueuedEvent = { id: newId(), type };
  if (extra.subjectId && SUBJECT_RE.test(extra.subjectId)) event.subjectId = extra.subjectId;
  if (extra.taskId) event.taskId = extra.taskId;
  queue.push(event);
  if (queue.length >= 20) {
    flushAnalytics();
    return;
  }
  timer ??= setTimeout(flushAnalytics, FLUSH_DELAY_MS);
}

export function flushAnalytics() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (!enabled || queue.length === 0) return;
  const events = queue.splice(0, 20);
  const telegram = isInTelegramWebView();
  const startParam = telegram && !campaignSent ? getTelegramStartParam() : null;
  campaignSent = true;
  const body: Record<string, unknown> = { client: telegram ? 'telegram' : 'web', events };
  if (startParam && /^[A-Za-z0-9_-]{6,32}$/.test(startParam)) body.campaign = startParam;
  try {
    void fetch(new URL('/api/v1/events', window.location.origin), {
      method: 'POST',
      keepalive: true,
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => undefined);
  } catch {
    // Analytics must never surface an error.
  }
  if (queue.length > 0) timer = setTimeout(flushAnalytics, FLUSH_DELAY_MS);
}

/** One `visit` per app load, flushed when the page is hidden. */
let started = false;
export function startAnalytics() {
  if (!enabled || started) return;
  started = true;
  track('visit');
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushAnalytics();
  });
}

export function trackSubject(subjectId: string) {
  if (subjectId === lastSubject) return;
  lastSubject = subjectId;
  track('subject_selected', { subjectId });
}

/** Called for every navigation: a subject or task the user moved to. */
export function trackRoute(route: Route) {
  if ('subjectId' in route && typeof route.subjectId === 'string') trackSubject(route.subjectId);
  if (route.screen === 'task' && route.taskId !== lastTask) {
    lastTask = route.taskId;
    track('task_started', { subjectId: route.subjectId, taskId: route.taskId });
  }
}
