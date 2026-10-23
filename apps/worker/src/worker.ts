import type { Database } from '@zybrilka/db';
import type { Logger } from 'pino';
import { handleUpdate } from './bot/handleUpdate.js';
import { BotPhotos } from './bot/photos.js';
import { startPolling } from './bot/polling.js';
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
