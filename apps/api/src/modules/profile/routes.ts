import type { Database } from '@zybrilka/db';
import {
  AVATAR_CONTENT_TYPES,
  AVATAR_MAX_BYTES,
  identityProviderSchema,
  telegramInitDataRequestSchema,
  updateProfileRequestSchema,
} from '@zybrilka/shared';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { Config } from '../../config.js';
import * as authService from '../auth/service.js';
import * as repo from './repo.js';
import * as service from './service.js';

export interface ProfileRoutesOptions {
  db: Database;
  config: Config;
}

const avatarSourceParams = z.object({ source: z.enum(['user', 'telegram']) });
const providerParams = z.object({ provider: identityProviderSchema });

/**
 * "My profile" API. Registered INSIDE the private scope (every route here
 * needs a valid session, enforced before the handler runs) and every
 * handler acts on `request.sessionUserId` only — there is no user id in any
 * URL or body, so there is no way to address someone else's profile.
 */
export const profileRoutes: FastifyPluginAsync<ProfileRoutesOptions> = async (
  app,
  { db, config },
) => {
  // Avatars arrive as the raw image bytes (not multipart/JSON): no extra
  // dependency, and a non-simple Content-Type that browsers will not send
  // cross-site without a CORS preflight.
  app.addContentTypeParser(
    [...AVATAR_CONTENT_TYPES],
    { parseAs: 'buffer', bodyLimit: AVATAR_MAX_BYTES + 1 },
    (_request, body, done) => done(null, body),
  );

  const userId = (request: { sessionUserId: string | null }) => request.sessionUserId!;

  app.patch('/me/profile', async (request, reply) => {
    const body = updateProfileRequestSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_body' });
    const result = await service.updateCustomName(db, userId(request), body.data.displayName);
    if (!result.ok) return reply.code(400).send({ error: 'invalid_name', problem: result.problem });
    return { user: await authService.loadAuthUser(db, userId(request)) };
  });

  app.put('/me/avatar', { bodyLimit: AVATAR_MAX_BYTES + 1 }, async (request, reply) => {
    if (!Buffer.isBuffer(request.body)) {
      return reply.code(415).send({ error: 'unsupported_media_type' });
    }
    const result = await service.saveUploadedAvatar(db, userId(request), request.body);
    if (!result.ok) {
      return reply.code(result.problem === 'too_large' ? 413 : 400).send({
        error: result.problem === 'too_large' ? 'too_large' : 'invalid_image',
        problem: result.problem,
      });
    }
    return { user: await authService.loadAuthUser(db, userId(request)) };
  });

  app.delete('/me/avatar', async (request) => {
    await service.removeUploadedAvatar(db, userId(request));
    return { user: await authService.loadAuthUser(db, userId(request)) };
  });

  // Owner-only. The `?v=` hash in the URL versions the cache; the headers
  // make a stored file inert even if its bytes were crafted to look like
  // something else (no sniffing, no scripts, no framing).
  app.get('/me/avatars/:source', async (request, reply) => {
    const params = avatarSourceParams.safeParse(request.params);
    if (!params.success) return reply.code(404).send({ error: 'not_found' });
    const avatar = await service.readOwnAvatar(db, userId(request), params.data.source);
    if (!avatar) return reply.code(404).send({ error: 'not_found' });
    return reply
      .header('content-type', avatar.contentType)
      .header('x-content-type-options', 'nosniff')
      .header('content-security-policy', "default-src 'none'; sandbox")
      .header('cache-control', 'private, max-age=31536000, immutable')
      .send(avatar.data);
  });

  app.get('/me/identities', async (request) => {
    return service.listIdentities(db, config, userId(request));
  });

  app.post('/me/identities/telegram', async (request, reply) => {
    const body = telegramInitDataRequestSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_body' });
    try {
      const outcome = await authService.linkTelegramIdentity(
        db,
        config,
        userId(request),
        body.data.initData,
        request.log,
      );
      if (outcome === 'taken') {
        return reply.code(409).send({ error: 'identity_taken', provider: 'telegram' });
      }
      if (outcome === 'provider_already_used') {
        return reply.code(409).send({ error: 'provider_already_used', provider: 'telegram' });
      }
      return {
        status: outcome,
        user: await authService.loadAuthUser(db, userId(request)),
      };
    } catch (error) {
      if (error instanceof authService.TelegramNotConfiguredError) {
        request.log.error(
          { tgAuth: 'not_configured' },
          'Telegram link requested but TELEGRAM_BOT_TOKEN is not set',
        );
        return reply.code(503).send({ error: 'telegram_not_configured' });
      }
      if (error instanceof authService.TelegramAuthError) {
        request.log.warn({ tgAuth: error.reason, ...error.diagnostics }, 'Telegram link rejected');
        return reply.code(400).send({
          error: error.reason === 'expired' ? 'telegram_data_expired' : 'invalid_telegram_data',
        });
      }
      throw error;
    }
  });

  app.delete('/me/identities/:provider', async (request, reply) => {
    const params = providerParams.safeParse(request.params);
    if (!params.success) return reply.code(404).send({ error: 'not_found' });
    const outcome = await repo.removeIdentity(db, userId(request), params.data.provider);
    if (outcome === 'not_linked') return reply.code(404).send({ error: 'not_linked' });
    if (outcome === 'last_identity') return reply.code(409).send({ error: 'last_identity' });
    return service.listIdentities(db, config, userId(request));
  });
};
