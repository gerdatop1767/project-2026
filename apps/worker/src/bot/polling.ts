import { schema } from '@zybrilka/db';
import type { Database } from '@zybrilka/db';
import { eq } from 'drizzle-orm';
import type { Logger } from 'pino';
import { TelegramApiError, type TelegramClient, type TelegramUpdate } from '../telegram/client.js';

const OFFSET_KEY = 'telegram.update_offset';
const LONG_POLL_SECONDS = 25;

export async function loadOffset(db: Database): Promise<number | undefined> {
  const [row] = await db
    .select({ value: schema.appSettings.value })
    .from(schema.appSettings)
    .where(eq(schema.appSettings.key, OFFSET_KEY));
  const value = (row?.value as { offset?: unknown } | undefined)?.offset;
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : undefined;
}

export async function saveOffset(db: Database, offset: number) {
  await db
    .insert(schema.appSettings)
    .values({ key: OFFSET_KEY, value: { offset }, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: schema.appSettings.key,
      set: { value: { offset }, updatedAt: new Date() },
    });
}

export interface PollingOptions {
  db: Database;
  telegram: TelegramClient;
  logger: Logger;
  handle: (update: TelegramUpdate) => Promise<void>;
  /** For tests: how long to back off after an error (ms). */
  backoffMs?: (attempt: number) => number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  /** A handler still running after this is given up on (logged) so its
   * chat's next message is not held behind it forever. */
  handlerTimeoutMs?: number;
  /** Most updates handled at the same time (across chats). */
  maxInFlight?: number;
}

const defaultSleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    });
  });

/** 1 s, 2 s, 4 s, 8 s, then 10 s: a dropped connection is back within
 * seconds — the bot must not stay deaf for a minute after Telegram is
 * reachable again. */
export function defaultBackoffMs(attempt: number): number {
  return Math.min(10_000, 1_000 * 2 ** attempt);
}

const HANDLER_TIMEOUT_MS = 60_000;
const MAX_IN_FLIGHT = 32;

/** The chat an update belongs to: its messages are answered in order. */
function chatOf(update: TelegramUpdate): string {
  const chat =
    update.message?.chat.id ??
    update.callback_query?.message?.chat.id ??
    update.callback_query?.from.id;
  return chat === undefined ? `update:${update.update_id}` : String(chat);
}

/**
 * Long-polls getUpdates until stopped.
 * - Updates are handed to `handle` without waiting for the reply to go
 *   out: one slow reply (a photo upload, a Telegram timeout) never holds
 *   up another user, and polling keeps reading. Messages of one chat are
 *   still answered one at a time, in order. At most `maxInFlight` run at
 *   once — beyond that, polling waits for a slot.
 * - The offset is confirmed as soon as an update is taken (saved after
 *   each batch): a restart never answers the same update twice — at
 *   worst a reply cut off by the restart is lost.
 * - A handler failure is logged without the message text; a handler
 *   still running after `handlerTimeoutMs` is logged and its chat moves on.
 * - 409: another reader or a webhook owns this bot's updates — logged, then
 *   retried rarely; the worker never deletes a webhook on its own.
 * - 401/404: the token is wrong — polling stops.
 */
export function startPolling({
  db,
  telegram,
  logger,
  handle,
  backoffMs = defaultBackoffMs,
  sleep = defaultSleep,
  handlerTimeoutMs = HANDLER_TIMEOUT_MS,
  maxInFlight = MAX_IN_FLIGHT,
}: PollingOptions) {
  const controller = new AbortController();
  /** The last task queued per chat (the next one starts after it). */
  const chains = new Map<string, Promise<void>>();
  const inFlight = new Set<Promise<void>>();

  async function run(update: TelegramUpdate) {
    const started = performance.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), handlerTimeoutMs);
    });
    try {
      const outcome = await Promise.race([handle(update).then(() => 'done' as const), timedOut]);
      if (outcome === 'timeout') {
        logger.error(
          { updateId: update.update_id, timeoutMs: handlerTimeoutMs },
          'telegram update still running — moving on',
        );
      }
    } catch (error) {
      logger.error(
        {
          updateId: update.update_id,
          kind: error instanceof TelegramApiError ? error.kind : 'unknown',
          code: error instanceof TelegramApiError ? (error.network?.code ?? null) : null,
          err: error instanceof TelegramApiError ? undefined : error,
          ms: Math.round(performance.now() - started),
        },
        'telegram update failed',
      );
    } finally {
      clearTimeout(timer);
    }
  }

  function dispatch(update: TelegramUpdate) {
    const chat = chatOf(update);
    const previous = chains.get(chat) ?? Promise.resolve();
    const task = previous.then(() => run(update));
    chains.set(chat, task);
    inFlight.add(task);
    void task.finally(() => {
      inFlight.delete(task);
      if (chains.get(chat) === task) chains.delete(chat);
    });
  }

  const done = (async () => {
    let offset = await loadOffset(db);
    let failures = 0;
    while (!controller.signal.aborted) {
      // Backpressure: never more than `maxInFlight` replies in progress.
      while (inFlight.size >= maxInFlight && !controller.signal.aborted) {
        await Promise.race(inFlight);
      }
      let updates: TelegramUpdate[];
      try {
        updates = await telegram.getUpdates(
          {
            offset,
            timeout: LONG_POLL_SECONDS,
            allowed_updates: ['message', 'callback_query'],
          },
          controller.signal,
        );
        failures = 0;
      } catch (error) {
        if (controller.signal.aborted) break;
        if (error instanceof TelegramApiError && error.kind === 'unauthorized') {
          logger.error('telegram polling stopped: the bot token was rejected');
          break;
        }
        const wait =
          error instanceof TelegramApiError && error.kind === 'rate_limited' && error.retryAfter
            ? error.retryAfter * 1000
            : error instanceof TelegramApiError && error.kind === 'conflict'
              ? 60_000
              : backoffMs(failures++);
        logger.warn(
          {
            kind: error instanceof TelegramApiError ? error.kind : 'unknown',
            status: error instanceof TelegramApiError ? error.status : null,
            // The underlying network error code (e.g. ECONNRESET), never its text.
            code: error instanceof TelegramApiError ? (error.network?.code ?? null) : null,
            timeout: error instanceof TelegramApiError ? (error.network?.timeout ?? false) : false,
            waitMs: wait,
          },
          'telegram getUpdates failed',
        );
        await sleep(wait, controller.signal);
        continue;
      }
      for (const update of updates) {
        dispatch(update);
        offset = update.update_id + 1;
      }
      if (updates.length > 0) {
        logger.debug(
          { count: updates.length, inFlight: inFlight.size },
          'telegram updates received',
        );
        await saveOffset(db, offset!).catch((error: unknown) =>
          logger.error({ err: error }, 'telegram offset not saved'),
        );
      }
    }
    // Let the replies already started finish (each is bounded by its timeout).
    await Promise.allSettled([...inFlight]);
  })();
  return {
    stop: async () => {
      controller.abort();
      await done;
    },
  };
}
