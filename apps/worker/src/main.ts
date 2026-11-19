import { createDb, parseSecretsKey, pingDb } from '@zybrilka/db';
import { pino } from 'pino';
import { loadConfig } from './config.js';
import { createTelegramClient } from './telegram/client.js';
import { startWorker } from './worker.js';
import { createAnthropicClient, SeoAi } from './seo/ai.js';

const config = loadConfig();
const logger = pino({ level: config.LOG_LEVEL });
const database = config.DATABASE_URL ? createDb(config.DATABASE_URL) : undefined;
const telegram = config.TELEGRAM_BOT_TOKEN
  ? createTelegramClient({
      token: config.TELEGRAM_BOT_TOKEN,
      timeoutMs: config.TELEGRAM_REQUEST_TIMEOUT_MS,
    })
  : undefined;

try {
  const worker = await startWorker({
    logger,
    checkDb: database ? () => pingDb(database.db) : undefined,
    db: database?.db,
    telegram,
    polling: config.TELEGRAM_BOT_POLLING,
    siteUrl: config.WEB_BASE_URL,
    ownerIds: config.ADMIN_OWNER_USER_IDS,
    healthUrl: config.API_HEALTH_URL,
    seo: database
      ? {
          ai: new SeoAi({
            db: database.db,
            client: createAnthropicClient(config.ANTHROPIC_API_KEY),
            logger,
          }),
          origin: config.WEB_BASE_URL,
          fetch: (url, init) => fetch(url, init),
          secretsKey: parseSecretsKey(config.SEO_SECRETS_KEY),
          telegramBotToken: config.TELEGRAM_BOT_TOKEN ?? null,
          now: () => new Date(),
        }
      : undefined,
  });

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'shutting down');
    await worker.stop();
    await database?.close();
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
} catch (error) {
  logger.fatal(error);
  await database?.close();
  process.exit(1);
}
