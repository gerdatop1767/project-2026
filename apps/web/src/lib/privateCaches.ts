/**
 * One place that knows how to forget everything the app has cached about
 * the CURRENT account. Anything that keeps per-user data outside React's
 * own render cycle — module-level caches, in-memory stores, provider
 * state mounted above the auth gate — registers a reset here, and
 * `AuthProvider` calls `resetPrivateCaches()` when the signed-in
 * identity goes away or changes (sign-out, expired/revoked session
 * detected via a 401, or a different account appearing).
 *
 * It is deliberately NOT called on a plain page refresh or a same-user
 * `/auth/me` re-check, so e.g. a half-drawn canvas survives those.
 */
type Reset = () => void;

const resets = new Set<Reset>();

/** Registers a reset; returns an unsubscribe function (for providers
 * that register from an effect). Module-level stores just call it once
 * at import time. */
export function registerPrivateCacheReset(reset: Reset): () => void {
  resets.add(reset);
  return () => {
    resets.delete(reset);
  };
}

export function resetPrivateCaches(): void {
  // Snapshot first: a reset may (un)register others while running.
  for (const reset of [...resets]) reset();
}
