import type { SiteErrorNotification } from '@zybrilka/shared';

/**
 * Turns server errors (5xx) into owner notifications without flooding the
 * owner: errors are grouped by method + route + status + error type, and a
 * group notifies at most once per `cooldownMs`. Repeats inside the window
 * are counted and reported with the next notification of that group, once
 * the window has passed. In-process (one per API process); bounded.
 */
export class SiteErrorNotifier {
  private groups = new Map<
    string,
    { lastSentAt: number; suppressed: number; firstSuppressedAt: number | null }
  >();

  constructor(
    private readonly send: (notification: SiteErrorNotification, key: string) => void,
    private readonly cooldownMs = 15 * 60 * 1000,
    private readonly now: () => number = Date.now,
    private readonly maxGroups = 200,
  ) {}

  record(error: { method: string; route: string; status: number; error: string }) {
    const key = `${error.method} ${error.route} ${error.status} ${error.error}`;
    const time = this.now();
    const group = this.groups.get(key);
    if (group && time - group.lastSentAt < this.cooldownMs) {
      if (group.suppressed === 0) group.firstSuppressedAt = time;
      group.suppressed++;
      return;
    }
    if (!group && this.groups.size >= this.maxGroups) {
      // Forget the oldest group rather than grow without bound.
      const oldest = this.groups.keys().next().value;
      if (oldest !== undefined) this.groups.delete(oldest);
    }
    const suppressed = group?.suppressed ?? 0;
    const firstAt = group?.firstSuppressedAt ?? time;
    this.groups.delete(key);
    this.groups.set(key, { lastSentAt: time, suppressed: 0, firstSuppressedAt: null });
    this.send(
      {
        ...error,
        suppressed,
        firstAt: new Date(firstAt).toISOString(),
        at: new Date(time).toISOString(),
      },
      key,
    );
  }
}

/** Only the class/code of an error goes into a notification — a message can
 * carry user input or SQL. */
export function errorKind(error: unknown): string {
  if (!error || typeof error !== 'object') return 'unknown';
  const { name, code } = error as { name?: unknown; code?: unknown };
  const parts = [typeof name === 'string' ? name : 'Error'];
  if (typeof code === 'string' && /^[A-Z0-9_]{1,40}$/i.test(code)) parts.push(code);
  return parts.join(':');
}
