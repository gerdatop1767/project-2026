import type { Database } from '@zybrilka/db';
import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import * as repo from '../modules/auth/repo.js';

const SESSION_COOKIE = 'session_id';

declare module 'fastify' {
  interface FastifyRequest {
    /** The user id of a valid server-side session on this request, or
     * `null`. Unlike `userId` this can never come from a client header. */
    sessionUserId: string | null;
  }
}

/**
 * Marks a plugin as non-encapsulated (what `fastify-plugin` does) so the
 * hooks/decorators it adds apply to the whole app instead of only to the
 * child scope `register()` creates. Same effect as `fastify-plugin`,
 * without adding the dependency for one call site.
 */
export function withoutEncapsulation(plugin: FastifyPluginAsync): FastifyPluginAsync {
  (plugin as unknown as Record<symbol, boolean>)[Symbol.for('skip-override')] = true;
  return plugin;
}

/**
 * Resolves the `session_id` cookie against the database on every
 * request and sets `request.sessionUserId` (and `request.userId`, which
 * every task/attempt/mistake route reads) to the real authenticated
 * user. An expired/deleted session simply resolves to nobody — the
 * cookie value alone is never trusted.
 *
 * Must be registered AFTER `registerAnonUser` (which decorates
 * `userId`) and after `@fastify/cookie` (which fills `request.cookies`).
 */
export async function registerAuthSession(app: FastifyInstance, db: Database) {
  app.decorateRequest('sessionUserId', null);
  app.addHook('onRequest', async (request) => {
    const sessionId = request.cookies?.[SESSION_COOKIE];
    if (!sessionId) return;
    const userId = await repo.getSessionUserId(db, sessionId);
    if (userId) {
      request.sessionUserId = userId;
      request.userId = userId;
    }
  });
}

/** `onRequest` guard for private routes: no valid session → 401 before
 * any handler (or body parsing) runs. */
export async function requireSession(request: FastifyRequest, reply: FastifyReply) {
  if (!request.sessionUserId) {
    return reply.code(401).send({ error: 'unauthorized' });
  }
}

/**
 * Defence in depth against cross-site request forgery for everything that
 * changes state. The session cookie is already `SameSite=Lax` (not sent on
 * cross-site POST/PUT/PATCH/DELETE) and these routes need non-simple
 * request shapes, but browsers also say where a request came from: a
 * state-changing request that declares itself `cross-site` is refused
 * outright. Requests without the header (older browsers, scripts, tests)
 * fall back to the cookie protection.
 */
export async function rejectCrossSiteWrites(request: FastifyRequest, reply: FastifyReply) {
  if (request.method === 'GET' || request.method === 'HEAD' || request.method === 'OPTIONS') return;
  const site = request.headers['sec-fetch-site'];
  if (
    typeof site === 'string' &&
    site !== 'same-origin' &&
    site !== 'same-site' &&
    site !== 'none'
  ) {
    return reply.code(403).send({ error: 'cross_site_request_blocked' });
  }
}
