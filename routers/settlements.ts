import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  like,
  lt,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { createRouter } from "../middleware";
import { permProcedure } from "../auth/guards";
import { getDb } from "../queries/connection";
import { logEvent } from "../audit";
import { postToLedger } from "../ledger";
import {
  expenses,
  orderItems,
  orders,
  partnerConnections,
  saleItems,
  salePayments,
  sales,
  settlementInvoiceOrders,
  settlementInvoices,
  users,
} from "@db/schema";
import { formatNaira } from "@contracts/money";
import { commissionOf, formatBps } from "@contracts/settlements";

const dayInput = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .optional();

/** Server-local day bounds: from 00:00 (inclusive) to to+1day 00:00 (exclusive). */
function dayBounds(from?: string, to?: string) {
  let fromStart: Date | null = null;
  let toEnd: Date | null = null;
  if (from) {
    fromStart = new Date(from);
    fromStart.setHours(0, 0, 0, 0);
  }
  if (to) {
    toEnd = new Date(to);
    toEnd.setHours(0, 0, 0, 0);
    toEnd.setDate(toEnd.getDate() + 1);
  }
  return { fromStart, toEnd };
}

/**
 * TRUE when the order sits on an open or paid invoice. Cancelled invoices
 * release their orders for re-invoicing, so only open/paid block.
 */
const onLiveInvoice = sql`EXISTS (
  SELECT 1 FROM settlement_invoice_orders sio
  INNER JOIN settlement_invoices si ON si.id = sio.invoice_id
  WHERE sio.order_id = ${orders.id} AND si.status IN ('open','paid')
)`;

/** Conditions shared by every "unsettled partner order" read. */
function unsettledConditions(input: {
  partnerConnectionId?: number;
  from?: string;
  to?: string;
  search?: string;
}) {
  const conditions = [
    ne(orders.source, "pos"),
    eq(orders.status, "completed"),
    isNull(orders.saleId),
    sql`NOT ${onLiveInvoice}`,
  ];
  if (input.partnerConnectionId !== undefined) {
    conditions.push(eq(orders.partnerConnectionId, input.partnerConnectionId));
  }
  const { fromStart, toEnd } = dayBounds(input.from, input.to);
  if (fromStart) conditions.push(gte(orders.createdAt, fromStart));
  if (toEnd) conditions.push(lt(orders.createdAt, toEnd));
  if (input.search) {
    const q = `%${input.search}%`;
    conditions.push(
      or(
        like(orders.orderNo, q),
        like(orders.customerName, q),
        like(orders.customerPhone, q),
      )!,
    );
  }
  return and(...conditions);
}

const lineSelect = {
  itemId: orderItems.itemId,
  itemName: orderItems.itemName,
  unitPriceKobo: orderItems.unitPriceKobo,
  modifiersJson: orderItems.modifiersJson,
  quantity: orderItems.quantity,
  lineTotalKobo: orderItems.lineTotalKobo,
  orderId: orderItems.orderId,
};

/**
 * Delivery-partner settlements — the receivables office for Glovo / Chowdeck.
 * Manager and above: this is money owed TO the restaurant.
 */
export const settlementsRouter = createRouter({
  /**
   * Headline tiles + per-partner breakdown. Outstanding figures are as-of-now;
   * received figures cover the selected range (by paid date).
   */
  overview: permProcedure("settlements", "view")
    .input(z.object({ from: dayInput, to: dayInput }))
    .query(async ({ input }) => {
      const db = getDb();

      const { fromStart, toEnd } = dayBounds(input.from, input.to);
      const paidConditions = [eq(settlementInvoices.status, "paid")];
      if (fromStart) paidConditions.push(gte(settlementInvoices.paidAt, fromStart));
      if (toEnd) paidConditions.push(lt(settlementInvoices.paidAt, toEnd));

      // Independent aggregates — run them concurrently, the database is remote.
      const [[unsettled], [open], [paid]] = await Promise.all([
        db
          .select({
            n: sql<number>`count(*)`.as("n"),
            total: sql<number>`coalesce(sum(${orders.totalKobo}),0)`.as("t"),
          })
          .from(orders)
          .where(unsettledConditions({})),
        db
          .select({
            n: sql<number>`count(*)`.as("n"),
            net: sql<number>`coalesce(sum(${settlementInvoices.netKobo}),0)`.as("t"),
          })
          .from(settlementInvoices)
          .where(eq(settlementInvoices.status, "open")),
        db
          .select({
            n: sql<number>`count(*)`.as("n"),
            gross: sql<number>`coalesce(sum(${settlementInvoices.grossKobo}),0)`.as("g"),
            commission: sql<number>`coalesce(sum(${settlementInvoices.commissionKobo}),0)`.as("c"),
            net: sql<number>`coalesce(sum(${settlementInvoices.netKobo}),0)`.as("t"),
          })
          .from(settlementInvoices)
          .where(and(...paidConditions)),
      ]);

      // Per-partner rows: unsettled + open-invoice + received-in-range.
      // GROUP BY aggregates, not a per-connection loop — the database lives
      // behind a network hop, so N×3 sequential queries cost seconds.
      const [conns, unsettledByPartner, openByPartner, paidByPartner] = await Promise.all([
        db
          .select({
            id: partnerConnections.id,
            provider: partnerConnections.provider,
            name: partnerConnections.name,
            commissionBps: partnerConnections.commissionBps,
            active: partnerConnections.active,
          })
          .from(partnerConnections)
          .orderBy(partnerConnections.name),
        db
          .select({
            connectionId: orders.partnerConnectionId,
            n: sql<number>`count(*)`.as("n"),
            total: sql<number>`coalesce(sum(${orders.totalKobo}),0)`.as("t"),
          })
          .from(orders)
          .where(unsettledConditions({}))
          .groupBy(orders.partnerConnectionId),
        db
          .select({
            connectionId: settlementInvoices.partnerConnectionId,
            n: sql<number>`count(*)`.as("n"),
            net: sql<number>`coalesce(sum(${settlementInvoices.netKobo}),0)`.as("t"),
          })
          .from(settlementInvoices)
          .where(eq(settlementInvoices.status, "open"))
          .groupBy(settlementInvoices.partnerConnectionId),
        db
          .select({
            connectionId: settlementInvoices.partnerConnectionId,
            n: sql<number>`count(*)`.as("n"),
            commission: sql<number>`coalesce(sum(${settlementInvoices.commissionKobo}),0)`.as("c"),
            net: sql<number>`coalesce(sum(${settlementInvoices.netKobo}),0)`.as("t"),
          })
          .from(settlementInvoices)
          .where(and(...paidConditions))
          .groupBy(settlementInvoices.partnerConnectionId),
      ]);
      const uBy = new Map(unsettledByPartner.map((r) => [r.connectionId, r]));
      const oBy = new Map(openByPartner.map((r) => [r.connectionId, r]));
      const pBy = new Map(paidByPartner.map((r) => [r.connectionId, r]));
      const partners = conns.map((c) => {
        const u = uBy.get(c.id);
        const o = oBy.get(c.id);
        const p = pBy.get(c.id);
        return {
          connectionId: c.id,
          provider: c.provider,
          name: c.name,
          commissionBps: c.commissionBps,
          active: c.active,
          unsettledOrders: Number(u?.n ?? 0),
          unsettledKobo: Number(u?.total ?? 0),
          openInvoices: Number(o?.n ?? 0),
          openNetKobo: Number(o?.net ?? 0),
          paidInvoices: Number(p?.n ?? 0),
          paidCommissionKobo: Number(p?.commission ?? 0),
          paidNetKobo: Number(p?.net ?? 0),
        };
      });

      return {
        unsettledOrders: Number(unsettled?.n ?? 0),
        unsettledKobo: Number(unsettled?.total ?? 0),
        openInvoices: Number(open?.n ?? 0),
        openNetKobo: Number(open?.net ?? 0),
        paidInvoices: Number(paid?.n ?? 0),
        paidGrossKobo: Number(paid?.gross ?? 0),
        paidCommissionKobo: Number(paid?.commission ?? 0),
        paidNetKobo: Number(paid?.net ?? 0),
        partners,
      };
    }),

  /**
   * The unsettled register — completed delivery orders the partner still owes
   * us for, with full lines so an invoice can be previewed before creation.
   */
  unsettled: permProcedure("settlements", "view")
    .input(
      z.object({
        partnerConnectionId: z.number().int().positive().optional(),
        from: dayInput,
        to: dayInput,
        search: z.string().trim().max(64).optional(),
        limit: z.number().int().min(1).max(500).default(200),
      }),
    )
    .query(async ({ input }) => {
      const db = getDb();
      const rows = await db
        .select({
          id: orders.id,
          orderNo: orders.orderNo,
          status: orders.status,
          source: orders.source,
          externalId: orders.externalId,
          partnerConnectionId: orders.partnerConnectionId,
          customerName: orders.customerName,
          customerPhone: orders.customerPhone,
          deliveryAddress: orders.deliveryAddress,
          totalKobo: orders.totalKobo,
          createdAt: orders.createdAt,
        })
        .from(orders)
        .where(unsettledConditions(input))
        .orderBy(orders.createdAt)
        .limit(input.limit);

      const ids = rows.map((r) => r.id);
      const lines = ids.length
        ? await db.select(lineSelect).from(orderItems).where(inArray(orderItems.orderId, ids))
        : [];

      return rows.map((r) => ({
        ...r,
        createdAt: r.createdAt.toISOString(),
        lines: lines
          .filter((l) => l.orderId === r.id)
          .map((l) => ({
            itemName: l.itemName,
            quantity: l.quantity,
            unitPriceKobo: l.unitPriceKobo,
            lineTotalKobo: l.lineTotalKobo,
          })),
      }));
    }),

  /**
   * Accumulate completed partner orders into an invoice. Every order must
   * belong to the connection, be handed over (completed), unpaid at the till
   * and not already on a live invoice — checked atomically in one tx.
   */
  createInvoice: permProcedure("settlements", "manage")
    .input(
      z.object({
        partnerConnectionId: z.number().int().positive(),
        orderIds: z.array(z.number().int().positive()).min(1).max(500),
        note: z.string().trim().max(255).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const result = await db.transaction(async (tx) => {
        const [conn] = await tx
          .select()
          .from(partnerConnections)
          .where(eq(partnerConnections.id, input.partnerConnectionId))
          .limit(1);
        if (!conn) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Partner connection not found" });
        }

        const rows = await tx
          .select()
          .from(orders)
          .where(inArray(orders.id, input.orderIds))
          .for("update");
        const byId = new Map(rows.map((r) => [r.id, r]));
        const problems: string[] = [];
        for (const id of input.orderIds) {
          const o = byId.get(id);
          if (!o) problems.push(`#${id} not found`);
          else if (o.source === "pos") problems.push(`${o.orderNo} is a counter order`);
          else if (o.partnerConnectionId !== conn.id)
            problems.push(`${o.orderNo} belongs to a different partner`);
          else if (o.status !== "completed")
            problems.push(`${o.orderNo} is still ${o.status} — hand it over first`);
          else if (o.saleId !== null) problems.push(`${o.orderNo} is already paid`);
        }
        if (problems.length > 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Can't invoice: ${problems.slice(0, 4).join("; ")}${problems.length > 4 ? ` (+${problems.length - 4} more)` : ""}`,
          });
        }

        const conflicts = await tx
          .select({ orderId: settlementInvoiceOrders.orderId })
          .from(settlementInvoiceOrders)
          .innerJoin(
            settlementInvoices,
            eq(settlementInvoices.id, settlementInvoiceOrders.invoiceId),
          )
          .where(
            and(
              inArray(settlementInvoiceOrders.orderId, input.orderIds),
              inArray(settlementInvoices.status, ["open", "paid"]),
            ),
          );
        if (conflicts.length > 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `${conflicts.length} order(s) are already on another invoice — refresh and try again`,
          });
        }

        const grossKobo = rows.reduce((s, r) => s + r.totalKobo, 0);
        const commissionKobo = commissionOf(grossKobo, conn.commissionBps);
        const netKobo = grossKobo - commissionKobo;
        const periodFrom = new Date(Math.min(...rows.map((r) => r.createdAt.getTime())));
        const periodTo = new Date(Math.max(...rows.map((r) => r.createdAt.getTime())));

        const [inv] = await tx
          .insert(settlementInvoices)
          .values({
            invoiceNo: "PENDING",
            partnerConnectionId: conn.id,
            partnerName: conn.name,
            provider: conn.provider,
            orderCount: rows.length,
            grossKobo,
            commissionBps: conn.commissionBps,
            commissionKobo,
            netKobo,
            periodFrom,
            periodTo,
            note: input.note || null,
            createdById: ctx.staff.sub,
          })
          .$returningId();
        const invoiceNo = `INV-${String(inv.id).padStart(6, "0")}`;
        await tx
          .update(settlementInvoices)
          .set({ invoiceNo })
          .where(eq(settlementInvoices.id, inv.id));
        for (const r of rows) {
          await tx.insert(settlementInvoiceOrders).values({
            invoiceId: inv.id,
            orderId: r.id,
          });
        }
        return { invoiceId: inv.id, invoiceNo, orderCount: rows.length, grossKobo, commissionKobo, netKobo };
      });

      void logEvent(getDb(), {
        actor: ctx.staff,
        action: "settlement.create",
        entityType: "settlement",
        entityId: result.invoiceId,
        detail: `Invoice ${result.invoiceNo} · ${result.orderCount} orders · ${formatNaira(result.netKobo)} net`,
      });
      return { ok: true as const, ...result };
    }),

  /** Invoice register — filters, search and pagination. */
  invoices: permProcedure("settlements", "view")
    .input(
      z.object({
        partnerConnectionId: z.number().int().positive().optional(),
        status: z.enum(["all", "open", "paid", "cancelled"]).default("all"),
        from: dayInput,
        to: dayInput,
        search: z.string().trim().max(64).optional(),
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(50).default(15),
      }),
    )
    .query(async ({ input }) => {
      const db = getDb();
      const conditions = [];
      if (input.partnerConnectionId !== undefined) {
        conditions.push(eq(settlementInvoices.partnerConnectionId, input.partnerConnectionId));
      }
      if (input.status !== "all") conditions.push(eq(settlementInvoices.status, input.status));
      const { fromStart, toEnd } = dayBounds(input.from, input.to);
      if (fromStart) conditions.push(gte(settlementInvoices.createdAt, fromStart));
      if (toEnd) conditions.push(lt(settlementInvoices.createdAt, toEnd));
      if (input.search) {
        const q = `%${input.search}%`;
        conditions.push(
          or(
            like(settlementInvoices.invoiceNo, q),
            like(settlementInvoices.partnerName, q),
            like(settlementInvoices.paymentReference, q),
          )!,
        );
      }
      const where = conditions.length > 0 ? and(...conditions) : undefined;

      const [countRow] = await db
        .select({ n: sql<number>`count(*)`.as("n") })
        .from(settlementInvoices)
        .where(where);
      const rows = await db
        .select({
          id: settlementInvoices.id,
          invoiceNo: settlementInvoices.invoiceNo,
          partnerConnectionId: settlementInvoices.partnerConnectionId,
          partnerName: settlementInvoices.partnerName,
          provider: settlementInvoices.provider,
          status: settlementInvoices.status,
          orderCount: settlementInvoices.orderCount,
          grossKobo: settlementInvoices.grossKobo,
          commissionBps: settlementInvoices.commissionBps,
          commissionKobo: settlementInvoices.commissionKobo,
          netKobo: settlementInvoices.netKobo,
          periodFrom: settlementInvoices.periodFrom,
          periodTo: settlementInvoices.periodTo,
          note: settlementInvoices.note,
          createdAt: settlementInvoices.createdAt,
          paidAt: settlementInvoices.paidAt,
          paymentMethod: settlementInvoices.paymentMethod,
          paymentReference: settlementInvoices.paymentReference,
          createdByName: users.name,
        })
        .from(settlementInvoices)
        .leftJoin(users, eq(users.id, settlementInvoices.createdById))
        .where(where)
        .orderBy(desc(settlementInvoices.id))
        .limit(input.pageSize)
        .offset((input.page - 1) * input.pageSize);

      return {
        total: Number(countRow?.n ?? 0),
        page: input.page,
        pageSize: input.pageSize,
        rows: rows.map((r) => ({
          ...r,
          createdByName: r.createdByName ?? "System",
          periodFrom: r.periodFrom.toISOString(),
          periodTo: r.periodTo.toISOString(),
          createdAt: r.createdAt.toISOString(),
          paidAt: r.paidAt ? r.paidAt.toISOString() : null,
        })),
      };
    }),

  /** One invoice with every accumulated order and its lines — print source. */
  invoiceDetail: permProcedure("settlements", "view")
    .input(z.object({ invoiceId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const db = getDb();
      const [inv] = await db
        .select()
        .from(settlementInvoices)
        .where(eq(settlementInvoices.id, input.invoiceId))
        .limit(1);
      if (!inv) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Invoice not found" });
      }
      const nameOf = async (id: number | null) => {
        if (!id) return null;
        const [u] = await db
          .select({ name: users.name })
          .from(users)
          .where(eq(users.id, id))
          .limit(1);
        return u?.name ?? null;
      };
      const rows = await db
        .select({
          id: orders.id,
          orderNo: orders.orderNo,
          externalId: orders.externalId,
          customerName: orders.customerName,
          customerPhone: orders.customerPhone,
          deliveryAddress: orders.deliveryAddress,
          totalKobo: orders.totalKobo,
          createdAt: orders.createdAt,
        })
        .from(settlementInvoiceOrders)
        .innerJoin(orders, eq(orders.id, settlementInvoiceOrders.orderId))
        .where(eq(settlementInvoiceOrders.invoiceId, inv.id))
        .orderBy(orders.createdAt);
      const ids = rows.map((r) => r.id);
      const lines = ids.length
        ? await db.select(lineSelect).from(orderItems).where(inArray(orderItems.orderId, ids))
        : [];

      return {
        id: inv.id,
        invoiceNo: inv.invoiceNo,
        partnerConnectionId: inv.partnerConnectionId,
        partnerName: inv.partnerName,
        provider: inv.provider,
        status: inv.status,
        orderCount: inv.orderCount,
        grossKobo: inv.grossKobo,
        commissionBps: inv.commissionBps,
        commissionKobo: inv.commissionKobo,
        netKobo: inv.netKobo,
        periodFrom: inv.periodFrom.toISOString(),
        periodTo: inv.periodTo.toISOString(),
        note: inv.note,
        createdAt: inv.createdAt.toISOString(),
        createdByName: await nameOf(inv.createdById),
        paidAt: inv.paidAt ? inv.paidAt.toISOString() : null,
        paidByName: await nameOf(inv.paidById),
        paymentMethod: inv.paymentMethod,
        paymentReference: inv.paymentReference,
        cancelledAt: inv.cancelledAt ? inv.cancelledAt.toISOString() : null,
        cancelReason: inv.cancelReason,
        orders: rows.map((r) => ({
          ...r,
          createdAt: r.createdAt.toISOString(),
          lines: lines
            .filter((l) => l.orderId === r.id)
            .map((l) => ({
              itemName: l.itemName,
              quantity: l.quantity,
              unitPriceKobo: l.unitPriceKobo,
              lineTotalKobo: l.lineTotalKobo,
            })),
        })),
      };
    }),

  /**
   * Settlement received: posts every order as a dated sale (transfer, ref =
   * invoice no — revenue lands on the day the food was sold), books the
   * partner commission as an expense, and marks the whole invoice paid.
   */
  markPaid: permProcedure("settlements", "manage")
    .input(
      z.object({
        invoiceId: z.number().int().positive(),
        method: z.enum(["cash", "bank_pos", "transfer"]).default("transfer"),
        reference: z.string().trim().max(120).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const result = await db.transaction(async (tx) => {
        const [inv] = await tx
          .select()
          .from(settlementInvoices)
          .where(eq(settlementInvoices.id, input.invoiceId))
          .limit(1)
          .for("update");
        if (!inv) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Invoice not found" });
        }
        if (inv.status === "paid") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "This invoice is already paid" });
        }
        if (inv.status === "cancelled") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "This invoice was cancelled" });
        }

        const rows = await tx
          .select()
          .from(orders)
          .innerJoin(
            settlementInvoiceOrders,
            eq(settlementInvoiceOrders.orderId, orders.id),
          )
          .where(eq(settlementInvoiceOrders.invoiceId, inv.id))
          .for("update");

        const receipts: Array<{ orderId: number; receiptNo: string }> = [];
        for (const { orders: o } of rows) {
          if (o.saleId !== null) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `${o.orderNo} was already settled — nothing was changed`,
            });
          }
          const [saleRow] = await tx
            .insert(sales)
            .values({
              receiptNo: "PENDING",
              staffId: ctx.staff.sub,
              subtotalKobo: o.totalKobo,
              discountKobo: 0,
              totalKobo: o.totalKobo,
              soldAt: o.createdAt,
              clientRef: `settle-${inv.id}-${o.id}`,
            })
            .$returningId();
          const receiptNo = `RB-${String(saleRow.id).padStart(6, "0")}`;
          await tx.update(sales).set({ receiptNo }).where(eq(sales.id, saleRow.id));

          const lines = await tx
            .select()
            .from(orderItems)
            .where(eq(orderItems.orderId, o.id));
          for (const l of lines) {
            await tx.insert(saleItems).values({
              saleId: saleRow.id,
              itemId: l.itemId,
              itemName: l.itemName,
              unitPriceKobo: l.unitPriceKobo,
              modifiersJson: l.modifiersJson,
              quantity: l.quantity,
              lineTotalKobo: l.lineTotalKobo,
            });
          }
          await tx.insert(salePayments).values({
            saleId: saleRow.id,
            method: input.method,
            amountKobo: o.totalKobo,
            reference: inv.invoiceNo,
          });
          // Money ledger (v36): the partner's batch payment comes in.
          await postToLedger(tx, [{
            method: input.method,
            direction: "in",
            amountKobo: o.totalKobo,
            kind: "sale_payment",
            refType: "sale",
            refId: receiptNo,
            note: `Settlement ${inv.invoiceNo} — ${o.orderNo}`,
            staffId: ctx.staff.sub,
          }]);
          await tx
            .update(orders)
            .set({ saleId: saleRow.id, updatedAt: new Date() })
            .where(eq(orders.id, o.id));
          receipts.push({ orderId: o.id, receiptNo });
        }

        let commissionExpenseId: number | null = null;
        if (inv.commissionKobo > 0) {
          const [exp] = await tx
            .insert(expenses)
            .values({
              category: "other",
              amountKobo: inv.commissionKobo,
              note: `${inv.partnerName} commission — ${inv.invoiceNo} (${formatBps(inv.commissionBps)} of ${formatNaira(inv.grossKobo)})`,
              method: "transfer",
              staffId: ctx.staff.sub,
            })
            .$returningId();
          commissionExpenseId = exp.id;
          // Money ledger (v36): the commission is money that never reaches
          // us — booked as an out-flow from the account the partner paid into.
          await postToLedger(tx, [{
            method: "transfer",
            direction: "out",
            amountKobo: inv.commissionKobo,
            kind: "expense",
            refType: "expense",
            refId: String(exp.id),
            note: `${inv.partnerName} commission — ${inv.invoiceNo}`,
            staffId: ctx.staff.sub,
          }]);
        }

        await tx
          .update(settlementInvoices)
          .set({
            status: "paid",
            paidAt: new Date(),
            paidById: ctx.staff.sub,
            paymentMethod: input.method,
            paymentReference: input.reference || null,
            commissionExpenseId,
          })
          .where(eq(settlementInvoices.id, inv.id));

        return { invoiceNo: inv.invoiceNo, receipts, commissionExpenseId };
      });

      void logEvent(getDb(), {
        actor: ctx.staff,
        action: "settlement.paid",
        entityType: "settlement",
        entityId: input.invoiceId,
        detail: `Invoice ${result.invoiceNo} paid · ${result.receipts.length} orders settled · commission ${result.commissionExpenseId ? "booked" : "none"}`,
      });
      return { ok: true as const, ...result };
    }),

  /**
   * Cancel an OPEN invoice — the orders go back to the unsettled register and
   * can be invoiced again. Paid invoices are money: they can't be cancelled.
   */
  cancelInvoice: permProcedure("settlements", "manage")
    .input(
      z.object({
        invoiceId: z.number().int().positive(),
        reason: z.string().trim().min(3).max(255),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const [inv] = await db
        .select({ id: settlementInvoices.id, status: settlementInvoices.status, invoiceNo: settlementInvoices.invoiceNo })
        .from(settlementInvoices)
        .where(eq(settlementInvoices.id, input.invoiceId))
        .limit(1);
      if (!inv) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Invoice not found" });
      }
      if (inv.status !== "open") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            inv.status === "paid"
              ? "This invoice is already paid — it can't be cancelled"
              : "This invoice was already cancelled",
        });
      }
      await db
        .update(settlementInvoices)
        .set({
          status: "cancelled",
          cancelledAt: new Date(),
          cancelledById: ctx.staff.sub,
          cancelReason: input.reason,
        })
        .where(
          and(
            eq(settlementInvoices.id, inv.id),
            eq(settlementInvoices.status, "open"),
          ),
        );
      void logEvent(db, {
        actor: ctx.staff,
        action: "settlement.cancel",
        entityType: "settlement",
        entityId: inv.id,
        detail: `Invoice ${inv.invoiceNo} cancelled · ${input.reason}`,
      });
      return { ok: true as const, invoiceNo: inv.invoiceNo };
    }),
});
