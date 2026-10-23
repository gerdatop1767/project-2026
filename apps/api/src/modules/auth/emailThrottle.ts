/**
 * Per-address limit on outgoing auth letters (registration, resend,
 * password reset): at most one per `minIntervalMs` and `maxPerHour` an hour
 * for the same address, on top of the per-IP route limits. Applied before
 * the server looks the address up, identically whether or not an account
 * exists, so a 429 never tells anyone which addresses are registered.
 *
 * In memory: the API runs as one process (infra/docker-compose.yml). A
 * restart resets it; the per-IP limits still apply.
 */
export class EmailThrottle {
  private readonly sent = new Map<string, number[]>();

  constructor(
    private readonly minIntervalMs = 60_000,
    private readonly maxPerHour = 5,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** Reserves a send for `key`, or says how long to wait. */
  take(key: string): { ok: true } | { ok: false; retryAfterSeconds: number } {
    const now = this.now();
    this.prune(now);
    const times = this.sent.get(key) ?? [];
    const last = times[times.length - 1];
    if (last !== undefined && now - last < this.minIntervalMs) {
      return {
        ok: false,
        retryAfterSeconds: Math.ceil((this.minIntervalMs - (now - last)) / 1000),
      };
    }
    if (times.length >= this.maxPerHour) {
      return { ok: false, retryAfterSeconds: Math.ceil((times[0]! + 3_600_000 - now) / 1000) };
    }
    times.push(now);
    this.sent.set(key, times);
    return { ok: true };
  }

  /** Gives a reservation back when the letter could not be sent. */
  release(key: string): void {
    const times = this.sent.get(key);
    times?.pop();
    if (times && times.length === 0) this.sent.delete(key);
  }

  private prune(now: number): void {
    for (const [key, times] of this.sent) {
      const fresh = times.filter((t) => now - t < 3_600_000);
      if (fresh.length === 0) this.sent.delete(key);
      else if (fresh.length !== times.length) this.sent.set(key, fresh);
    }
  }
}
