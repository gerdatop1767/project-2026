import { schema } from '@zybrilka/db';
import type { Database } from '@zybrilka/db';
import { eq, sql } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Config } from '../../config.js';

/**
 * First-party, privacy-minimal product analytics (docs/ADMIN.md §События).
 *
 * A visitor is a random id in the httpOnly `zv` cookie — one browser or one
 * Telegram WebView, not a person. Nothing else identifies it: no IP, no
 * user agent, no fingerprint is stored. Recording never fails the request it
 * rides on: analytics errors are logged and swallowed.
 */
export const VISITOR_COOKIE = 'zv';
const VISITOR_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;
/** A campaign touch older than this is not used to attribute a registration. */
export const ATTRIBUTION_WINDOW_DAYS = 30;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const serverEventTypes = [
  'answer_checked',
  'registration_completed',
  'login_completed',
  'campaign_click',
  'complaint_submitted',
] as const;
export const clientEventTypes = [
  'visit',
  'subject_selected',
  'task_started',
  'training_completed',
] as const;
export type EventType = (typeof serverEventTypes)[number] | (typeof clientEventTypes)[number];

export interface EventInput {
  type: EventType;
  visitorId?: string | null;
  userId?: string | null;
  subjectId?: string | null;
  taskId?: string | null;
  campaignId?: string | null;
  props?: Record<string, string | number | boolean>;
  dedupKey?: string | null;
  occurredAt?: Date;
}

/** The visitor id from the cookie, if it is at least a well-formed uuid. */
export function readVisitorId(request: FastifyRequest): string | null {
  const raw = request.cookies?.[VISITOR_COOKIE];
  return raw && UUID_RE.test(raw) ? raw.toLowerCase() : null;
}

/**
 * The request's visitor row: the cookie's if that row exists, otherwise a
 * new one (and a fresh cookie). A forged or stale cookie value simply gets
 * replaced — it can never attach to someone else's history it didn't have.
 */
export async function ensureVisitor(
  db: Database,
  config: Config,
  request: FastifyRequest,
  reply: FastifyReply,
  client: 'web' | 'telegram' | null,
): Promise<{ id: string; campaignId: string | null; campaignTouchedAt: Date | null }> {
  const cookieId = readVisitorId(request);
  if (cookieId) {
    const [row] = await db
      .update(schema.analyticsVisitors)
      .set({ lastSeenAt: new Date() })
      .where(eq(schema.analyticsVisitors.id, cookieId))
      .returning({
        id: schema.analyticsVisitors.id,
        campaignId: schema.analyticsVisitors.campaignId,
        campaignTouchedAt: schema.analyticsVisitors.campaignTouchedAt,
      });
    if (row) return row;
  }
  const [created] = await db
    .insert(schema.analyticsVisitors)
    .values({ client, userId: request.sessionUserId ?? null })
    .returning({
      id: schema.analyticsVisitors.id,
      campaignId: schema.analyticsVisitors.campaignId,
      campaignTouchedAt: schema.analyticsVisitors.campaignTouchedAt,
    });
  reply.setCookie(VISITOR_COOKIE, created!.id, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.NODE_ENV === 'production',
    path: '/',
    maxAge: VISITOR_MAX_AGE_SECONDS,
  });
  return created!;
}

/** Inserts one event; a repeated `dedupKey` is silently ignored (idempotent). */
export async function recordEvent(db: Database, event: EventInput): Promise<void> {
  await db
    .insert(schema.analyticsEvents)
    .values({
      type: event.type,
      visitorId: event.visitorId ?? null,
      userId: event.userId ?? null,
      subjectId: event.subjectId ?? null,
      taskId: event.taskId ?? null,
      campaignId: event.campaignId ?? null,
      props: event.props ?? null,
      dedupKey: event.dedupKey ?? null,
      ...(event.occurredAt ? { occurredAt: event.occurredAt } : {}),
    })
    .onConflictDoNothing({ target: schema.analyticsEvents.dedupKey });
}

/** Never lets an analytics failure break the request it rides on. */
export async function safely(request: FastifyRequest, work: () => Promise<void>) {
  try {
    await work();
  } catch (err) {
    request.log.error({ err }, 'analytics recording failed');
  }
}

/**
 * A successful sign-in. Records `registration_completed` (a new account) or
 * `login_completed`, links this browser's visitor to the account, and — for
 * a new account only — writes its attribution: the visitor's first-touch
 * campaign if it is within the window, else no campaign (unknown/direct).
 */
export async function recordSignIn(
  db: Database,
  request: FastifyRequest,
  sign: { userId: string; created: boolean; method: 'email' | 'vk' | 'telegram' },
): Promise<void> {
  await safely(request, async () => {
    const visitorId = readVisitorId(request);
    let visitor: { campaignId: string | null; campaignTouchedAt: Date | null } | undefined;
    if (visitorId) {
      [visitor] = await db
        .update(schema.analyticsVisitors)
        .set({ userId: sign.userId, lastSeenAt: new Date() })
        .where(eq(schema.analyticsVisitors.id, visitorId))
        .returning({
          campaignId: schema.analyticsVisitors.campaignId,
          campaignTouchedAt: schema.analyticsVisitors.campaignTouchedAt,
        });
    }
    const knownVisitor = visitor ? visitorId : null;
    await recordEvent(db, {
      type: sign.created ? 'registration_completed' : 'login_completed',
      userId: sign.userId,
      visitorId: knownVisitor,
      props: { method: sign.method },
      dedupKey: sign.created ? `registration:${sign.userId}` : null,
    });
    if (!sign.created) return;
    const windowStart = Date.now() - ATTRIBUTION_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    const campaignId =
      visitor?.campaignId &&
      visitor.campaignTouchedAt &&
      visitor.campaignTouchedAt.getTime() >= windowStart
        ? visitor.campaignId
        : null;
    await db
      .insert(schema.userAttributions)
      .values({ userId: sign.userId, visitorId: knownVisitor, campaignId, method: sign.method })
      .onConflictDoNothing();
  });
}

/** Link-preview crawlers (Telegram, VK, …) fetch a shared link without a
 * person behind it; their requests are not counted as clicks. The user
 * agent is only inspected here, never stored. */
export function isLinkPreviewBot(userAgent: string | undefined): boolean {
  if (!userAgent) return true;
  return /bot|crawl|spider|preview|vkShare|facebookexternalhit|Slackbot|WhatsApp|Discordbot|curl|wget|python-requests/i.test(
    userAgent,
  );
}

/** Sets the visitor's first-touch campaign (or replaces one older than the window). */
export async function touchCampaign(db: Database, visitorId: string, campaignId: string) {
  await db
    .update(schema.analyticsVisitors)
    .set({ campaignId, campaignTouchedAt: new Date() })
    .where(
      sql`${schema.analyticsVisitors.id} = ${visitorId} AND (${schema.analyticsVisitors.campaignId} IS NULL OR ${schema.analyticsVisitors.campaignTouchedAt} < now() - make_interval(days => ${ATTRIBUTION_WINDOW_DAYS}))`,
    );
}
