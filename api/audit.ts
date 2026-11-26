import { getDb } from "./queries/connection";
import { auditEvents } from "@db/schema";

type Db = ReturnType<typeof getDb>;

/**
 * Append one row to the audit log. Fire-and-forget by design: callers
 * `void logEvent(...)` after the business write succeeds so an audit
 * failure can never break a sale.
 */
export async function logEvent(
  db: Db,
  event: {
    actor?: { sub: number; name: string } | null;
    action: string;
    entityType: string;
    entityId?: number | null;
    detail?: string;
  },
): Promise<void> {
  try {
    await db.insert(auditEvents).values({
      actorId: event.actor?.sub ?? null,
      actorName: event.actor?.name ?? null,
      action: event.action,
      entityType: event.entityType,
      entityId: event.entityId ?? null,
      detail: event.detail?.slice(0, 500) ?? null,
    });
  } catch (err) {
    console.error("[audit] failed to log", event.action, err);
  }
}
