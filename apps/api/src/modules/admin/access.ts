import type { Database } from '@zybrilka/db';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { writeAudit } from './audit.js';

/**
 * Owner-only access to /api/v1/admin/* (docs/ADMIN.md §Доступ).
 *
 * The ONLY things that decide it are server-side: the httpOnly session
 * cookie resolved against `auth_sessions` (`request.sessionUserId`, see
 * plugins/authSession.ts — never a header, query, body or client flag) and
 * the `ADMIN_OWNER_USER_IDS` list from the server's environment. An empty
 * list (the default) means nobody is an admin. Signing up can never put an
 * id on that list, and nothing in the API writes it.
 *
 * - no valid session → 401 (and nothing else is checked or revealed);
 * - a session whose user is not on the list → 403, recorded in the audit
 *   log (a signed-in user probing the admin API is worth knowing about);
 * - a write must also carry `x-zybrilka-admin: 1` — a custom header a
 *   cross-site page cannot send without a CORS preflight this API never
 *   answers, on top of the SameSite=Lax cookie and the Sec-Fetch-Site guard.
 */
export const ADMIN_WRITE_HEADER = 'x-zybrilka-admin';

export function isAdminUser(ownerIds: readonly string[], userId: string | null): boolean {
  return userId !== null && ownerIds.includes(userId.toLowerCase());
}

export function requireAdmin(db: Database, ownerIds: readonly string[]) {
  return async function requireAdminHook(request: FastifyRequest, reply: FastifyReply) {
    reply.header('cache-control', 'no-store');
    if (!request.sessionUserId) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    if (!isAdminUser(ownerIds, request.sessionUserId)) {
      await writeAudit(db, {
        actorUserId: request.sessionUserId,
        action: 'admin.access_denied',
        result: 'denied',
        details: { method: request.method, route: request.routeOptions.url ?? 'unknown' },
      }).catch((err: unknown) => request.log.error({ err }, 'audit write failed'));
      return reply.code(403).send({ error: 'forbidden' });
    }
    const isWrite = !['GET', 'HEAD', 'OPTIONS'].includes(request.method);
    if (isWrite && request.headers[ADMIN_WRITE_HEADER] !== '1') {
      return reply.code(403).send({ error: 'missing_admin_header' });
    }
  };
}
