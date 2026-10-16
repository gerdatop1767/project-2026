import { createDb, pingDb } from '@zybrilka/db';
import { createApp } from './createApp.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const database = config.DATABASE_URL ? createDb(config.DATABASE_URL) : undefined;

const app = createApp(config, database?.db, database ? () => pingDb(database.db) : undefined);

async function shutdown(signal: string) {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  await database?.close();
  process.exit(0);
}
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await app.listen({ host: config.HOST, port: config.PORT });
} catch (error) {
  app.log.fatal(error);
  await database?.close();
  process.exit(1);
}
