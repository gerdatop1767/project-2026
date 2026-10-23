import type { Database } from '@zybrilka/db';
import type { Logger } from 'pino';
import { handleUpdate } from './bot/handleUpdate.js';
import { BotPhotos } from './bot/photos.js';
import { startPolling } from './bot/polling.js';
import { AdminNotifier } from './notifications/adminNotifier.js';
import { HealthMonitor, httpHealthProbe } from './notifications/healthMonitor.js';
import type { TelegramClient } from './telegram/client.js';

export interface WorkerOptions {
  logger: Logger;
  /** Resolves when the database is reachable. Omitted when no database is configured. */
  checkDb?: () => Promise<void>;
  db?: Database;
  /** Present when TELEGRAM_BOT_TOKEN is set. */
  telegram?: TelegramClient;
  /** Read the bot's updates (TELEGRAM_BOT_POLLING) — see config.ts. */
  polling?: boolean;
  siteUrl?: string;
  /** ADMIN_OWNER_USER_IDS — who gets owner notifications. */
  ownerIds?: readonly string[];
  /** API /health URL probed for outages. */
  healthUrl?: string;
}

/** Runs `job` every `ms`, never two at once; errors are logged, not fatal. */
function every(ms: number, job: () => Promise<unknown>, logger: Logger, name: string) {
  let running = false;
  let current: Promise<unknown> = Promise.resolve();
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    current = job()
      .catch((err: unknown) => logger.error({ err }, `${name} failed`))
      .finally(() => {
        running = false;
      });
  }, ms);
  return async () => {
    clearInterval(timer);
    await current;
  };
}

export interface Worker {
  stop: () => Promise<void>;
}

/** Background jobs: the Telegram bot (when configured) and, later, more. */
export async function startWorker({
  logger,
  checkDb,
  db,
  telegram,
  polling = false,
  siteUrl = 'http://localhost:5173',
  ownerIds = [],
  healthUrl,
}: WorkerOptions): Promise<Worker> {
  if (checkDb) {
    await checkDb();
    logger.info('database reachable');
  } else {
    logger.warn('DATABASE_URL not set; running without a database');
  }

  const stops: (() => Promise<void>)[] = [];

  if (telegram && db && polling) {
    const photos = new BotPhotos(db);
    const bot = startPolling({
      db,
      telegram,
      logger,
      handle: (update) => handleUpdate({ db, telegram, photos, siteUrl, logger }, update),
    });
    stops.push(bot.stop);
    logger.info('telegram bot: reading updates');
  } else {
    logger.info(
      { token: Boolean(telegram), database: Boolean(db), polling },
      'telegram bot: not reading updates',
    );
  }

  if (telegram && db) {
    const notifier = new AdminNotifier({ db, telegram, ownerIds, siteUrl, logger });
    stops.push(every(5_000, () => notifier.processOutbox(), logger, 'admin notifications'));
    if (healthUrl) {
      const monitor = new HealthMonitor({
        probe: httpHealthProbe(healthUrl),
        notify: (text) => notifier.sendDirect(text, 'siteErrors'),
      });
      stops.push(every(60_000, () => monitor.check(), logger, 'health check'));
    }
    logger.info(
      { owners: ownerIds.length, healthCheck: Boolean(healthUrl) },
      'admin notifications on',
    );
  }

  // Keeps the process alive even with nothing scheduled.
  const heartbeat = setInterval(() => logger.debug('worker heartbeat'), 60_000);
  logger.info('worker started');

  return {
    stop: async () => {
      clearInterval(heartbeat);
      await Promise.all(stops.map((stop) => stop()));
      logger.info('worker stopped');
    },
  };
}
