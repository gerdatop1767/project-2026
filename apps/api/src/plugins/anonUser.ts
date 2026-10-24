import type { Database } from '@zybrilka/db';
import { schema } from '@zybrilka/db';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

const anonIdSchema = z.uuid();

declare module 'fastify' {
  interface FastifyRequest {
    /**
     * The client-generated anonymous id (see apps/web's lib/api.ts),
     * once validated and upserted into `users`. Real auth (S3) doesn't
     * exist yet — this is only a stable FK target for attempts/
     * mistakes/progress, never a security boundary. `null` when the
     * request sent no (or an invalid) `x-anon-id` header.
     */
    userId: string | null;
  }
}

/**
 * Resolves `request.userId` from the `x-anon-id` header, lazily
 * creating the `users` row on first sight. Does NOT reject requests
 * without the header — routes that need a user (attempts, mistakes,
 * progress) check `request.userId` themselves and answer 400, so
 * plain task browsing keeps working without it.
 *
 * Registered directly on the root app instance (not via `app.register`)
 * so the `request.userId` decoration and hook apply to every route,
 * including ones registered in their own encapsulated child plugins —
 * no `fastify-plugin` dependency needed for that.
 */
export async function registerAnonUser(
  app: FastifyInstance,
  db: Database,
  { trustHeader = true }: { trustHeader?: boolean } = {},
) {
  app.decorateRequest('userId', null);

  // Real auth is on: identity comes only from the server-side session
  // (see plugins/authSession.ts). The header is neither read nor used
  // to create `users` rows — otherwise anyone could mint accounts and
  // act as any uuid just by sending it.
  if (!trustHeader) return;

  app.addHook('onRequest', async (request) => {
    const header = request.headers['x-anon-id'];
    const value = Array.isArray(header) ? header[0] : header;
    const parsed = anonIdSchema.safeParse(value);
    if (!parsed.success) {
      request.userId = null;
      return;
    }

    await db
      .insert(schema.users)
      .values({ id: parsed.data })
      .onConflictDoUpdate({
        target: schema.users.id,
        set: { lastSeenAt: new Date() },
      });
    request.userId = parsed.data;
  });
}
