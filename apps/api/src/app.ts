import type { Database } from '@zybrilka/db';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyPluginAsync, type FastifyServerOptions } from 'fastify';
import type { Config } from './config.js';
import { healthRoutes } from './routes/health.js';
import { registerAnonUser } from './plugins/anonUser.js';
import {
  registerAuthSession,
  requireSession,
  withoutEncapsulation,
} from './plugins/authSession.js';
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
  /** Forwarded to Fastify. Needed behind a reverse proxy so `request.ip`
   * (what the auth rate limits key on) is the real client, not the proxy. */
  trustProxy?: boolean;
}

export function buildApp({
  logger = false,
  version,
  checkDb,
  db,
  authConfig,
  trustProxy,
}: AppOptions) {
  const app = Fastify({ logger, trustProxy });
  app.register(healthRoutes, { version, checkDb });

  if (db) {
    // With `authConfig` (production) the ONLY identity is a server-side
    // session: the client-supplied `x-anon-id` header is not read at all
    // (it was never a security boundary — anyone could invent ids), and
    // every route except /health and /api/v1/auth/* answers 401 without a
    // valid session. Without `authConfig` (the pre-auth test setups) the
    // legacy anonymous-header behavior is kept exactly as it was.
    void registerAnonUser(app, db, { trustHeader: !authConfig });

    const privateRoutes: FastifyPluginAsync = async (scope) => {
      scope.register(tasksRoutes, { db, prefix: '/api/v1' });
      scope.register(variantsRoutes, { db, prefix: '/api/v1' });
      scope.register(collectionsRoutes, { db, prefix: '/api/v1' });
      scope.register(mistakesRoutes, { db, prefix: '/api/v1' });
      scope.register(progressRoutes, { db, prefix: '/api/v1' });
      scope.register(favoritesRoutes, { db, prefix: '/api/v1' });
      scope.register(learningProfileRoutes, { db, prefix: '/api/v1' });
      scope.register(learningRoutes, { db, prefix: '/api/v1' });
      scope.register(taskStatisticsRoutes, { db, prefix: '/api/v1' });
      scope.register(errorSignaturesRoutes, { db, prefix: '/api/v1' });
      scope.register(taskSimilarityRoutes, { db, prefix: '/api/v1' });
      scope.register(recommendationRoutes, { db, prefix: '/api/v1' });
      scope.register(learningPathRoutes, { db, prefix: '/api/v1' });
      scope.register(learningSessionRoutes, { db, prefix: '/api/v1' });
    };

    if (authConfig) {
      // `@fastify/cookie` is global (fastify-plugin); the session hook
      // must run after it, and must apply to EVERY route (not only the
      // auth module's own child scope, which is where it used to live —
      // so a logged-in session never reached the trainer routes).
      app.register(cookie);
      app.register(withoutEncapsulation(async (root) => registerAuthSession(root, db)));
      app.register(async (authScope) => {
        // `global: false` — this plugin only throttles the specific
        // auth routes that opt in via their own `config.rateLimit`
        // (see modules/auth/routes.ts), never any other route in the
        // app, and it's registered before `authRoutes` for the same
        // avvio sequential-loading reason as `cookie`/`authSession`
        // above: its `onRoute` hook must already be active before the
        // throttled routes are added.
        await authScope.register(rateLimit, { global: false });
        authScope.register(authRoutes, { db, config: authConfig, prefix: '/api/v1' });
      });
      app.register(async (scope) => {
        scope.addHook('onRequest', requireSession);
        scope.register(privateRoutes);
      });
    } else {
      app.register(privateRoutes);
    }
  }

  return app;
}
