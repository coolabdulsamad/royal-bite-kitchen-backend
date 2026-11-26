import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, inArray, notInArray, isNull, sql } from "drizzle-orm";
import { createRouter } from "../middleware";
import { authedProcedure, roleProcedure } from "../auth/guards";
import { getDb } from "../queries/connection";
import { orderItems, orders, sales, users } from "@db/schema";
import {
  ACTIVE_ORDER_STATUSES,
  ORDER_STATUSES,
  type OrderStatus,
} from "@contracts/orders";
import { priceOrderLines, type ModifierSnapshot } from "../pricing";

const lineSchema = z.object({
  itemId: z.number().int().positive(),
  quantity: z.number().int().min(1).max(99),
  optionIds: z.array(z.number().int().positive()).max(20).default([]),
});

const statusRank = (s: OrderStatus) => ORDER_STATUSES.indexOf(s);

export const ordersRouter = createRouter({
  /**
   * Place a kitchen order. Any staff role can take an order; the server
   * re-prices every line against the live menu (shared with completeSale).
   */
  create: authedProcedure
    .input(
      z.object({
        /** Table number / customer name — shown big on the kitchen ticket. */
        label: z.string().trim().min(1).max(64),
        notes: z.string().trim().max(500).optional(),
        items: z.array(lineSchema).min(1).max(100),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const { pricedLines, subtotalKobo } = await priceOrderLines(db, input.items);

      const created = await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(orders)
          .values({
            orderNo: "PENDING",
            label: input.label,
            notes: input.notes || null,
            staffId: ctx.staff.sub,
            totalKobo: subtotalKobo,
          })
          .$returningId();
        const orderNo = `ORD-${String(row.id).padStart(6, "0")}`;
        await tx
          .update(orders)
          .set({ orderNo })
          .where(eq(orders.id, row.id));
        for (const line of pricedLines) {
          await tx.insert(orderItems).values({
            orderId: row.id,
            itemId: line.itemId,
            itemName: line.itemName,
            unitPriceKobo: line.unitPriceKobo,
            modifiersJson:
              line.modifiers.length > 0 ? JSON.stringify(line.modifiers) : null,
            quantity: line.quantity,
            lineTotalKobo: line.lineTotalKobo,
          });
        }
        return { orderId: row.id, orderNo };
      });

      return {
        ok: true as const,
        orderId: created.orderId,
        orderNo: created.orderNo,
        status: "placed" as const,
        label: input.label,
        notes: input.notes || null,
        staffName: ctx.staff.name,
        totalKobo: subtotalKobo,
        lines: pricedLines,
        createdAt: new Date().toISOString(),
      };
    }),

  /**
   * Orders board feed. "active" (default) = the kitchen pipeline, oldest
   * first; a specific status or "all" lists newest first. Every staff role
   * can read the board — the kitchen screen runs on a staff login.
   */
  list: authedProcedure
    .input(
      z.object({
        status: z
          .enum(["active", "all", ...ORDER_STATUSES])
          .default("active"),
        /** "delivery" = any partner source; omitted = everything. */
        source: z.enum(["pos", "delivery"]).optional(),
        limit: z.number().int().min(1).max(200).default(100),
      }),
    )
    .query(async ({ input }) => {
      const db = getDb();
      const active = input.status === "active";
      const conditions = [];
      if (input.status !== "all") {
        conditions.push(
          active
            ? inArray(orders.status, [...ACTIVE_ORDER_STATUSES])
            : eq(orders.status, input.status as OrderStatus),
        );
      }
      if (input.source === "pos") conditions.push(eq(orders.source, "pos"));
      if (input.source === "delivery") {
        conditions.push(notInArray(orders.source, ["pos"]));
      }
      const where = conditions.length > 0 ? and(...conditions) : undefined;

      const rows = await db
        .select({
          id: orders.id,
          orderNo: orders.orderNo,
          status: orders.status,
          label: orders.label,
          notes: orders.notes,
          staffId: orders.staffId,
          staffName: users.name,
          saleId: orders.saleId,
          receiptNo: sales.receiptNo,
          totalKobo: orders.totalKobo,
          createdAt: orders.createdAt,
          updatedAt: orders.updatedAt,
          cancelledAt: orders.cancelledAt,
          cancelReason: orders.cancelReason,
          source: orders.source,
          externalId: orders.externalId,
          customerName: orders.customerName,
          customerPhone: orders.customerPhone,
          deliveryAddress: orders.deliveryAddress,
          kitchenPrintedAt: orders.kitchenPrintedAt,
        })
        .from(orders)
        .leftJoin(users, eq(users.id, orders.staffId))
        .leftJoin(sales, eq(sales.id, orders.saleId))
        .where(where)
        .orderBy(
          // Kitchen urgency: active board oldest first; history newest first.
          ...(active ? [asc(orders.createdAt)] : [desc(orders.createdAt)]),
        )
        .limit(input.limit);

      const ids = rows.map((r) => r.id);
      const lines = ids.length
        ? await db
            .select()
            .from(orderItems)
            .where(inArray(orderItems.orderId, ids))
        : [];

      return rows.map((r) => ({
        ...r,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
        cancelledAt: r.cancelledAt ? r.cancelledAt.toISOString() : null,
        kitchenPrintedAt: r.kitchenPrintedAt ? r.kitchenPrintedAt.toISOString() : null,
        lines: lines
          .filter((l) => l.orderId === r.id)
          .map((l) => ({
            itemId: l.itemId,
            itemName: l.itemName,
            unitPriceKobo: l.unitPriceKobo,
            quantity: l.quantity,
            modifiers: l.modifiersJson
              ? (JSON.parse(l.modifiersJson) as ModifierSnapshot[])
              : [],
            lineTotalKobo: l.lineTotalKobo,
          })),
      }));
    }),

  /**
   * Advance a ticket through the kitchen workflow (placed → preparing →
   * ready → served). Any role can bump — the kitchen screen uses a normal
   * staff login. Forward-only, enforced conditionally so two taps on two
   * screens can't skip or double-advance.
   */
  advance: authedProcedure
    .input(
      z.object({
        orderId: z.number().int().positive(),
        to: z.enum(["preparing", "ready", "served"]),
      }),
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const allowedFrom: Record<string, OrderStatus[]> = {
        preparing: ["placed"],
        ready: ["placed", "preparing"],
        served: ["placed", "preparing", "ready"],
      };
      // Serving a ticket the customer ALREADY paid closes it out — the meal
      // is done and the money is in. An unpaid served order stays on the
      // board (dine-in guests often pay after eating).
      const target =
        input.to === "served"
          ? sql<OrderStatus>`IF(${orders.saleId} IS NULL, 'served', 'completed')`
          : input.to;
      const [result] = await db
        .update(orders)
        .set({ status: target, updatedAt: new Date() })
        .where(
          and(
            eq(orders.id, input.orderId),
            inArray(orders.status, allowedFrom[input.to]),
          ),
        );
      if (result.affectedRows === 0) {
        const [current] = await db
          .select({ status: orders.status })
          .from(orders)
          .where(eq(orders.id, input.orderId))
          .limit(1);
        if (!current) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Order not found" });
        }
        if (statusRank(current.status) >= statusRank(input.to)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "This ticket already moved past that step — refresh the board",
          });
        }
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            current.status === "completed" || current.status === "cancelled"
              ? `This order is ${current.status} — it can't move on the board`
              : "This ticket can't move that way",
        });
      }
      // Read back the real status — serving a paid ticket lands on completed.
      const [after] = await db
        .select({ status: orders.status })
        .from(orders)
        .where(eq(orders.id, input.orderId))
        .limit(1);
      return { ok: true as const, orderId: input.orderId, status: after?.status ?? input.to };
    }),

  /**
   * Cancel an unpaid order — manager and above, with a reason. A paid order
   * is money: it must be returned through Sales History instead.
   */
  cancel: roleProcedure("manager")
    .input(
      z.object({
        orderId: z.number().int().positive(),
        reason: z.string().trim().min(3).max(255),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const [order] = await db
        .select()
        .from(orders)
        .where(eq(orders.id, input.orderId))
        .limit(1);
      if (!order) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Order not found" });
      }
      if (order.status === "cancelled") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This order was already cancelled",
        });
      }
      if (order.status === "completed" || order.saleId !== null) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "This order is already paid — return the sale from Sales History instead",
        });
      }
      const [result] = await db
        .update(orders)
        .set({
          status: "cancelled",
          cancelledAt: new Date(),
          cancelledById: ctx.staff.sub,
          cancelReason: input.reason,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(orders.id, order.id),
            notInArray(orders.status, ["completed", "cancelled"]),
            isNull(orders.saleId),
          ),
        );
      if (result.affectedRows === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This order changed while you were cancelling — refresh the board",
        });
      }
      return { ok: true as const, orderId: order.id, orderNo: order.orderNo };
    }),

  /**
   * Claim partner tickets for kitchen printing. Each id is claimed with a
   * conditional UPDATE (kitchen_printed_at IS NULL, partner sources only) so
   * when several board screens poll at once, exactly one prints each ticket.
   * Returns the ids THIS caller claimed — print only those.
   */
  markTicketsPrinted: authedProcedure
    .input(z.object({ orderIds: z.array(z.number().int().positive()).min(1).max(20) }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const claimed: number[] = [];
      for (const id of input.orderIds) {
        const [result] = await db
          .update(orders)
          .set({ kitchenPrintedAt: new Date() })
          .where(
            and(
              eq(orders.id, id),
              isNull(orders.kitchenPrintedAt),
              notInArray(orders.source, ["pos"]),
            ),
          );
        if (result.affectedRows === 1) claimed.push(id);
      }
      return { ok: true as const, claimed };
    }),
});

/** Shared so sales.ts can mark an order paid inside the same transaction. */
export const orderPaidGuard = and(
  isNull(orders.saleId),
  notInArray(orders.status, ["completed", "cancelled"]),
);
