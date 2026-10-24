import { describe, expect, it, vi } from 'vitest';
import { registerPrivateCacheReset, resetPrivateCaches } from './privateCaches.js';

describe('privateCaches registry', () => {
  it('runs every registered reset, and an unsubscribed one no longer runs', () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = registerPrivateCacheReset(a);
    const offB = registerPrivateCacheReset(b);
    resetPrivateCaches();
    expect([a.mock.calls.length, b.mock.calls.length]).toEqual([1, 1]);
    offA();
    resetPrivateCaches();
    expect([a.mock.calls.length, b.mock.calls.length]).toEqual([1, 2]);
    offB();
  });

  it('a reset that unregisters others while running does not skip or break the pass', () => {
    const second = vi.fn();
    const offSecond = registerPrivateCacheReset(second);
    const offFirst = registerPrivateCacheReset(() => offSecond());
    expect(() => resetPrivateCaches()).not.toThrow();
    offFirst();
  });
});
