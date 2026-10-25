import {
  confirmTelegramLink,
  createTelegramLinkToken,
  pendingTelegramLink,
  schema,
  telegramReachability,
  type Database,
} from '@zybrilka/db';
import {
  minutesOfTime,
  REMINDER_DEFAULT_TIME,
  REMINDER_DEFAULT_TIMEZONE,
  reminderSettingsRequestSchema,
  telegramLinkConfirmRequestSchema,
  timeOfMinutes,
  type ReminderSettingsResponse,
} from '@zybrilka/shared';
import { eq } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';

export interface ReminderRoutesOptions {
  db: Database;
}

/**
 * Daily Telegram reminders — the site side (docs/REMINDERS.md). Registered
 * behind `requireSession`; every handler acts on `request.sessionUserId`
 * only, so nobody can read or change another account's settings. Sending
 * is the worker's job (apps/worker reminders).
 */
export const reminderRoutes: FastifyPluginAsync<ReminderRoutesOptions> = async (app, { db }) => {
  const userId = (request: { sessionUserId: string | null }) => request.sessionUserId!;
  // Throttled per account, not per IP: a whole school behind one address
  // must not use up each other's limit.
  const perAccount = (max: number, timeWindow: string) => ({
    rateLimit: { max, timeWindow, keyGenerator: (request: FastifyRequest) => userId(request) },
  });

  async function load(id: string): Promise<ReminderSettingsResponse> {
    const [row] = await db
      .select()
      .from(schema.reminderSettings)
      .where(eq(schema.reminderSettings.userId, id));
    const reach = await telegramReachability(db, id);
    const pending = reach.telegramId === null ? await pendingTelegramLink(db, id) : null;
    return {
      enabled: row?.enabled ?? false,
      time: row ? timeOfMinutes(row.minuteOfDay) : REMINDER_DEFAULT_TIME,
      timezone: row?.timezone ?? REMINDER_DEFAULT_TIMEZONE,
      telegram: {
        linked: reach.telegramId !== null,
        botStarted: reach.botStarted,
        blocked: reach.blocked,
        pendingLink: pending ? { name: pending.telegramName } : null,
      },
    };
  }

  app.get('/me/reminders', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    return load(userId(request));
  });

  app.put('/me/reminders', { config: perAccount(30, '1 minute') }, async (request, reply) => {
    const body = reminderSettingsRequestSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_body' });
    const minuteOfDay = minutesOfTime(body.data.time)!;
    const now = new Date();
    await db
      .insert(schema.reminderSettings)
      .values({
        userId: userId(request),
        enabled: body.data.enabled,
        minuteOfDay,
        timezone: body.data.timezone,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: schema.reminderSettings.userId,
        set: {
          enabled: body.data.enabled,
          minuteOfDay,
          timezone: body.data.timezone,
          updatedAt: now,
        },
      });
    reply.header('cache-control', 'no-store');
    return load(userId(request));
  });

  // A one-time link for the bot: `t.me/<bot>?start=link_<token>`. Opening it
  // in Telegram and confirming there only CLAIMS the link; nothing is
  // attached until this account confirms below (docs/REMINDERS.md).
  app.post(
    '/me/telegram/link',
    { config: perAccount(10, '10 minutes') },
    async (request, reply) => {
      const { token, expiresAt } = await createTelegramLinkToken(db, userId(request));
      reply.header('cache-control', 'no-store');
      return { token, expiresAt: expiresAt.toISOString() };
    },
  );

  // Step 3: the signed-in owner confirms (or refuses) the Telegram account
  // that claimed this account's link. Acts on the session's account only.
  app.post(
    '/me/telegram/link/confirm',
    { config: perAccount(10, '10 minutes') },
    async (request, reply) => {
      const body = telegramLinkConfirmRequestSchema.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: 'invalid_body' });
      const { status } = await confirmTelegramLink(db, userId(request), body.data.accept);
      reply.header('cache-control', 'no-store');
      return { status, settings: await load(userId(request)) };
    },
  );
};
