import type { Database } from '@zybrilka/db';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyServerOptions } from 'fastify';
import type { Config } from './config.js';
import { healthRoutes } from './routes/health.js';
import { registerAnonUser } from './plugins/anonUser.js';
import { registerAuthSession } from './plugins/authSession.js';
import { authRoutes } from './modules/auth/routes.js';
import { collectionsRoutes } from './modules/collections/routes.js';
import { favoritesRoutes } from './modules/favorites/routes.js';
import { learningRoutes } from './modules/learning/routes.js';
import { learningProfileRoutes } from './modules/learningProfile/routes.js';
import { taskStatisticsRoutes } from './modules/learning/taskStatistics/routes.js';
import { errorSignaturesRoutes } from './modules/learning/errorSignatures/routes.js';
import { taskSimilarityRoutes } from './modules/learning/taskSimilarity/routes.js';
import { recommendationRoutes } from './modules/learning/recommendation/routes.js';
import { learningPathRoutes } from './modules/learning/learningPath/routes.js';
import { learningSessionRoutes } from './modules/learning/learningSession/routes.js';
import { mistakesRoutes } from './modules/mistakes/routes.js';
import { progressRoutes } from './modules/progress/routes.js';
import { tasksRoutes } from './modules/tasks/routes.js';
import { variantsRoutes } from './modules/variants/routes.js';

export interface AppOptions {
  logger?: FastifyServerOptions['logger'];
  version: string;
  /** Resolves when the database is reachable. Omitted when no database is configured. */
  checkDb?: () => Promise<void>;
  /** Task-engine routes (tasks/mistakes/progress) only register when a database is given. */
  db?: Database;
  /** Auth routes (magic-link/VK login, session cookie) only register
   * when both `db` and this are given — every existing test that
   * builds the app with just `{ version, db }` keeps working unchanged
   * (no auth routes, no cookie plugin, `request.userId` behaves
   * exactly as before). */
  authConfig?: Config;
}

export function buildApp({ logger = false, version, checkDb, db, authConfig }: AppOptions) {
  const app = Fastify({ logger });
  app.register(healthRoutes, { version, checkDb });

  if (db) {
    void registerAnonUser(app, db);
    if (authConfig) {
      // `registerAuthSession`'s hook reads `request.cookies`, which
      // `@fastify/cookie` only populates once ITS own `onRequest` hook
      // has run. Both must be nested in `.register()` calls (not called
      // bare) so avvio's same-level sequential loading guarantees cookie
      // parsing is fully wired up before authSession's hook is added.
      app.register(cookie);
      app.register(async (instance) => {
        // `global: false` — this plugin only throttles the specific
        // auth routes that opt in via their own `config.rateLimit`
        // (see modules/auth/routes.ts), never any other route in the
        // app, and it's registered before `authRoutes` for the same
        // avvio sequential-loading reason as `cookie`/`authSession`
        // above: its `onRoute` hook must already be active before the
        // throttled routes are added.
        await instance.register(rateLimit, { global: false });
        await registerAuthSession(instance, db);
        instance.register(authRoutes, { db, config: authConfig, prefix: '/api/v1' });
      });
    }
    app.register(tasksRoutes, { db, prefix: '/api/v1' });
    app.register(variantsRoutes, { db, prefix: '/api/v1' });
    app.register(collectionsRoutes, { db, prefix: '/api/v1' });
    app.register(mistakesRoutes, { db, prefix: '/api/v1' });
    app.register(progressRoutes, { db, prefix: '/api/v1' });
    app.register(favoritesRoutes, { db, prefix: '/api/v1' });
    app.register(learningProfileRoutes, { db, prefix: '/api/v1' });
    app.register(learningRoutes, { db, prefix: '/api/v1' });
    app.register(taskStatisticsRoutes, { db, prefix: '/api/v1' });
    app.register(errorSignaturesRoutes, { db, prefix: '/api/v1' });
    app.register(taskSimilarityRoutes, { db, prefix: '/api/v1' });
    app.register(recommendationRoutes, { db, prefix: '/api/v1' });
    app.register(learningPathRoutes, { db, prefix: '/api/v1' });
    app.register(learningSessionRoutes, { db, prefix: '/api/v1' });
  }

  return app;
}
