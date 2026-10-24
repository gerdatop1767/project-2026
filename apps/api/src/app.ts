import type { Database } from '@zybrilka/db';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyPluginAsync, type FastifyServerOptions } from 'fastify';
import type { Config } from './config.js';
import { healthRoutes } from './routes/health.js';
import { RequestMetrics, registerRequestMetrics } from './plugins/requestMetrics.js';
import { registerAnonUser } from './plugins/anonUser.js';
import {
  registerAuthSession,
  rejectCrossSiteWrites,
  requireSession,
  withoutEncapsulation,
} from './plugins/authSession.js';
import { adminRoutes } from './modules/admin/routes.js';
import { analyticsRoutes } from './modules/analytics/routes.js';
import { authRoutes } from './modules/auth/routes.js';
import { complaintsRoutes } from './modules/complaints/routes.js';
import { reminderRoutes } from './modules/reminders/routes.js';
import { profileRoutes } from './modules/profile/routes.js';
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
import { enqueueNotification } from './modules/notifications/outbox.js';
import { errorKind, SiteErrorNotifier } from './modules/notifications/siteErrors.js';
import { progressRoutes, publicTopicsRoutes } from './modules/progress/routes.js';
import { leaderboardRoutes } from './modules/leaderboard/routes.js';
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
  // Route-pattern/status/duration of recent requests, in memory only —
  // read by the admin «Техническое состояние» page.
  const requestMetrics = new RequestMetrics();
  registerRequestMetrics(app, requestMetrics);
  app.register(healthRoutes, { version, checkDb });

  if (db) {
    // Server errors (5xx) → an owner notification, grouped with a cooldown
    // (modules/notifications). /health is left to the worker's own probe:
    // its 503 means "database down", which the database can't record anyway.
    const siteErrors = new SiteErrorNotifier(
      (data) => void enqueueNotification(db, app.log, { kind: 'site_error', data }),
    );
    const failedWith = new WeakMap<object, string>();
    app.addHook('onError', async (request, _reply, error) => {
      failedWith.set(request, errorKind(error));
    });
    app.addHook('onResponse', async (request, reply) => {
      const route = request.routeOptions.url ?? '(unmatched)';
      if (reply.statusCode < 500 || route === '/health') return;
      siteErrors.record({
        method: request.method,
        route,
        status: reply.statusCode,
        error: failedWith.get(request) ?? 'response',
      });
    });

    // With `authConfig` (production) the ONLY identity is a server-side
    // session: the client-supplied `x-anon-id` header is not read at all
    // (it was never a security boundary — anyone could invent ids). Task
    // content and answer checking are open to guests; every personal route
    // (statistics, mistakes, favorites, learning, profile) answers 401
    // without a valid session. Without `authConfig` (the pre-auth test setups) the
    // legacy anonymous-header behavior is kept exactly as it was.
    void registerAnonUser(app, db, { trustHeader: !authConfig });

    // Task content and answer checking — open to guests in production
    // (guest mode: anyone can train without an account; a guest's answer
    // is checked but never recorded, see tasks/service.submitAttempt).
    const contentRoutes =
      (allowGuestAttempts: boolean): FastifyPluginAsync =>
      async (scope) => {
        scope.register(tasksRoutes, { db, allowGuestAttempts, prefix: '/api/v1' });
        scope.register(variantsRoutes, { db, prefix: '/api/v1' });
        scope.register(collectionsRoutes, { db, prefix: '/api/v1' });
        scope.register(taskStatisticsRoutes, { db, prefix: '/api/v1' });
        scope.register(taskSimilarityRoutes, { db, prefix: '/api/v1' });
        scope.register(publicTopicsRoutes, { db, prefix: '/api/v1' });
      };

    // Everything personal — statistics, mistakes, favorites, learning
    // profile/sessions/recommendations: a session is required (401).
    const privateRoutes: FastifyPluginAsync = async (scope) => {
      scope.register(mistakesRoutes, { db, prefix: '/api/v1' });
      scope.register(progressRoutes, { db, prefix: '/api/v1' });
      scope.register(leaderboardRoutes, { db, prefix: '/api/v1' });
      scope.register(favoritesRoutes, { db, prefix: '/api/v1' });
      scope.register(learningProfileRoutes, { db, prefix: '/api/v1' });
      scope.register(learningRoutes, { db, prefix: '/api/v1' });
      scope.register(errorSignaturesRoutes, { db, prefix: '/api/v1' });
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
        // Sign-in POSTs (magic-link verify, Telegram) are same-origin fetches
        // from our own pages; a cross-site one would be login CSRF.
        authScope.addHook('onRequest', rejectCrossSiteWrites);
        authScope.register(authRoutes, { db, config: authConfig, prefix: '/api/v1' });
      });
      app.register(async (guestScope) => {
        // Throttles guests' answer checks only (see tasks/routes.ts).
        await guestScope.register(rateLimit, { global: false });
        guestScope.addHook('onRequest', rejectCrossSiteWrites);
        guestScope.register(contentRoutes(true));
      });
      app.register(async (scope) => {
        scope.addHook('onRequest', requireSession);
        scope.addHook('onRequest', rejectCrossSiteWrites);
        scope.register(privateRoutes);
        scope.register(profileRoutes, { db, config: authConfig, prefix: '/api/v1' });
      });
      app.register(async (scope) => {
        // Product analytics + campaign links: public, per-IP throttled.
        await scope.register(rateLimit, { global: false });
        scope.addHook('onRequest', rejectCrossSiteWrites);
        scope.register(analyticsRoutes, { db, config: authConfig, prefix: '/api/v1' });
      });
      app.register(async (scope) => {
        // Daily reminders and the Telegram link: an account is required.
        await scope.register(rateLimit, { global: false });
        scope.addHook('onRequest', requireSession);
        scope.addHook('onRequest', rejectCrossSiteWrites);
        scope.register(reminderRoutes, { db, prefix: '/api/v1' });
      });
      app.register(async (scope) => {
        // Task complaints: an account is required, throttled per account.
        await scope.register(rateLimit, { global: false });
        scope.addHook('onRequest', requireSession);
        scope.addHook('onRequest', rejectCrossSiteWrites);
        scope.register(complaintsRoutes, { db, prefix: '/api/v1' });
      });
      // Owner-only admin API — its own scope, its own guard (admin/access.ts).
      app.register(adminRoutes, {
        db,
        config: authConfig,
        metrics: requestMetrics,
        version,
        prefix: '/api/v1',
      });
    } else {
      app.register(contentRoutes(false));
      app.register(privateRoutes);
    }
  }

  return app;
}
