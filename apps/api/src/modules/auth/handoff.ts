import { createHash, randomBytes } from 'node:crypto';
import { schema } from '@zybrilka/db';
import type { Database } from '@zybrilka/db';
import { and, eq, gt } from 'drizzle-orm';

/**
 * One-time sign-in handoff: VK ID started from the Telegram Mini App runs
 * in the device's external browser (Telegram's WebView can't host it and
 * shares no cookies with Safari/Chrome), and the account it signs in is
 * then handed back to the Mini App — see `schema.authHandoffs`.
 *
 * Two independent random secrets per handoff, only their SHA-256 hashes
 * stored:
 * - the CLAIM token stays in the Mini App's own httpOnly cookie and is
 *   the only thing that can turn a completed handoff into a session;
 * - the START token travels to the external browser in the start URL. It
 *   can only be used once, only to begin VK for this handoff, and gives
 *   the browser nothing by itself.
 * Every state change is a single conditional UPDATE, so a token can't be
 * replayed or raced into a second use.
 */
export const HANDOFF_TTL_MS = 10 * 60 * 1000;

export type HandoffStatus =
  'pending' | 'started' | 'completed' | 'cancelled' | 'failed' | 'consumed';

const hash = (token: string) => createHash('sha256').update(token).digest('hex');
const newToken = () => randomBytes(32).toString('base64url');

export async function createHandoff(db: Database) {
  const claimToken = newToken();
  const startToken = newToken();
  await db.insert(schema.authHandoffs).values({
    claimTokenHash: hash(claimToken),
    startTokenHash: hash(startToken),
    expiresAt: new Date(Date.now() + HANDOFF_TTL_MS),
  });
  return { claimToken, startToken };
}

/** The external browser opened the start URL: pending → started, once. */
export async function startHandoff(db: Database, startToken: string): Promise<string | null> {
  const [row] = await db
    .update(schema.authHandoffs)
    .set({ status: 'started' })
    .where(
      and(
        eq(schema.authHandoffs.startTokenHash, hash(startToken)),
        eq(schema.authHandoffs.status, 'pending'),
        gt(schema.authHandoffs.expiresAt, new Date()),
      ),
    )
    .returning({ id: schema.authHandoffs.id });
  return row?.id ?? null;
}

/** The VK callback's outcome for a started handoff. */
export async function finishHandoff(
  db: Database,
  id: string,
  outcome: { status: 'completed'; userId: string } | { status: 'cancelled' | 'failed' },
): Promise<boolean> {
  const rows = await db
    .update(schema.authHandoffs)
    .set(
      outcome.status === 'completed'
        ? { status: 'completed', userId: outcome.userId }
        : { status: outcome.status },
    )
    .where(
      and(
        eq(schema.authHandoffs.id, id),
        eq(schema.authHandoffs.status, 'started'),
        gt(schema.authHandoffs.expiresAt, new Date()),
      ),
    )
    .returning({ id: schema.authHandoffs.id });
  return rows.length > 0;
}

export type ClaimResult =
  { status: 'ok'; userId: string } | { status: 'pending' | 'cancelled' | 'failed' | 'expired' };

/** The Mini App asks how its handoff went; a completed one is consumed
 * here exactly once (completed → consumed) and yields the user id. */
export async function claimHandoff(db: Database, claimToken: string): Promise<ClaimResult> {
  const [row] = await db
    .select()
    .from(schema.authHandoffs)
    .where(eq(schema.authHandoffs.claimTokenHash, hash(claimToken)))
    .limit(1);
  if (!row || row.expiresAt.getTime() <= Date.now()) return { status: 'expired' };
  const status = row.status as HandoffStatus;
  if (status === 'pending' || status === 'started') return { status: 'pending' };
  if (status === 'cancelled' || status === 'failed') return { status };
  if (status !== 'completed' || !row.userId) return { status: 'expired' };

  const [consumed] = await db
    .update(schema.authHandoffs)
    .set({ status: 'consumed' })
    .where(and(eq(schema.authHandoffs.id, row.id), eq(schema.authHandoffs.status, 'completed')))
    .returning({ userId: schema.authHandoffs.userId });
  return consumed?.userId ? { status: 'ok', userId: consumed.userId } : { status: 'expired' };
}
