import { createDb, pingDb } from '@zybrilka/db';
import { createApp } from './createApp.js';
import { loadConfig } from './config.js';
import { logAuthProviders } from './modules/auth/providersStatus.js';
import { syncLearningOnStartup } from './modules/learning/bootstrap.js';
import { warmQuizBanks } from './modules/games/quiz.js';

const config = loadConfig();
const database = config.DATABASE_URL ? createDb(config.DATABASE_URL) : undefined;

const app = createApp(config, database?.db, database ? () => pingDb(database.db) : undefined);

async function shutdown(signal: string) {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  await database?.close();
  process.exit(0);
}
logAuthProviders(app.log, config);

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await app.listen({ host: config.HOST, port: config.PORT });
  // Links newly imported tasks to their skills; never delays serving.
  if (database) void syncLearningOnStartup(database.db, app.log);
  // Builds the mini-game question banks before the first player opens them.
  if (database) {
    const started = Date.now();
    void warmQuizBanks(database.db).then(
      () => app.log.info({ ms: Date.now() - started }, 'mini-games: question banks ready'),
      (error: unknown) => app.log.warn({ error }, 'mini-games: warming question banks failed'),
    );
  }
} catch (error) {
  app.log.fatal(error);
  await database?.close();
  process.exit(1);
}
