import type { Database } from '@zybrilka/db';
import type { FastifyInstance } from 'fastify';
import * as repo from '../modules/auth/repo.js';

const SESSION_COOKIE = 'session_id';

/**
 * Overrides `request.userId` (decorated by the anon-user plugin — see
 * plugins/anonUser.ts) with the real authenticated user when a valid
 * `session_id` cookie is present. Purely additive: an anonymous
 * visitor with no session cookie keeps working exactly as before
 * (request.userId stays whatever anonUser's `x-anon-id` resolution
 * gave it); task-answering/attempts/mistakes routes never had to
 * change, since they only ever read `request.userId`.
 *
 * Must be registered AFTER `registerAnonUser` so this hook runs second
 * and wins — Fastify runs `onRequest` hooks in registration order.
 */
export async function registerAuthSession(app: FastifyInstance, db: Database) {
  app.addHook('onRequest', async (request) => {
    const sessionId = request.cookies?.[SESSION_COOKIE];
    if (!sessionId) return;
    const userId = await repo.getSessionUserId(db, sessionId);
    if (userId) request.userId = userId;
  });
}
