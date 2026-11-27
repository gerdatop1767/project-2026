import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startActivityTracker } from './activityTracker.js';

let visibility: DocumentVisibilityState = 'visible';
Object.defineProperty(document, 'visibilityState', { get: () => visibility, configurable: true });

describe('active time — what the browser counts', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-26T12:00:00Z'));
    visibility = 'visible';
    window.localStorage.clear();
  });
  afterEach(() => vi.useRealTimers());

  it('a visible page with actions marks its 30-second slots; idle and hidden ones count nothing', async () => {
    const sent: number[][] = [];
    const tracker = startActivityTracker({ send: async (s) => void sent.push(s) });
    // One active minute: an action every 20 s.
    for (let i = 0; i < 3; i++) {
      window.dispatchEvent(new Event('pointerdown'));
      await vi.advanceTimersByTimeAsync(20_000);
    }
    // Then nobody touches the page for 5 minutes.
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    // Then the tab is hidden for 5 minutes (actions are not possible there).
    visibility = 'hidden';
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    await tracker.flush();
    tracker.stop();
    const slots = [...new Set(sent.flat())].sort();
    // Actions at 0, 20 and 40 s; the last one keeps the page «active» for a
    // minute (until 100 s): slots 0–30, 30–60, 60–90, 90–120 = 4 slots. The
    // idle and hidden minutes after that add nothing.
    expect(slots).toHaveLength(4);
    expect(slots[0]).toBe(Date.parse('2026-11-26T12:00:00Z') / 1000);
    for (const s of slots) expect(s % 30).toBe(0);
  });

  it('slots wait in the browser while the network is down, then go', async () => {
    let online = false;
    const sent: number[][] = [];
    const tracker = startActivityTracker({
      send: async (s) => {
        if (!online) throw new Error('offline');
        sent.push(s);
      },
    });
    window.dispatchEvent(new Event('keydown'));
    await vi.advanceTimersByTimeAsync(31_000);
    expect(sent).toEqual([]);
    expect(
      JSON.parse(window.localStorage.getItem('zybrilka.activity.pending')!).length,
    ).toBeGreaterThan(0);
    online = true;
    await tracker.flush();
    expect(sent.flat().length).toBeGreaterThan(0);
    expect(window.localStorage.getItem('zybrilka.activity.pending')).toBeNull();
    tracker.stop();
  });

  it('an open page nobody touches counts nothing at all', async () => {
    const sent: number[][] = [];
    vi.setSystemTime(new Date('2026-11-26T12:00:00Z'));
    const tracker = startActivityTracker({ send: async (s) => void sent.push(s) });
    // Opening the page counts as an action: one minute (2 slots), then
    // 10 minutes without a touch add nothing.
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    await tracker.flush();
    tracker.stop();
    expect(new Set(sent.flat()).size).toBe(2);
  });
});
