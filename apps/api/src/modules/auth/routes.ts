import type { Database } from '@zybrilka/db';
import {
  emailTokenRequestSchema,
  forgotPasswordRequestSchema,
  magicLinkRequestSchema,
  passwordLoginRequestSchema,
  registerRequestSchema,
  resendConfirmationRequestSchema,
  resetPasswordRequestSchema,
  telegramInitDataRequestSchema,
  verifyMagicLinkRequestSchema,
} from '@zybrilka/shared';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Config } from '../../config.js';
import { isAdminUser } from '../admin/access.js';
import { recordSignIn } from '../analytics/recorder.js';
import * as service from './service.js';
import { createVkPkceChallenge, buildVkAuthorizeUrl, isVkConfigured } from './vk.js';
import * as handoff from './handoff.js';
import * as emailPassword from './emailPassword.js';
import { EmailSendError } from './email.js';
import { EmailThrottle } from './emailThrottle.js';

export interface AuthRoutesOptions {
  db: Database;
  config: Config;
  /** Per-address letter limit; tests pass one with their own clock. */
  emailThrottle?: EmailThrottle;
}

const SESSION_COOKIE = 'session_id';
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 30 days — mirrors service.ts's SESSION_TTL_MS

const VK_PKCE_COOKIE = 'vk_pkce';
const vkPkceCookieSchema = z.object({
  state: z.string(),
  codeVerifier: z.string(),
  // Present when the flow was started from a signed-in profile to ADD VK to
  // that account (instead of signing in). Written by this server at `start`
  // from the session, and re-checked against the session at `callback`.
  link: z.object({ userId: z.uuid() }).optional(),
  // Present when this browser is completing a sign-in for the Telegram
  // Mini App (see handoff.ts) — the handoff row id, written by this server.
  handoff: z.uuid().optional(),
});

/** The Mini App's own claim secret for a VK handoff (httpOnly, only sent to
 * the handoff endpoints). */
const HANDOFF_COOKIE = 'vk_handoff';
const HANDOFF_COOKIE_PATH = '/api/v1/auth/vk/handoff';
const handoffStartQuerySchema = z.object({ handoff: z.string().min(20).max(100) });

const vkCallbackQuerySchema = z.object({
  code: z.string().min(1),
  device_id: z.string().min(1),
  state: z.string().min(1),
});

/** Parses the `vk_pkce` cookie. The cookie is client-controlled input,
 * so anything that isn't exactly the expected JSON shape (garbage,
 * truncated, wrong shape) is reported as a failed parse instead of
 * throwing — a corrupt cookie must be a 4xx, never a 500. */
function parseVkPkceCookie(raw: string) {
  try {
    return vkPkceCookieSchema.safeParse(JSON.parse(raw));
  } catch {
    return { success: false as const };
  }
}

function baseCookieOptions(config: Config) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: config.NODE_ENV === 'production',
    path: '/',
  };
}

function cookieOptions(config: Config, maxAgeSeconds: number) {
  return { ...baseCookieOptions(config), maxAge: maxAgeSeconds };
}

/** Expires the session cookie with exactly the attributes it was set
 * with (Path, Secure, HttpOnly, SameSite) — a deletion whose Path
 * differs from the original is silently ignored by browsers. */
function clearSessionCookie(reply: FastifyReply, config: Config) {
  reply.clearCookie(SESSION_COOKIE, baseCookieOptions(config));
}

export const authRoutes: FastifyPluginAsync<AuthRoutesOptions> = async (
  app,
  { db, config, emailThrottle: givenThrottle },
) => {
  // A new sign-in replaces the browser's session cookie; the session it
  // replaces must not stay valid on the server (shared device, account switch).
  async function dropPreviousSession(request: FastifyRequest, newSessionId: string) {
    const previous = request.cookies[SESSION_COOKIE];
    if (previous && previous !== newSessionId) await service.logout(db, previous);
  }

  // Always the same response shape whether or not `email` has an
  // account — never reveals which, to prevent email enumeration (see
  // service.ts's requestMagicLink doc comment). Rate-limited per IP —
  // sending email is the one real cost/abuse surface here.
  app.post(
    '/auth/magic-link',
    { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } },
    async (request, reply) => {
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
    },
  );

  // Rate-limited per IP — a 256-bit token is already infeasible to
  // guess, but this still caps plain error-spam/abuse against the route.
  app.post(
    '/auth/verify',
    { config: { rateLimit: { max: 30, timeWindow: '10 minutes' } } },
    async (request, reply) => {
      const body = verifyMagicLinkRequestSchema.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({ error: 'invalid_body', issues: body.error.issues });
      }
      try {
        const { sessionId, user, created } = await service.verifyMagicLink(db, body.data.token);
        await dropPreviousSession(request, sessionId);
        await recordSignIn(db, request, { userId: user.id, created, method: 'email' });
        reply.setCookie(SESSION_COOKIE, sessionId, cookieOptions(config, SESSION_MAX_AGE_SECONDS));
        return reply.code(200).send({ user });
      } catch (error) {
        if (error instanceof service.InvalidMagicLinkError) {
          return reply.code(400).send({ error: 'invalid_or_expired_token' });
        }
        throw error;
      }
    },
  );

  // ------------------------------------------- email + password (EMAIL_AUTH.md)
  const emailThrottle = givenThrottle ?? new EmailThrottle();

  /** Maps the email flows' errors to responses. Never echoes SMTP details:
   * the log gets a coarse code, the client a fixed error name. */
  function emailFlowError(request: FastifyRequest, reply: FastifyReply, error: unknown) {
    if (error instanceof service.EmailNotConfiguredError) {
      request.log.error({ mail: 'not_configured' }, 'Email requested but SMTP is not configured');
      return reply.code(503).send({ error: 'email_not_configured' });
    }
    if (error instanceof EmailSendError) {
      request.log.error(
        { mail: 'send_failed', code: error.code, responseCode: error.responseCode },
        'Email could not be sent',
      );
      return reply.code(502).send({ error: 'email_send_failed' });
    }
    if (error instanceof emailPassword.ThrottledError) {
      return reply
        .code(429)
        .header('retry-after', String(error.retryAfterSeconds))
        .send({ error: 'too_many_requests', retryAfterSeconds: error.retryAfterSeconds });
    }
    if (error instanceof emailPassword.PasswordRejectedError) {
      return reply.code(400).send({ error: 'weak_password', problem: error.problem });
    }
    if (error instanceof emailPassword.TokenExpiredError) {
      return reply.code(410).send({ error: 'token_expired' });
    }
    if (error instanceof emailPassword.TokenInvalidError) {
      return reply.code(400).send({ error: 'invalid_or_used_token' });
    }
    if (error instanceof emailPassword.AlreadyRegisteredError) {
      return reply.code(409).send({ error: 'already_registered' });
    }
    throw error;
  }

  async function signIn(request: FastifyRequest, reply: FastifyReply, result: service.LoginResult) {
    await dropPreviousSession(request, result.sessionId);
    await recordSignIn(db, request, {
      userId: result.user.id,
      created: result.created,
      method: 'email',
    });
    reply.setCookie(
      SESSION_COOKIE,
      result.sessionId,
      cookieOptions(config, SESSION_MAX_AGE_SECONDS),
    );
    return reply.code(200).send({ user: result.user, created: result.created });
  }

  // Same answer whether or not the address already has an account.
  app.post(
    '/auth/register',
    { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } },
    async (request, reply) => {
      const body = registerRequestSchema.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: 'invalid_body' });
      try {
        await emailPassword.register(
          db,
          config,
          emailThrottle,
          body.data.email,
          body.data.password,
        );
      } catch (error) {
        return emailFlowError(request, reply, error);
      }
      return reply.code(200).send({ ok: true });
    },
  );

  app.post(
    '/auth/register/confirm',
    { config: { rateLimit: { max: 30, timeWindow: '10 minutes' } } },
    async (request, reply) => {
      const body = emailTokenRequestSchema.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: 'invalid_or_used_token' });
      try {
        return await signIn(
          request,
          reply,
          await emailPassword.confirmRegistration(db, body.data.token),
        );
      } catch (error) {
        return emailFlowError(request, reply, error);
      }
    },
  );

  app.post(
    '/auth/register/resend',
    { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } },
    async (request, reply) => {
      const body = resendConfirmationRequestSchema.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: 'invalid_body' });
      try {
        await emailPassword.resendConfirmation(db, config, emailThrottle, body.data);
      } catch (error) {
        return emailFlowError(request, reply, error);
      }
      return reply.code(200).send({ ok: true });
    },
  );

  // One error for "no such address", "no password" and "wrong password".
  app.post(
    '/auth/login',
    { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } },
    async (request, reply) => {
      const body = passwordLoginRequestSchema.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: 'invalid_body' });
      try {
        return await signIn(
          request,
          reply,
          await emailPassword.loginWithPassword(db, body.data.email, body.data.password),
        );
      } catch (error) {
        if (error instanceof emailPassword.InvalidCredentialsError) {
          return reply.code(401).send({ error: 'invalid_credentials' });
        }
        throw error;
      }
    },
  );

  app.post(
    '/auth/password/forgot',
    { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } },
    async (request, reply) => {
      const body = forgotPasswordRequestSchema.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: 'invalid_body' });
      try {
        await emailPassword.forgotPassword(db, config, emailThrottle, body.data.email);
      } catch (error) {
        return emailFlowError(request, reply, error);
      }
      return reply.code(200).send({ ok: true });
    },
  );

  app.post(
    '/auth/password/reset/check',
    { config: { rateLimit: { max: 30, timeWindow: '10 minutes' } } },
    async (request, reply) => {
      const body = emailTokenRequestSchema.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: 'invalid_or_used_token' });
      try {
        await emailPassword.checkResetToken(db, body.data.token);
      } catch (error) {
        return emailFlowError(request, reply, error);
      }
      return reply.code(200).send({ ok: true });
    },
  );

  app.post(
    '/auth/password/reset',
    { config: { rateLimit: { max: 20, timeWindow: '10 minutes' } } },
    async (request, reply) => {
      const body = resetPasswordRequestSchema.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: 'invalid_body' });
      try {
        return await signIn(
          request,
          reply,
          await emailPassword.resetPassword(db, body.data.token, body.data.password),
        );
      } catch (error) {
        return emailFlowError(request, reply, error);
      }
    },
  );

  /** The external browser's last stop in a Mini App sign-in: a page that
   * says how it went and how to get back to Telegram. Status is chosen by
   * this server, never echoed from the request. */
  function toTelegramReturn(reply: FastifyReply, status: 'ok' | 'cancelled' | 'error' | 'expired') {
    return reply.redirect(
      new URL(`/telegram-return?status=${status}`, config.WEB_BASE_URL).toString(),
    );
  }

  // Telegram Mini App → VK ID in the external browser. Called by the Mini
  // App itself (same-origin POST from its WebView): creates a handoff,
  // keeps its claim secret in this WebView's httpOnly cookie and returns
  // the URL the Mini App opens with Telegram.WebApp.openLink. Each tap
  // makes a new handoff (the cookie is replaced, the old one just expires).
  app.post(
    '/auth/vk/handoff',
    { config: { rateLimit: { max: 20, timeWindow: '10 minutes' } } },
    async (_request, reply) => {
      if (!isVkConfigured(config)) {
        return reply.code(503).send({ error: 'vk_not_configured' });
      }
      const { claimToken, startToken } = await handoff.createHandoff(db);
      reply.setCookie(HANDOFF_COOKIE, claimToken, {
        ...baseCookieOptions(config),
        path: HANDOFF_COOKIE_PATH,
        maxAge: handoff.HANDOFF_TTL_MS / 1000,
      });
      const startUrl = new URL('/api/v1/auth/vk/start', config.WEB_BASE_URL);
      startUrl.searchParams.set('handoff', startToken);
      return reply.code(200).send({ startUrl: startUrl.toString() });
    },
  );

  // The Mini App asks whether its VK sign-in finished (polled while it
  // waits, and again whenever it comes back into view). Only the holder
  // of the claim cookie can collect the session, exactly once.
  app.post(
    '/auth/vk/handoff/claim',
    { config: { rateLimit: { max: 400, timeWindow: '10 minutes' } } },
    async (request, reply) => {
      const claimToken = request.cookies[HANDOFF_COOKIE];
      if (!claimToken) return reply.code(200).send({ status: 'expired' });
      const result = await handoff.claimHandoff(db, claimToken);
      if (result.status === 'pending') {
        return reply.code(200).send({ status: 'pending', started: result.started });
      }
      reply.clearCookie(HANDOFF_COOKIE, {
        ...baseCookieOptions(config),
        path: HANDOFF_COOKIE_PATH,
      });
      if (result.status !== 'ok') return reply.code(200).send({ status: result.status });
      const login = await service.openSessionFor(db, result.userId);
      await dropPreviousSession(request, login.sessionId);
      // The account itself was registered (if new) in the external browser's
      // VK callback; here the Mini App's own visitor is linked to it.
      await recordSignIn(db, request, { userId: result.userId, created: false, method: 'vk' });
      reply.setCookie(
        SESSION_COOKIE,
        login.sessionId,
        cookieOptions(config, SESSION_MAX_AGE_SECONDS),
      );
      return reply.code(200).send({ status: 'ok', user: login.user });
    },
  );

  // `?link=1` starts the flow from a signed-in profile to ADD VK to that
  // account. The target account is taken from the SESSION, never from the
  // URL, and is stored in the same short-lived httpOnly cookie as the PKCE
  // state so the callback can check it is still the same account.
  app.get('/auth/vk/start', async (request, reply) => {
    if (!isVkConfigured(config)) {
      return reply.code(503).send({ error: 'vk_not_configured' });
    }
    const linking = (request.query as { link?: string } | undefined)?.link === '1';
    if (linking && !request.sessionUserId) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    // A sign-in for the Telegram Mini App, opened in the external browser:
    // the one-time start token must match a fresh, never-used handoff.
    let handoffId: string | undefined;
    const handoffQuery = handoffStartQuerySchema.safeParse(request.query);
    if (!linking && handoffQuery.success) {
      const id = await handoff.startHandoff(db, handoffQuery.data.handoff);
      if (!id) return toTelegramReturn(reply, 'expired');
      handoffId = id;
    }
    const challenge = createVkPkceChallenge();
    reply.setCookie(
      VK_PKCE_COOKIE,
      JSON.stringify({
        state: challenge.state,
        codeVerifier: challenge.codeVerifier,
        ...(linking ? { link: { userId: request.sessionUserId } } : {}),
        ...(handoffId ? { handoff: handoffId } : {}),
      }),
      cookieOptions(config, 600),
    );
    return reply.redirect(buildVkAuthorizeUrl(config, challenge));
  });

  app.get('/auth/vk/callback', async (request, reply) => {
    const query = vkCallbackQuerySchema.safeParse(request.query);
    const rawCookie = request.cookies[VK_PKCE_COOKIE];
    // The temporary PKCE state is single-use: expire it on every
    // callback, whatever the outcome below (same attributes it was set with).
    reply.clearCookie(VK_PKCE_COOKIE, baseCookieOptions(config));
    // The user backed out of (or denied) the VK consent screen: VK returns
    // `?error=…` with no `code`. Nothing is signed in and nothing is read
    // from the request, so send the browser back to the sign-in page (or the
    // profile, when it was an "add VK" attempt) with a fixed, server-chosen
    // path instead of leaving it on a raw JSON error.
    if (!query.success && typeof (request.query as { error?: unknown })?.error === 'string') {
      const early = rawCookie ? parseVkPkceCookie(rawCookie) : undefined;
      if (early?.success && early.data.handoff) {
        await handoff.finishHandoff(db, early.data.handoff, { status: 'cancelled' });
        return toTelegramReturn(reply, 'cancelled');
      }
      const target =
        early?.success && early.data.link
          ? '/profile?link=error&provider=vk'
          : '/login?vk=cancelled';
      return reply.redirect(new URL(target, config.WEB_BASE_URL).toString());
    }
    if (!query.success || !rawCookie) {
      return reply.code(400).send({ error: 'invalid_callback' });
    }
    const saved = parseVkPkceCookie(rawCookie);
    // CSRF check: the `state` VK echoes back must match the one this
    // server generated and stored server-side (in the httpOnly
    // cookie) for this exact login attempt, not just be present.
    if (!saved.success || saved.data.state !== query.data.state) {
      return reply.code(400).send({ error: 'invalid_state' });
    }
    const handoffId = saved.data.handoff;
    if (saved.data.link) {
      const toProfile = (outcome: string) =>
        reply.redirect(
          new URL(`/profile?link=${outcome}&provider=vk`, config.WEB_BASE_URL).toString(),
        );
      // The account being linked must still be the one signed in now.
      if (!request.sessionUserId || request.sessionUserId !== saved.data.link.userId) {
        return toProfile('session_changed');
      }
      try {
        const outcome = await service.completeVkLink(
          db,
          config,
          request.sessionUserId,
          query.data.code,
          query.data.device_id,
          saved.data.codeVerifier,
          request.log,
        );
        const labels = {
          linked: 'ok',
          already_linked: 'already',
          taken: 'taken',
          provider_already_used: 'provider_used',
        } as const;
        return toProfile(labels[outcome]);
      } catch (error) {
        if (error instanceof service.VkRequestError) {
          request.log.error(
            { vkLink: error.kind, status: error.status, vkError: error.vkError },
            'VK link failed',
          );
        } else if (!(error instanceof service.VkNotConfiguredError)) {
          request.log.error({ err: error }, 'VK link failed');
        }
        return toProfile('error');
      }
    }
    try {
      const { sessionId, user, created } = await service.completeVkLogin(
        db,
        config,
        query.data.code,
        query.data.device_id,
        saved.data.codeVerifier,
        request.log,
      );
      await recordSignIn(db, request, { userId: user.id, created, method: 'vk' });
      // A sign-in for the Telegram Mini App: the account goes to the Mini
      // App (it claims its OWN session — see handoff.ts); this external
      // browser keeps no session of its own (it was only borrowed for VK
      // ID), and is told how to get back to Telegram.
      if (handoffId) {
        await service.logout(db, sessionId);
        const handed = await handoff.finishHandoff(db, handoffId, {
          status: 'completed',
          userId: user.id,
        });
        return toTelegramReturn(reply, handed ? 'ok' : 'expired');
      }
      await dropPreviousSession(request, sessionId);
      reply.setCookie(SESSION_COOKIE, sessionId, cookieOptions(config, SESSION_MAX_AGE_SECONDS));
      // Server-decided landing: an account whose saved learning profile
      // is not complete (brand-new, or an earlier onboarding left
      // unfinished) goes straight to onboarding; everyone else to the
      // main menu. Not a query parameter the browser could forge — the
      // client re-derives the same answer from /auth/me.
      const landing = user.onboardingCompleted
        ? config.WEB_BASE_URL
        : new URL('/onboarding', config.WEB_BASE_URL).toString();
      return reply.redirect(landing);
    } catch (error) {
      if (handoffId) {
        await handoff.finishHandoff(db, handoffId, { status: 'failed' });
        if (error instanceof service.VkRequestError) {
          request.log.error(
            { vkLogin: error.kind, status: error.status, vkError: error.vkError, handoff: true },
            'VK login failed',
          );
        } else if (!(error instanceof service.VkNotConfiguredError)) {
          request.log.error({ err: error, handoff: true }, 'VK login failed');
        }
        return toTelegramReturn(reply, 'error');
      }
      if (error instanceof service.VkNotConfiguredError) {
        return reply.code(503).send({ error: 'vk_not_configured' });
      }
      if (error instanceof service.VkRequestError) {
        // Only the coarse kind / HTTP status / VK error code — never the
        // request (code, verifier, secret) or VK's response body.
        request.log.error(
          { vkLogin: error.kind, status: error.status, vkError: error.vkError },
          'VK login failed',
        );
        return reply
          .code(error.kind === 'timeout' ? 504 : 502)
          .send({ error: error.kind === 'timeout' ? 'vk_timeout' : 'vk_login_failed' });
      }
      request.log.error({ err: error }, 'VK login failed');
      return reply.code(502).send({ error: 'vk_login_failed' });
    }
  });

  // Telegram Mini App sign-in / first-launch registration. The browser sends
  // the raw `initData`; everything is decided from its verified signature.
  app.post(
    '/auth/telegram',
    { config: { rateLimit: { max: 30, timeWindow: '10 minutes' } } },
    async (request, reply) => {
      const body = telegramInitDataRequestSchema.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: 'invalid_body' });
      try {
        const result = await service.completeTelegramLogin(db, config, body.data.initData, {
          currentUserId: request.sessionUserId,
          log: request.log,
        });
        await dropPreviousSession(request, result.sessionId);
        await recordSignIn(db, request, {
          userId: result.user.id,
          created: result.created,
          method: 'telegram',
        });
        reply.setCookie(
          SESSION_COOKIE,
          result.sessionId,
          cookieOptions(config, SESSION_MAX_AGE_SECONDS),
        );
        return reply.code(200).send({ user: result.user, created: result.created });
      } catch (error) {
        if (error instanceof service.TelegramNotConfiguredError) {
          request.log.error(
            { tgAuth: 'not_configured' },
            'Telegram sign-in requested but TELEGRAM_BOT_TOKEN is not set in the API container',
          );
          return reply.code(503).send({ error: 'telegram_not_configured' });
        }
        if (error instanceof service.TelegramAuthError) {
          request.log.warn(
            { tgAuth: error.reason, ...error.diagnostics },
            'Telegram sign-in rejected',
          );
          return reply.code(401).send({
            error: error.reason === 'expired' ? 'telegram_data_expired' : 'invalid_telegram_data',
          });
        }
        if (error instanceof service.TelegramNotLinkedError) {
          return reply.code(409).send({ error: 'telegram_not_linked' });
        }
        throw error;
      }
    },
  );

  app.get('/auth/me', async (request, reply) => {
    const sessionId = request.cookies[SESSION_COOKIE];
    if (!sessionId) return reply.code(200).send({ user: null });
    const user = await service.getCurrentUser(db, sessionId);
    // A cookie that no longer maps to a live session (expired, revoked,
    // deleted) is dropped so the browser stops sending it.
    if (!user) clearSessionCookie(reply, config);
    // Only tells THIS signed-in user whether they are the owner, so the app
    // can show its «Админ-панель» link. Purely a UI hint: every admin
    // endpoint checks the same server-side list again on its own.
    // Present only when true, so everyone else's response is unchanged.
    const isOwner = user !== null && isAdminUser(config.ADMIN_OWNER_USER_IDS, user.id);
    return reply.code(200).send(isOwner ? { user, isOwner } : { user });
  });

  app.post('/auth/logout', async (request, reply) => {
    const sessionId = request.cookies[SESSION_COOKIE];
    if (sessionId) await service.logout(db, sessionId);
    clearSessionCookie(reply, config);
    return reply.code(204).send();
  });
};
