import { desc, eq, gte, inArray } from "drizzle-orm";
import { createRouter } from "../middleware";
import { authedProcedure } from "../auth/guards";
import { getDb } from "../queries/connection";
import { expenses, orderItems, orders, users } from "@db/schema";
import { roleHas } from "../permissions";
import type { StaffRole } from "@contracts/roles";

/**
 * Notification feed — one cheap poll for every open screen. Each section is
 * gated by the caller's own permissions instead of the whole feed 403ing, so
 * a cashier gets orders, an approver gets the expense queue, and nobody sees
 * what their role shouldn't. The client diffs consecutive feeds by id to pop
 * toasts + play the new-order chime.
 */
export const notificationsRouter = createRouter({
  feed: authedProcedure.query(async ({ ctx }) => {
    const db = getDb();
    const [canOrders, canApprovals] = await Promise.all([
      roleHas(db, ctx.staff.role as StaffRole, "orders", "view"),
      roleHas(db, ctx.staff.role as StaffRole, "expenseApprovals", "manage"),
    ]);

    // New-order radar: the last two hours is plenty for "just came in".
    const since = new Date(Date.now() - 2 * 60 * 60 * 1000);

    const orderRows = canOrders
      ? await db
          .select({
            id: orders.id,
            orderNo: orders.orderNo,
            status: orders.status,
            label: orders.label,
            source: orders.source,
            totalKobo: orders.totalKobo,
            staffId: orders.staffId,
            staffName: users.name,
            createdAt: orders.createdAt,
          })
          .from(orders)
          .leftJoin(users, eq(users.id, orders.staffId))
          .where(gte(orders.createdAt, since))
          .orderBy(desc(orders.id))
          .limit(30)
      : [];

    const ids = orderRows.map((r) => r.id);
    const lines = ids.length
      ? await db
          .select({
            orderId: orderItems.orderId,
            itemName: orderItems.itemName,
            quantity: orderItems.quantity,
          })
          .from(orderItems)
          .where(inArray(orderItems.orderId, ids))
      : [];

    const pendingRows = canApprovals
      ? await db
          .select({
            id: expenses.id,
            note: expenses.note,
            category: expenses.category,
            amountKobo: expenses.amountKobo,
            staffName: users.name,
            expenseAt: expenses.expenseAt,
          })
          .from(expenses)
          .leftJoin(users, eq(users.id, expenses.staffId))
          .where(eq(expenses.status, "pending"))
          .orderBy(desc(expenses.id))
          .limit(20)
      : [];

    return {
      now: new Date().toISOString(),
      orders: orderRows.map((r) => {
        const own = lines.filter((l) => l.orderId === r.id);
        return {
          orderId: r.id,
          orderNo: r.orderNo,
          status: r.status,
          label: r.label,
          source: r.source,
          totalKobo: r.totalKobo,
          staffId: r.staffId,
          staffName: r.staffName ?? null,
          createdAt: r.createdAt.toISOString(),
          itemCount: own.reduce((n, l) => n + l.quantity, 0),
          itemsPreview: own.slice(0, 2).map((l) => l.itemName),
        };
      }),
      pendingExpenses: pendingRows.map((r) => ({
        expenseId: r.id,
        note: r.note,
        category: r.category,
        amountKobo: r.amountKobo,
        staffName: r.staffName ?? null,
        expenseAt: r.expenseAt.toISOString(),
      })),
    };
  }),
});
