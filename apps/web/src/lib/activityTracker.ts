import {
  ACTIVITY_IDLE_MS,
  ACTIVITY_MAX_AGE_HOURS,
  ACTIVITY_MAX_SLOTS_PER_REQUEST,
  ACTIVITY_SLOT_SECONDS,
  activitySlotOf,
} from '@zybrilka/shared';
import { registerPrivateCacheReset } from './privateCaches.js';

/**
 * Active time (docs/ACTIVE_TIME.md), the client side. A 30-second slot is
 * marked when the page is visible AND the user did something in the last
 * minute — an open tab nobody touches counts nothing. Marked slots are
 * kept in this browser until the server took them (so a closed Mini App,
 * a reload or a lost connection loses nothing) and sent in batches; the
 * server keeps them unique per user, so tabs and devices never add up.
 * Only for a signed-in user.
 */
const STORE = 'zybrilka.activity.pending';
const TICK_MS = 5_000;
const SEND_MS = 30_000;
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'] as const;

function readPending(): Set<number> {
  try {
    const raw = window.localStorage.getItem(STORE);
    return new Set(raw ? (JSON.parse(raw) as number[]) : []);
  } catch {
    return new Set();
  }
}

function writePending(slots: ReadonlySet<number>) {
  try {
    if (slots.size === 0) window.localStorage.removeItem(STORE);
    else window.localStorage.setItem(STORE, JSON.stringify([...slots]));
  } catch {
    // Kept in memory only.
  }
}

export interface ActivityTrackerOptions {
  /** Sends slots; resolves when the server took them. */
  send: (slots: number[]) => Promise<void>;
  now?: () => number;
}

export interface ActivityTracker {
  /** Sends what is pending now (page hidden, closing). */
  flush: () => Promise<void>;
  stop: () => void;
}

export function startActivityTracker({
  send,
  now = () => Date.now(),
}: ActivityTrackerOptions): ActivityTracker {
  const pending = readPending();
  let lastAction = now();
  let sending = false;

  const visible = () => document.visibilityState === 'visible';
  const onAction = () => {
    lastAction = now();
  };

  /** The current slot counts if the page is seen and someone is there. */
  const tick = () => {
    const t = now();
    if (visible() && t - lastAction < ACTIVITY_IDLE_MS) {
      const slot = activitySlotOf(t);
      if (!pending.has(slot)) {
        pending.add(slot);
        writePending(pending);
      }
    }
  };

  const flush = async () => {
    if (sending || pending.size === 0) return;
    // Slots the server would refuse as too old are dropped here.
    const oldest = activitySlotOf(now()) - ACTIVITY_MAX_AGE_HOURS * 3600 + ACTIVITY_SLOT_SECONDS;
    for (const s of pending) if (s < oldest) pending.delete(s);
    const batch = [...pending].sort((a, b) => a - b).slice(-ACTIVITY_MAX_SLOTS_PER_REQUEST);
    if (batch.length === 0) {
      writePending(pending);
      return;
    }
    sending = true;
    try {
      await send(batch);
      for (const s of batch) pending.delete(s);
      writePending(pending);
    } catch {
      // Offline or the server busy: kept, sent next time.
    } finally {
      sending = false;
    }
  };

  const onVisibility = () => {
    if (visible()) onAction();
    else {
      tick();
      void flush();
    }
  };

  for (const e of ACTIVITY_EVENTS) window.addEventListener(e, onAction, { passive: true });
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', onVisibility);
  window.addEventListener('online', () => void flush());
  const ticker = window.setInterval(tick, TICK_MS);
  const sender = window.setInterval(() => void flush(), SEND_MS);
  tick();

  return {
    flush,
    stop() {
      for (const e of ACTIVITY_EVENTS) window.removeEventListener(e, onAction);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onVisibility);
      window.clearInterval(ticker);
      window.clearInterval(sender);
    },
  };
}

// Signed out: what was pending belongs to the previous account.
registerPrivateCacheReset(() => writePending(new Set()));
