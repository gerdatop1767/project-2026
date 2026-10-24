import { createTestDb } from '@zybrilka/db/testing';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { TelegramApiError, type TelegramClient, type TelegramUpdate } from '../telegram/client.js';
import { defaultBackoffMs, loadOffset, startPolling } from './polling.js';

const logger = pino({ enabled: false });
let id = 1;
const msg = (chat: number, text = '/start'): TelegramUpdate => ({
  update_id: id++,
  message: { message_id: 1, chat: { id: chat, type: 'private' }, from: { id: chat }, text },
});

/** getUpdates that hands out the given batches once, then idles. */
function feed(batches: TelegramUpdate[][]) {
  const queue = [...batches];
  return vi.fn(async (_p: unknown, signal?: AbortSignal) => {
    const next = queue.shift();
    if (next) return next;
    await new Promise<void>((r) => {
      const t = setTimeout(r, 20);
      signal?.addEventListener('abort', () => {
        clearTimeout(t);
        r();
      });
    });
    return [];
  });
}

const telegramWith = (getUpdates: ReturnType<typeof feed>) =>
  ({ getUpdates }) as unknown as TelegramClient;

describe('polling: one slow chat never holds up the others', () => {
  let testDb: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    testDb = await createTestDb();
  });
  afterAll(async () => {
    await testDb.close();
  });

  it('regression: a slow reply (e.g. a photo upload) does not delay another user’s /start', async () => {
    const t0 = Date.now();
    const doneAt = new Map<number, number>();
    const slow = msg(101);
    const fast = msg(202);
    const poller = startPolling({
      db: testDb.db,
      telegram: telegramWith(feed([[slow, fast]])),
      logger,
      handle: async (u) => {
        if (u.message!.chat.id === 101) await new Promise((r) => setTimeout(r, 600));
        doneAt.set(u.message!.chat.id, Date.now() - t0);
      },
    });
    await vi.waitFor(() => expect(doneAt.size).toBe(2), { timeout: 3000 });
    await poller.stop();
    expect(doneAt.get(202)!).toBeLessThan(300); // not after the slow one
    expect(doneAt.get(101)!).toBeGreaterThanOrEqual(550);
  });

  it('keeps reading new updates while a slow one is still being answered', async () => {
    const t0 = Date.now();
    const doneAt = new Map<number, number>();
    const poller = startPolling({
      db: testDb.db,
      telegram: telegramWith(feed([[msg(301)], [msg(302)]])),
      logger,
      handle: async (u) => {
        if (u.message!.chat.id === 301) await new Promise((r) => setTimeout(r, 600));
        doneAt.set(u.message!.chat.id, Date.now() - t0);
      },
    });
    await vi.waitFor(() => expect(doneAt.size).toBe(2), { timeout: 3000 });
    await poller.stop();
    expect(doneAt.get(302)!).toBeLessThan(300);
  });

  it('one chat’s messages are still answered in order, one at a time', async () => {
    const order: string[] = [];
    let running = 0;
    let maxRunning = 0;
    const poller = startPolling({
      db: testDb.db,
      telegram: telegramWith(feed([[msg(401, 'a'), msg(401, 'b'), msg(401, 'c')]])),
      logger,
      handle: async (u) => {
        running++;
        maxRunning = Math.max(maxRunning, running);
        await new Promise((r) => setTimeout(r, 30));
        order.push(u.message!.text!);
        running--;
      },
    });
    await vi.waitFor(() => expect(order).toHaveLength(3), { timeout: 3000 });
    await poller.stop();
    expect(order).toEqual(['a', 'b', 'c']);
    expect(maxRunning).toBe(1);
  });

  it('a handler that throws is logged and the worker keeps going', async () => {
    const handled: number[] = [];
    const poller = startPolling({
      db: testDb.db,
      telegram: telegramWith(feed([[msg(501), msg(502)], [msg(503)]])),
      logger,
      handle: async (u) => {
        if (u.message!.chat.id === 501) throw new Error('db down');
        handled.push(u.message!.chat.id);
      },
    });
    await vi.waitFor(() => expect(handled.sort()).toEqual([502, 503]), { timeout: 3000 });
    await poller.stop();
  });

  it('a handler that never settles does not block that chat forever', async () => {
    const handled: string[] = [];
    const poller = startPolling({
      db: testDb.db,
      telegram: telegramWith(feed([[msg(601, 'hang')], [msg(601, 'next')]])),
      logger,
      handlerTimeoutMs: 100,
      handle: async (u) => {
        if (u.message!.text === 'hang') await new Promise(() => {});
        handled.push(u.message!.text!);
      },
    });
    await vi.waitFor(() => expect(handled).toEqual(['next']), { timeout: 3000 });
    await poller.stop();
  });

  it('confirms the offset right away, so a restart does not answer twice', async () => {
    const u = msg(701);
    const poller = startPolling({
      db: testDb.db,
      telegram: telegramWith(feed([[u]])),
      logger,
      handle: async () => {
        await new Promise((r) => setTimeout(r, 300));
      },
    });
    await vi.waitFor(async () => expect(await loadOffset(testDb.db)).toBe(u.update_id + 1), {
      timeout: 1000,
    });
    await poller.stop(); // waits for the handler in flight
  });

  it('after network errors it retries within seconds, not minutes', () => {
    for (let attempt = 0; attempt < 20; attempt++) {
      expect(defaultBackoffMs(attempt)).toBeLessThanOrEqual(10_000);
    }
    expect(defaultBackoffMs(0)).toBeLessThanOrEqual(1_000);
  });

  it('a getUpdates network failure is retried and later updates still arrive', async () => {
    let call = 0;
    const getUpdates = vi.fn(async () => {
      call++;
      if (call <= 2) throw new TelegramApiError('getUpdates', 'network', null, 'timeout');
      if (call === 3) return [msg(801)];
      await new Promise((r) => setTimeout(r, 20));
      return [];
    });
    const handled: number[] = [];
    const poller = startPolling({
      db: testDb.db,
      telegram: { getUpdates } as unknown as TelegramClient,
      logger,
      backoffMs: () => 5,
      handle: async (u) => void handled.push(u.message!.chat.id),
    });
    await vi.waitFor(() => expect(handled).toEqual([801]), { timeout: 2000 });
    await poller.stop();
  });
});
