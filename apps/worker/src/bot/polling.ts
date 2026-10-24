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
}

const defaultSleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    });
  });

/**
 * Long-polls getUpdates until stopped. Each update is handled on its own (a
 * failure is logged without the message text and does not block the rest),
 * then the offset is saved, so a restart neither replays nor loses updates.
 * - 409: another reader or a webhook owns this bot's updates — logged, then
 *   retried rarely; the worker never deletes a webhook on its own.
 * - 401/404: the token is wrong — polling stops.
 */
export function startPolling({
  db,
  telegram,
  logger,
  handle,
  backoffMs = (attempt) => Math.min(60_000, 2_000 * 2 ** attempt),
  sleep = defaultSleep,
}: PollingOptions) {
  const controller = new AbortController();
  const done = (async () => {
    let offset = await loadOffset(db);
    let failures = 0;
    while (!controller.signal.aborted) {
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
        try {
          await handle(update);
        } catch (error) {
          logger.error(
            {
              updateId: update.update_id,
              kind: error instanceof TelegramApiError ? error.kind : 'unknown',
              err: error instanceof TelegramApiError ? undefined : error,
            },
            'telegram update failed',
          );
        }
        offset = update.update_id + 1;
      }
      if (updates.length > 0) await saveOffset(db, offset!);
    }
  })();
  return {
    stop: async () => {
      controller.abort();
      await done;
    },
  };
}
