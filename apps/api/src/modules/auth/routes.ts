import type { Database } from '@zybrilka/db';
import { magicLinkRequestSchema, verifyMagicLinkRequestSchema } from '@zybrilka/shared';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { Config } from '../../config.js';
import * as service from './service.js';
import { createVkPkceChallenge, buildVkAuthorizeUrl, isVkConfigured } from './vk.js';

export interface AuthRoutesOptions {
  db: Database;
  config: Config;
}

const SESSION_COOKIE = 'session_id';
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 30 days — mirrors service.ts's SESSION_TTL_MS

const VK_PKCE_COOKIE = 'vk_pkce';
const vkPkceCookieSchema = z.object({ state: z.string(), codeVerifier: z.string() });

const vkCallbackQuerySchema = z.object({
  code: z.string().min(1),
  device_id: z.string().min(1),
  state: z.string().min(1),
});

function cookieOptions(config: Config, maxAgeSeconds: number) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: config.NODE_ENV === 'production',
    path: '/',
    maxAge: maxAgeSeconds,
  };
}

export const authRoutes: FastifyPluginAsync<AuthRoutesOptions> = async (app, { db, config }) => {
  // Always the same response shape whether or not `email` has an
  // account — never reveals which, to prevent email enumeration (see
  // service.ts's requestMagicLink doc comment).
  app.post('/auth/magic-link', async (request, reply) => {
    const body = magicLinkRequestSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'invalid_body', issues: body.error.issues });
    }
    try {
      await service.requestMagicLink(db, config, body.data.email);
    } catch (error) {
      if (error instanceof service.EmailNotConfiguredError) {
        return reply.code(503).send({ error: 'email_not_configured' });
      }
      throw error;
    }
    return reply.code(200).send({ ok: true });
  });

  app.post('/auth/verify', async (request, reply) => {
    const body = verifyMagicLinkRequestSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'invalid_body', issues: body.error.issues });
    }
    try {
      const { sessionId, user } = await service.verifyMagicLink(db, body.data.token);
      reply.setCookie(SESSION_COOKIE, sessionId, cookieOptions(config, SESSION_MAX_AGE_SECONDS));
      return reply.code(200).send({ user });
    } catch (error) {
      if (error instanceof service.InvalidMagicLinkError) {
        return reply.code(400).send({ error: 'invalid_or_expired_token' });
      }
      throw error;
    }
  });

  app.get('/auth/vk/start', async (request, reply) => {
    if (!isVkConfigured(config)) {
      return reply.code(503).send({ error: 'vk_not_configured' });
    }
    const challenge = createVkPkceChallenge();
    reply.setCookie(
      VK_PKCE_COOKIE,
      JSON.stringify({ state: challenge.state, codeVerifier: challenge.codeVerifier }),
      cookieOptions(config, 600),
    );
    return reply.redirect(buildVkAuthorizeUrl(config, challenge));
  });

  app.get('/auth/vk/callback', async (request, reply) => {
    const query = vkCallbackQuerySchema.safeParse(request.query);
    const rawCookie = request.cookies[VK_PKCE_COOKIE];
    reply.clearCookie(VK_PKCE_COOKIE, { path: '/' });
    if (!query.success || !rawCookie) {
      return reply.code(400).send({ error: 'invalid_callback' });
    }
    const saved = vkPkceCookieSchema.safeParse(JSON.parse(rawCookie));
    // CSRF check: the `state` VK echoes back must match the one this
    // server generated and stored server-side (in the httpOnly
    // cookie) for this exact login attempt, not just be present.
    if (!saved.success || saved.data.state !== query.data.state) {
      return reply.code(400).send({ error: 'invalid_state' });
    }
    try {
      const { sessionId } = await service.completeVkLogin(
        db,
        config,
        query.data.code,
        query.data.device_id,
        saved.data.codeVerifier,
      );
      reply.setCookie(SESSION_COOKIE, sessionId, cookieOptions(config, SESSION_MAX_AGE_SECONDS));
      return reply.redirect(config.WEB_BASE_URL);
    } catch (error) {
      if (error instanceof service.VkNotConfiguredError) {
        return reply.code(503).send({ error: 'vk_not_configured' });
      }
      request.log.error({ error }, 'VK login failed');
      return reply.code(502).send({ error: 'vk_login_failed' });
    }
  });

  app.get('/auth/me', async (request, reply) => {
    const sessionId = request.cookies[SESSION_COOKIE];
    if (!sessionId) return reply.code(200).send({ user: null });
    const user = await service.getCurrentUser(db, sessionId);
    return reply.code(200).send({ user });
  });

  app.post('/auth/logout', async (request, reply) => {
    const sessionId = request.cookies[SESSION_COOKIE];
    if (sessionId) await service.logout(db, sessionId);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.code(204).send();
  });
};
