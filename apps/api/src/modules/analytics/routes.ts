import { schema } from '@zybrilka/db';
import type { Database } from '@zybrilka/db';
import { eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { Config } from '../../config.js';
import { isAllowedCampaignTarget, SLUG_RE } from './campaignLinks.js';
import {
  analyticsConsented,
  clientEventTypes,
  ensureVisitor,
  isLinkPreviewBot,
  recordEvent,
  safely,
  touchCampaign,
  VISITOR_COOKIE,
} from './recorder.js';

export interface AnalyticsRoutesOptions {
  db: Database;
  config: Config;
}

const eventsBodySchema = z.object({
  client: z.enum(['web', 'telegram']).optional(),
  /** Telegram `start_param` of this launch, when the Mini App was opened
   * from a campaign link (`t.me/<bot>?startapp=<slug>`). */
  campaign: z.string().regex(SLUG_RE).optional(),
  events: z
    .array(
      z.object({
        /** Client-generated random id — makes a retried batch idempotent. */
        id: z.uuid(),
        type: z.enum(clientEventTypes),
        subjectId: z
          .string()
          .regex(/^[a-z_]{1,32}$/)
          .optional(),
        taskId: z.uuid().optional(),
      }),
    )
    .min(1)
    .max(20),
});

/**
 * Public analytics endpoints (rate limited per IP, no personal data):
 * - POST /events — product events from the web app / Mini App;
 * - GET /go/:slug — a campaign's tracked link: counts the click and
 *   redirects to the campaign's own page on this site.
 */
export const analyticsRoutes: FastifyPluginAsync<AnalyticsRoutesOptions> = async (
  app,
  { db, config },
) => {
  async function activeCampaign(slug: string) {
    const [row] = await db
      .select({
        id: schema.campaigns.id,
        status: schema.campaigns.status,
        targetPath: schema.campaigns.targetPath,
      })
      .from(schema.campaigns)
      .where(eq(schema.campaigns.slug, slug))
      .limit(1);
    return row?.status === 'active' ? row : null;
  }

  app.post(
    '/events',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const body = eventsBodySchema.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: 'invalid_body' });
      // No analytics consent: nothing is recorded and no cookie is set.
      if (!analyticsConsented(request)) return reply.code(204).send();
      await safely(request, async () => {
        const visitor = await ensureVisitor(db, config, request, reply, body.data.client ?? null);
        const userId = request.sessionUserId ?? null;
        let campaignId: string | null = null;
        if (body.data.campaign) {
          const campaign = await activeCampaign(body.data.campaign);
          if (campaign) {
            campaignId = campaign.id;
            await touchCampaign(db, visitor.id, campaign.id);
            const launch = body.data.events.find((e) => e.type === 'visit');
            await recordEvent(db, {
              type: 'campaign_click',
              visitorId: visitor.id,
              userId,
              campaignId,
              props: { via: 'telegram' },
              dedupKey: launch ? `click:${launch.id}` : null,
            });
          }
        }
        for (const event of body.data.events) {
          await recordEvent(db, {
            type: event.type,
            visitorId: visitor.id,
            userId,
            subjectId: event.subjectId ?? null,
            taskId: event.taskId ?? null,
            campaignId: event.type === 'visit' ? campaignId : null,
            props: { guest: userId === null, client: body.data.client ?? 'web' },
            dedupKey: `client:${event.id}`,
          });
        }
      });
      return reply.code(204).send();
    },
  );

  // The banner's «Отклонить необязательные»: drop the visitor cookie the
  // page itself cannot touch (httpOnly). Recorded history stays anonymous.
  app.delete('/events/visitor', async (_request, reply) => {
    reply.clearCookie(VISITOR_COOKIE, { path: '/' });
    return reply.code(204).send();
  });

  app.get(
    '/go/:slug',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const home = new URL('/', config.WEB_BASE_URL).toString();
      const slug = (request.params as { slug?: string }).slug ?? '';
      // Unknown, malformed, disabled or archived: just the home page, and
      // nothing is counted.
      if (!SLUG_RE.test(slug)) return reply.redirect(home);
      const campaign = await activeCampaign(slug);
      if (!campaign || !isAllowedCampaignTarget(campaign.targetPath)) return reply.redirect(home);
      if (!isLinkPreviewBot(request.headers['user-agent'])) {
        await safely(request, async () => {
          if (!analyticsConsented(request)) {
            // Counted, but anonymously: no visitor, no cookie, so this click
            // cannot attribute a later registration.
            await recordEvent(db, {
              type: 'campaign_click',
              userId: request.sessionUserId ?? null,
              campaignId: campaign.id,
              props: { via: 'link' },
            });
            return;
          }
          const visitor = await ensureVisitor(db, config, request, reply, 'web');
          await touchCampaign(db, visitor.id, campaign.id);
          await recordEvent(db, {
            type: 'campaign_click',
            visitorId: visitor.id,
            userId: request.sessionUserId ?? null,
            campaignId: campaign.id,
            props: { via: 'link' },
          });
        });
      }
      return reply.redirect(new URL(campaign.targetPath, config.WEB_BASE_URL).toString());
    },
  );
};
