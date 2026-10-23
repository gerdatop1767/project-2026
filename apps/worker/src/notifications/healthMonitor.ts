import { siteDownText, siteRecoveredText } from './format.js';

export interface ProbeResult {
  ok: boolean;
  /** Human-readable cause when not ok («API не отвечает», «база данных недоступна»). */
  reason?: string;
}

export interface HealthMonitorOptions {
  probe: () => Promise<ProbeResult>;
  notify: (text: string) => Promise<void>;
  /** Consecutive failed probes before the site counts as down (no alert on one blip). */
  failuresToAlert?: number;
  /** While still down, remind no more often than this. */
  reminderMs?: number;
  now?: () => number;
}

/**
 * Notices the site being down from real signals only: the API's own
 * /health (which checks the database) failing several times in a row. One
 * alert per outage, a reminder at most every `reminderMs` while it lasts,
 * and one «снова работает» when a probe succeeds again.
 */
export class HealthMonitor {
  private failures = 0;
  private firstFailureAt: number | null = null;
  private down: { since: number; lastAlertAt: number } | null = null;
  private readonly failuresToAlert: number;
  private readonly reminderMs: number;
  private readonly now: () => number;

  constructor(private readonly o: HealthMonitorOptions) {
    this.failuresToAlert = o.failuresToAlert ?? 2;
    this.reminderMs = o.reminderMs ?? 60 * 60 * 1000;
    this.now = o.now ?? Date.now;
  }

  get isDown() {
    return this.down !== null;
  }

  async check(): Promise<void> {
    let result: ProbeResult;
    try {
      result = await this.o.probe();
    } catch {
      result = { ok: false, reason: 'проверка не выполнилась' };
    }
    const time = this.now();
    if (result.ok) {
      if (this.down) {
        const { since } = this.down;
        this.down = null;
        await this.o.notify(
          siteRecoveredText(new Date(since).toISOString(), new Date(time).toISOString()),
        );
      }
      this.failures = 0;
      this.firstFailureAt = null;
      return;
    }
    this.failures++;
    this.firstFailureAt ??= time;
    const reason = result.reason ?? 'неизвестно';
    if (!this.down) {
      if (this.failures >= this.failuresToAlert) {
        this.down = { since: this.firstFailureAt, lastAlertAt: time };
        await this.o.notify(
          siteDownText(reason, new Date(this.firstFailureAt).toISOString(), false),
        );
      }
      return;
    }
    if (time - this.down.lastAlertAt >= this.reminderMs) {
      this.down.lastAlertAt = time;
      await this.o.notify(siteDownText(reason, new Date(this.down.since).toISOString(), true));
    }
  }
}

/** Probes the API's /health: 200 + `status: ok` is healthy; a 503 with
 * `db: down` means the database is unreachable; no answer means the API is. */
export function httpHealthProbe(url: string, timeoutMs = 5000): () => Promise<ProbeResult> {
  return async () => {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      const body = (await response.json().catch(() => null)) as {
        status?: string;
        db?: string;
      } | null;
      if (response.ok && body?.status === 'ok') return { ok: true };
      if (body?.db === 'down') return { ok: false, reason: 'база данных недоступна' };
      return { ok: false, reason: `API ответил ${response.status}` };
    } catch {
      return { ok: false, reason: 'API не отвечает' };
    }
  };
}
