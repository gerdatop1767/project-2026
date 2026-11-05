/**
 * Yandex.Metrika (counter 114059780). The counter code itself lives in
 * index.html, exactly as Yandex issues it, wrapped so it starts only after
 * the visitor accepted optional analytics (lib/consent.ts, docs/COOKIES.md):
 * index.html starts it on load when the choice is already «a1», and
 * `startMetrika()` starts it the moment the visitor accepts. A guard there
 * makes a second start a no-op, so the tag is loaded and initialised once.
 *
 * The app is a single-page app: `init` counts the first page, every later
 * client-side navigation is sent here as a `hit` with the previous URL as
 * referrer. Goals are reached only while the counter runs; nothing is
 * queued for later.
 */
export const METRIKA_ID = 114059780;

export type MetrikaGoal = 'registration' | 'diagnostic_start' | 'task_solved' | 'return_visit';

type Ym = (id: number, method: string, ...args: unknown[]) => void;

interface MetrikaWindow {
  ym?: Ym;
  __zybrilkaMetrika?: () => void;
  __zybrilkaMetrikaStarted?: boolean;
}

function w(): MetrikaWindow | null {
  return typeof window === 'undefined' ? null : (window as unknown as MetrikaWindow);
}

/** True once the counter was started on this page (consent given). */
export function metrikaRunning(): boolean {
  const win = w();
  return !!win?.__zybrilkaMetrikaStarted && typeof win.ym === 'function';
}

/** Consent just given: start the counter from index.html (idempotent). */
export function startMetrika(): void {
  w()?.__zybrilkaMetrika?.();
}

let lastUrl: string | null = typeof window === 'undefined' ? null : window.location.href;

/** A client-side navigation landed on a new URL: one hit, never two for the same URL. */
export function metrikaHit(): void {
  const win = w();
  if (!win) return;
  const url = window.location.href;
  if (url === lastUrl) return;
  const referer = lastUrl;
  lastUrl = url;
  if (!metrikaRunning()) return;
  try {
    win.ym!(METRIKA_ID, 'hit', url, { referer: referer ?? undefined, title: document.title });
  } catch {
    // Analytics must never break the app.
  }
}

/** Tests: forget the last URL so the next navigation counts. */
export function resetMetrikaUrl(url: string | null = null): void {
  lastUrl = url;
}

const reachedOnce = new Set<MetrikaGoal>();

export function metrikaGoal(goal: MetrikaGoal, options: { oncePerPage?: boolean } = {}): void {
  if (!metrikaRunning()) return;
  if (options.oncePerPage) {
    if (reachedOnce.has(goal)) return;
    reachedOnce.add(goal);
  }
  try {
    w()!.ym!(METRIKA_ID, 'reachGoal', goal);
  } catch {
    // never surfaces
  }
}

const LAST_VISIT_KEY = 'zybrilka-last-visit-day';

/** «Возвращение»: the app opened on a later calendar day than the previous visit. */
export function noteVisitDay(today: string = new Date().toISOString().slice(0, 10)): boolean {
  let previous: string | null;
  try {
    previous = window.localStorage.getItem(LAST_VISIT_KEY);
    window.localStorage.setItem(LAST_VISIT_KEY, today);
  } catch {
    return false;
  }
  const returned = previous !== null && previous < today;
  if (returned) metrikaGoal('return_visit', { oncePerPage: true });
  return returned;
}
