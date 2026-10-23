import { schema } from '@zybrilka/db';
import type { Database } from '@zybrilka/db';
import type { OutboxPayload } from '@zybrilka/shared';
import type { FastifyBaseLogger } from 'fastify';

/**
 * Queues an owner notification for the worker to send (docs/TELEGRAM_BOT.md).
 * One INSERT, run after the business write it reports on — never inside its
 * transaction — and it never throws: a full queue table or an unreachable
 * database must not fail a sign-up or a complaint. A repeated `dedupKey` is
 * silently ignored, so an event notifies at most once.
 */
export async function enqueueNotification(
  db: Database,
  log: Pick<FastifyBaseLogger, 'error'>,
  payload: OutboxPayload,
  dedupKey: string | null = null,
): Promise<void> {
  try {
    await db
      .insert(schema.telegramOutbox)
      .values({
        kind: payload.kind,
        payload: payload.data as unknown as Record<string, unknown>,
        dedupKey,
      })
      .onConflictDoNothing();
  } catch (err) {
    log.error({ err, kind: payload.kind }, 'notification enqueue failed');
  }
}
