import { schema } from '@zybrilka/db';
import type { Database } from '@zybrilka/db';

export interface AuditEntry {
  actorUserId: string | null;
  action: string;
  objectType?: string;
  objectId?: string;
  result: 'ok' | 'denied' | 'error';
  /** Small, safe context only — never a secret, token or full record. */
  details?: Record<string, unknown>;
}

/** Appends one row to the (database-enforced) append-only audit log. */
export async function writeAudit(db: Pick<Database, 'insert'>, entry: AuditEntry) {
  await db.insert(schema.adminAuditLog).values({
    actorUserId: entry.actorUserId,
    action: entry.action,
    objectType: entry.objectType ?? null,
    objectId: entry.objectId ?? null,
    result: entry.result,
    details: entry.details ?? null,
  });
}
