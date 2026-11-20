/**
 * A short-lived in-memory cache for heavy admin reports: opening the page
 * or switching back to a period within `ttlMs` serves the same numbers
 * without re-running the aggregates. A request for the same key while one
 * is running shares it. Not used under tests (ttl 0), so every assertion
 * sees fresh numbers.
 */
export class ReportCache {
  private readonly entries = new Map<string, { at: number; value: Promise<unknown> }>();

  constructor(
    private readonly ttlMs = process.env.NODE_ENV === 'test' ? 0 : 60_000,
    private readonly maxEntries = 200,
    private readonly now: () => number = Date.now,
  ) {}

  get<T>(key: string, build: () => Promise<T>): Promise<T> {
    const hit = this.entries.get(key);
    if (hit && this.now() - hit.at < this.ttlMs) return hit.value as Promise<T>;
    const value = build();
    if (this.ttlMs > 0) {
      if (this.entries.size >= this.maxEntries) {
        const oldest = this.entries.keys().next().value;
        if (oldest !== undefined) this.entries.delete(oldest);
      }
      this.entries.set(key, { at: this.now(), value });
      value.catch(() => {
        if (this.entries.get(key)?.value === value) this.entries.delete(key);
      });
    }
    return value;
  }
}
