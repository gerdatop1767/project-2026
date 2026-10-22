import type { Database } from '@zybrilka/db';
import rateLimit from '@fastify/rate-limit';
import type { FastifyPluginAsync } from 'fastify';
import type { Config } from '../../config.js';
import { rejectCrossSiteWrites } from '../../plugins/authSession.js';
import { requireAdmin } from './access.js';

export interface AdminRoutesOptions {
  db: Database;
  config: Config;
}

/**
 * /api/v1/admin/* — the owner-only admin API. Every route registered in
 * this scope (now or later) runs behind `requireAdmin` (401/403 before any
 * handler, body parsing or query), the cross-site write guard and a
 * per-account rate limit. See access.ts and docs/ADMIN.md.
 */
export const adminRoutes: FastifyPluginAsync<AdminRoutesOptions> = async (app, { db, config }) => {
  await app.register(rateLimit, {
    global: true,
    max: 240,
    timeWindow: '1 minute',
    // Per signed-in account when there is one, else per IP.
    keyGenerator: (request) => request.sessionUserId ?? request.ip,
  });
  app.addHook('onRequest', requireAdmin(db, config.ADMIN_OWNER_USER_IDS));
  app.addHook('onRequest', rejectCrossSiteWrites);

  app.get('/admin/me', async (request) => ({
    userId: request.sessionUserId,
    role: 'owner' as const,
  }));
};
