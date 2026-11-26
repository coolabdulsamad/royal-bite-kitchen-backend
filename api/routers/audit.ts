import { z } from "zod";
import { and, desc, eq, gte, like, lt, or, sql } from "drizzle-orm";
import { createRouter } from "../middleware";
import { roleProcedure } from "../auth/guards";
import { getDb } from "../queries/connection";
import { auditEvents } from "@db/schema";

/** Known actions, grouped for the filter dropdown. */
export const AUDIT_ACTIONS = [
  "sale.complete",
  "sale.return",
  "expense.create",
  "expense.void",
  "drawer.count",
  "stock.create",
  "stock.update",
  "stock.move",
  "stock.adjust",
  "customer.create",
  "customer.update",
  "customer.repay",
  "terminal.create",
  "terminal.update",
  "staff.create",
  "menu.item",
  "menu.category",
  "partner.create",
  "partner.update",
] as const;

/**
 * Audit trail — manager+ only. Every sensitive mutation in the system
 * appends a row here: who did what, to which record, and a human summary.
 */
export const auditRouter = createRouter({
  list: roleProcedure("manager")
    .input(
      z
        .object({
          action: z.string().max(64).optional(),
          staffId: z.number().int().positive().optional(),
          search: z.string().trim().max(120).optional(),
          from: z.coerce.date().optional(),
          to: z.coerce.date().optional(),
          page: z.number().int().min(1).default(1),
          pageSize: z.number().int().min(1).max(100).default(30),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      const db = getDb();
      const conditions = [];
      if (input?.action) conditions.push(eq(auditEvents.action, input.action));
      if (input?.staffId) conditions.push(eq(auditEvents.actorId, input.staffId));
      if (input?.search) {
        const q = `%${input.search}%`;
        conditions.push(or(like(auditEvents.detail, q), like(auditEvents.actorName, q)));
      }
      if (input?.from) {
        const f = new Date(input.from);
        f.setHours(0, 0, 0, 0);
        conditions.push(gte(auditEvents.createdAt, f));
      }
      if (input?.to) {
        const t = new Date(input.to);
        t.setHours(0, 0, 0, 0);
        t.setDate(t.getDate() + 1);
        conditions.push(lt(auditEvents.createdAt, t));
      }
      const where = conditions.length ? and(...conditions) : undefined;
      const page = input?.page ?? 1;
      const pageSize = input?.pageSize ?? 30;

      const rows = await db
        .select()
        .from(auditEvents)
        .where(where)
        .orderBy(desc(auditEvents.id))
        .limit(pageSize)
        .offset((page - 1) * pageSize);
      const [countRow] = await db
        .select({ n: sql<number>`count(*)` })
        .from(auditEvents)
        .where(where);

      return {
        total: Number(countRow?.n ?? 0),
        page,
        pageSize,
        actions: AUDIT_ACTIONS,
        events: rows.map((r) => ({
          id: r.id,
          action: r.action,
          entityType: r.entityType,
          entityId: r.entityId,
          detail: r.detail,
          actorName: r.actorName ?? "System",
          at: r.createdAt.toISOString(),
        })),
      };
    }),
});
