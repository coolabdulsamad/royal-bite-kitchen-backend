import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, gte, inArray, like, lte, sql } from "drizzle-orm";
import { createRouter } from "../middleware";
import { authedProcedure, roleProcedure } from "../auth/guards";
import { getDb } from "../queries/connection";
import {
  bankPosTerminals,
  customers,
  orderItems,
  orders,
  saleItems,
  salePayments,
  sales,
  users,
} from "@db/schema";
import { nairaToKobo, formatNaira } from "@contracts/money";
import { logEvent } from "../audit";
import { DISCOUNT_LIMIT_PERCENT } from "@contracts/payments";
import type { OrderStatus } from "@contracts/orders";
import { ROLE_LEVEL } from "@contracts/roles";
import type { StaffRole } from "@contracts/roles";
import { priceOrderLines, type ModifierSnapshot } from "../pricing";
import { orderPaidGuard } from "./orders";

/** Marker so the catch block can tell "order already closed" from DB failures. */
class OrderClosedError extends Error {}

/** Offline sales may be backdated this far without a manager role. */
const OFFLINE_BACKDATE_LIMIT_MS = 72 * 60 * 60 * 1000;
/** Clock-skew tolerance for device timestamps. */
const FUTURE_SKEW_MS = 5 * 60 * 1000;

export const salesRouter = createRouter({
  completeSale: authedProcedure
    .input(
      z.object({
        /** Ignored when paying an order (orderId set): the order's stored
         *  lines are charged instead, so the receipt always matches the
         *  board — including partner orders with partner prices. */
        items: z
          .array(
            z.object({
              itemId: z.number().int().positive(),
              quantity: z.number().int().min(1).max(99),
              optionIds: z.array(z.number().int().positive()).max(20).default([]),
            }),
          )
          .max(100),
        discount: z
          .object({
            type: z.enum(["percent", "fixed"]),
            /** percent: 0–100 · fixed: amount in NAIRA */
            value: z.number().min(0),
          })
          .nullish(),
        payments: z
          .array(
            z.object({
              method: z.enum(["cash", "bank_pos", "transfer"]),
              /** Amount in NAIRA */
              amount: z.number().positive().max(100_000_000),
              reference: z.string().trim().max(120).optional(),
              /** Registered bank POS terminal — only for bank_pos payments. */
              terminalId: z.number().int().positive().optional(),
            }),
          )
          .max(6)
          .default([]),
        /** ISO datetime — manager+ only, cannot be in the future. Offline
         *  sales (with clientRef) may be backdated up to 72h by any role. */
        saleDate: z.string().datetime().optional(),
        /** Idempotency key from the selling device — retries with the same
         *  ref return the already-saved sale instead of duplicating it. */
        clientRef: z.string().trim().min(8).max(64).optional(),
        /** Paying a kitchen order: links it and marks it completed. */
        orderId: z.number().int().positive().optional(),
        /** Attach a customer (regulars). REQUIRED when payments fall short —
         *  the shortfall goes onto their credit tab. */
        customerId: z.number().int().positive().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const staffRole = ctx.staff.role as StaffRole;

      // ------------------------------------------- idempotent replay (offline sync)
      const replayExisting = async () => {
        if (!input.clientRef) return null;
        const [existing] = await db
          .select()
          .from(sales)
          .where(eq(sales.clientRef, input.clientRef))
          .limit(1);
        if (!existing) return null;
        const [cashier] = await db
          .select({ name: users.name })
          .from(users)
          .where(eq(users.id, existing.staffId))
          .limit(1);
        const dbLines = await db
          .select()
          .from(saleItems)
          .where(eq(saleItems.saleId, existing.id));
        const dbPayments = await db
          .select({
            method: salePayments.method,
            amountKobo: salePayments.amountKobo,
            reference: salePayments.reference,
            terminalId: salePayments.terminalId,
            terminalName: bankPosTerminals.name,
          })
          .from(salePayments)
          .leftJoin(
            bankPosTerminals,
            eq(bankPosTerminals.id, salePayments.terminalId),
          )
          .where(eq(salePayments.saleId, existing.id));
        const paidKobo = dbPayments.reduce((s, p) => s + p.amountKobo, 0);
        let customerName: string | null = null;
        if (existing.customerId) {
          const [cust] = await db
            .select({ name: customers.name })
            .from(customers)
            .where(eq(customers.id, existing.customerId))
            .limit(1);
          customerName = cust?.name ?? null;
        }
        return {
          ok: true as const,
          saleId: existing.id,
          receiptNo: existing.receiptNo,
          cashierName: cashier?.name ?? "Staff",
          soldAt: existing.soldAt.toISOString(),
          lines: dbLines.map((l) => ({
            itemId: l.itemId,
            itemName: l.itemName,
            unitPriceKobo: l.unitPriceKobo,
            quantity: l.quantity,
            modifiers: l.modifiersJson
              ? (JSON.parse(l.modifiersJson) as ModifierSnapshot[])
              : [],
            lineTotalKobo: l.lineTotalKobo,
          })),
          subtotalKobo: existing.subtotalKobo,
          discountKobo: existing.discountKobo,
          totalKobo: existing.totalKobo,
          customerId: existing.customerId,
          customerName,
          creditKobo: existing.creditKobo,
          payments: dbPayments.map((p) => ({
            method: p.method,
            amountKobo: p.amountKobo,
            reference: p.reference,
            terminalId: p.terminalId,
            terminalName: p.terminalName,
          })),
          changeKobo: Math.max(0, paidKobo - existing.totalKobo),
        };
      };

      const replayed = await replayExisting();
      if (replayed) return replayed;

      // --------------------------------------------- source the sale lines
      // Paying a kitchen order? Fail fast with a clear error before charging,
      // then charge the order's STORED lines (partner prices included).
      let pricedLines: Array<{
        itemId: number | null;
        itemName: string;
        unitPriceKobo: number;
        quantity: number;
        modifiers: ModifierSnapshot[];
        lineTotalKobo: number;
      }>;
      let subtotalKobo: number;
      if (input.orderId !== undefined) {
        const [ord] = await db
          .select({ id: orders.id, status: orders.status, saleId: orders.saleId })
          .from(orders)
          .where(eq(orders.id, input.orderId))
          .limit(1);
        if (!ord) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Order not found" });
        }
        if (ord.status === "cancelled") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "That order was cancelled — it can't be paid",
          });
        }
        if (ord.status === "completed" || ord.saleId !== null) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "That order was already paid — refresh the orders board",
          });
        }
        const orderLines = await db
          .select()
          .from(orderItems)
          .where(eq(orderItems.orderId, input.orderId));
        if (orderLines.length === 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "That order has no lines — cancel it and re-enter it",
          });
        }
        pricedLines = orderLines.map((l) => ({
          itemId: l.itemId,
          itemName: l.itemName,
          unitPriceKobo: l.unitPriceKobo,
          quantity: l.quantity,
          modifiers: l.modifiersJson
            ? (JSON.parse(l.modifiersJson) as ModifierSnapshot[])
            : [],
          lineTotalKobo: l.lineTotalKobo,
        }));
        subtotalKobo = pricedLines.reduce((s, l) => s + l.lineTotalKobo, 0);
      } else {
        if (input.items.length === 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Add at least one item",
          });
        }
        // -------------------------------------- price the basket (shared logic)
        const priced = await priceOrderLines(db, input.items);
        pricedLines = priced.pricedLines;
        subtotalKobo = priced.subtotalKobo;
      }

      // ------------------------------------------------------------ discount
      let discountKobo = 0;
      if (input.discount && input.discount.value > 0) {
        const limit = DISCOUNT_LIMIT_PERCENT[staffRole];
        if (input.discount.type === "percent") {
          if (input.discount.value > limit) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: `Your role can give at most ${limit}% discount`,
            });
          }
          discountKobo = Math.round((subtotalKobo * input.discount.value) / 100);
        } else {
          discountKobo = nairaToKobo(input.discount.value);
          const asPercent =
            subtotalKobo > 0 ? (discountKobo / subtotalKobo) * 100 : 100;
          if (asPercent > limit) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: `That fixed discount is above your ${limit}% limit`,
            });
          }
        }
        if (discountKobo > subtotalKobo) discountKobo = subtotalKobo;
      }
      const totalKobo = subtotalKobo - discountKobo;

      // ------------------------------------------------------------ payments
      const payments = input.payments.map((p) => ({
        ...p,
        amountKobo: nairaToKobo(p.amount),
      }));
      // A terminal pick is only meaningful on a card payment, and must point
      // at a registered, active terminal (deactivated machines keep history
      // but can't take new payments).
      const terminalIds = [...new Set(payments.filter((p) => p.terminalId !== undefined).map((p) => p.terminalId!))];
      const terminalNames = new Map<number, string>();
      if (terminalIds.length > 0) {
        for (const p of payments) {
          if (p.terminalId !== undefined && p.method !== "bank_pos") {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "A terminal can only be attached to a bank POS payment",
            });
          }
        }
        const found = await db
          .select({
            id: bankPosTerminals.id,
            name: bankPosTerminals.name,
            active: bankPosTerminals.active,
          })
          .from(bankPosTerminals)
          .where(inArray(bankPosTerminals.id, terminalIds));
        const byId = new Map(found.map((t) => [t.id, t.active]));
        for (const t of found) terminalNames.set(t.id, t.name);
        for (const id of terminalIds) {
          if (!byId.has(id)) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "That card terminal isn't registered — ask a manager",
            });
          }
          if (!byId.get(id)) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "That card terminal is disabled — pick another one",
            });
          }
        }
      }
      if (totalKobo > 0 && payments.length === 0 && input.customerId === undefined) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Add at least one payment",
        });
      }
      const nonCashKobo = payments
        .filter((p) => p.method !== "cash")
        .reduce((s, p) => s + p.amountKobo, 0);
      if (nonCashKobo > totalKobo) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Card/transfer payments cannot exceed the total",
        });
      }
      const paidKobo = payments.reduce((s, p) => s + p.amountKobo, 0);
      // Short payments are only allowed as CREDIT on a registered customer's
      // tab — the shortfall is tracked and collected later.
      const shortfallKobo = totalKobo - paidKobo;
      if (shortfallKobo > 0 && input.customerId === undefined) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Payments do not cover the total — collect the rest or put it on a customer's credit tab",
        });
      }
      const creditKobo = Math.max(0, shortfallKobo);
      let customerName: string | null = null;
      if (input.customerId !== undefined) {
        const [cust] = await db
          .select({
            id: customers.id,
            name: customers.name,
            active: customers.active,
          })
          .from(customers)
          .where(eq(customers.id, input.customerId))
          .limit(1);
        if (!cust) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Customer not found" });
        }
        if (!cust.active) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "That customer is deactivated — a manager must reactivate them first",
          });
        }
        customerName = cust.name;
      }
      const changeKobo = Math.max(0, paidKobo - totalKobo);

      // --------------------------------------------------------- sale date
      let soldAt = new Date();
      if (input.saleDate) {
        const parsed = new Date(input.saleDate);
        if (Number.isNaN(parsed.getTime())) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Invalid sale date",
          });
        }
        const isManager = ROLE_LEVEL[staffRole] >= ROLE_LEVEL.manager;
        if (!isManager) {
          // Non-managers may only date an OFFLINE sale (clientRef present),
          // within the last 72 hours — never the future.
          if (!input.clientRef) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "Only a manager or above can backdate a sale",
            });
          }
          if (parsed.getTime() < Date.now() - OFFLINE_BACKDATE_LIMIT_MS) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Offline sales can only be dated up to 72 hours back",
            });
          }
        }
        if (parsed.getTime() > Date.now() + FUTURE_SKEW_MS) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Sale date cannot be in the future",
          });
        }
        soldAt = parsed;
      }

      // ------------------------------------------------------------- persist
      try {
        const result = await db.transaction(async (tx) => {
          const [saleRow] = await tx
            .insert(sales)
            .values({
              receiptNo: "PENDING",
              staffId: ctx.staff.sub,
              subtotalKobo,
              discountKobo,
              totalKobo,
              soldAt,
              clientRef: input.clientRef ?? null,
              customerId: input.customerId ?? null,
              creditKobo,
            })
            .$returningId();
          const receiptNo = `RB-${String(saleRow.id).padStart(6, "0")}`;
          await tx
            .update(sales)
            .set({ receiptNo })
            .where(inArray(sales.id, [saleRow.id]));

          for (const line of pricedLines) {
            await tx.insert(saleItems).values({
              saleId: saleRow.id,
              itemId: line.itemId,
              itemName: line.itemName,
              unitPriceKobo: line.unitPriceKobo,
              modifiersJson:
                line.modifiers.length > 0 ? JSON.stringify(line.modifiers) : null,
              quantity: line.quantity,
              lineTotalKobo: line.lineTotalKobo,
            });
          }
          for (const p of payments) {
            await tx.insert(salePayments).values({
              saleId: saleRow.id,
              method: p.method,
              amountKobo: p.amountKobo,
              reference: p.reference || null,
              terminalId: p.terminalId ?? null,
            });
          }
          // Credit sale: raise the customer's balance atomically with the
          // sale itself. The active-guard catches a customer deactivated
          // between checkout and save — the whole sale rolls back.
          if (creditKobo > 0 && input.customerId !== undefined) {
            const [custUpdate] = await tx
              .update(customers)
              .set({ creditBalanceKobo: sql`credit_balance_kobo + ${creditKobo}` })
              .where(
                and(
                  eq(customers.id, input.customerId),
                  eq(customers.active, true),
                ),
              );
            if (custUpdate.affectedRows === 0) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message:
                  "That customer was just deactivated — nothing was charged",
              });
            }
          }
          // Kitchen order being paid: claim it atomically. If two tills race
          // to pay the same order, exactly one wins — the loser's whole sale
          // rolls back instead of double-charging the table.
          //
          // Payment settles the BILL, not the ticket: a dine-in order the
          // kitchen is still working on stays on the board (saleId set, Paid
          // badge) until it's served. Only an already-served order closes
          // out the moment it's paid.
          if (input.orderId !== undefined) {
            const [orderUpdate] = await tx
              .update(orders)
              .set({
                status: sql<OrderStatus>`IF(${orders.status} = 'served', 'completed', ${orders.status})`,
                saleId: saleRow.id,
                updatedAt: new Date(),
              })
              .where(and(eq(orders.id, input.orderId), orderPaidGuard));
            if (orderUpdate.affectedRows === 0) throw new OrderClosedError();
          }
          return { saleId: saleRow.id, receiptNo };
        });

        void logEvent(getDb(), {
          actor: ctx.staff,
          action: "sale.complete",
          entityType: "sale",
          entityId: result.saleId,
          detail: `Receipt ${result.receiptNo} · ${formatNaira(totalKobo)} · ${payments.map((p) => p.method).join(" + ")}`,
        });
        return {
          ok: true as const,
          saleId: result.saleId,
          receiptNo: result.receiptNo,
          cashierName: ctx.staff.name,
          soldAt: soldAt.toISOString(),
          lines: pricedLines,
          subtotalKobo,
          discountKobo,
          totalKobo,
          customerId: input.customerId ?? null,
          customerName,
          creditKobo,
          payments: payments.map((p) => ({
            method: p.method,
            amountKobo: p.amountKobo,
            reference: p.reference ?? null,
            terminalId: p.terminalId ?? null,
            terminalName:
              p.terminalId !== undefined
                ? (terminalNames.get(p.terminalId) ?? null)
                : null,
          })),
          changeKobo,
        };
      } catch (err) {
        // A duplicate client_ref means a concurrent sync already saved it —
        // return that sale instead of an error.
        const replayedAfterRace = await replayExisting().catch(() => null);
        if (replayedAfterRace) return replayedAfterRace;
        if (err instanceof OrderClosedError) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "That order was just paid or cancelled on another screen — nothing was charged",
          });
        }
        // Friendly errors raised inside the transaction keep their message.
        if (err instanceof TRPCError) throw err;
        // Unique receipt race or DB failure — surface as a retryable error.
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            "Could not save the sale — nothing was charged. Please try again.",
          cause: err,
        });
      }
    }),

  // ---------------------------------------------------------------------------
  // Sales history — cashiers see their own sales, manager+ sees everything
  // ---------------------------------------------------------------------------

  salesHistory: authedProcedure
    .input(
      z.object({
        /** Inclusive ISO bounds on sold_at */
        from: z.string().datetime().optional(),
        to: z.string().datetime().optional(),
        /** Receipt number fragment, e.g. "000042" or "RB-000042" */
        receipt: z.string().trim().max(20).optional(),
        /** Manager+ only — non-managers are always scoped to themselves */
        staffId: z.number().int().positive().optional(),
        status: z.enum(["completed", "returned", "all"]).default("all"),
        method: z.enum(["cash", "bank_pos", "transfer"]).optional(),
        page: z.number().int().min(0).default(0),
        pageSize: z.number().int().min(1).max(100).default(25),
      }),
    )
    .query(async ({ ctx, input }) => {
      const db = getDb();
      const staffRole = ctx.staff.role as StaffRole;
      const isManager = ROLE_LEVEL[staffRole] >= ROLE_LEVEL.manager;

      const conditions = [];
      if (!isManager || input.staffId) {
        conditions.push(eq(sales.staffId, isManager ? input.staffId! : ctx.staff.sub));
      }
      if (input.from) conditions.push(gte(sales.soldAt, new Date(input.from)));
      if (input.to) conditions.push(lte(sales.soldAt, new Date(input.to)));
      if (input.receipt) conditions.push(like(sales.receiptNo, `%${input.receipt}%`));
      if (input.status !== "all") conditions.push(eq(sales.status, input.status));
      if (input.method) {
        conditions.push(
          inArray(
            sales.id,
            db
              .select({ id: salePayments.saleId })
              .from(salePayments)
              .where(eq(salePayments.method, input.method)),
          ),
        );
      }
      const where = conditions.length > 0 ? and(...conditions) : undefined;

      const [countRow] = await db
        .select({ n: sql<number>`count(*)` })
        .from(sales)
        .where(where);
      const total = countRow?.n ?? 0;

      const rows = await db
        .select({
          id: sales.id,
          receiptNo: sales.receiptNo,
          staffId: sales.staffId,
          staffName: users.name,
          subtotalKobo: sales.subtotalKobo,
          discountKobo: sales.discountKobo,
          totalKobo: sales.totalKobo,
          status: sales.status,
          soldAt: sales.soldAt,
          creditKobo: sales.creditKobo,
          customerName: customers.name,
        })
        .from(sales)
        .leftJoin(users, eq(users.id, sales.staffId))
        .leftJoin(customers, eq(customers.id, sales.customerId))
        .where(where)
        .orderBy(desc(sales.soldAt), desc(sales.id))
        .limit(input.pageSize)
        .offset(input.page * input.pageSize);

      const ids = rows.map((r) => r.id);
      const pagePayments = ids.length
        ? await db
            .select()
            .from(salePayments)
            .where(inArray(salePayments.saleId, ids))
        : [];
      const pageItems = ids.length
        ? await db
            .select({ saleId: saleItems.saleId, quantity: saleItems.quantity })
            .from(saleItems)
            .where(inArray(saleItems.saleId, ids))
        : [];

      return {
        total,
        page: input.page,
        pageSize: input.pageSize,
        rows: rows.map((r) => ({
          ...r,
          soldAt: r.soldAt.toISOString(),
          itemCount: pageItems
            .filter((i) => i.saleId === r.id)
            .reduce((s, i) => s + i.quantity, 0),
          payments: pagePayments
            .filter((p) => p.saleId === r.id)
            .map((p) => ({ method: p.method, amountKobo: p.amountKobo })),
        })),
      };
    }),

  /** One sale with lines + payments (+ return info). Cashiers: own sales only. */
  saleDetail: authedProcedure
    .input(z.object({ saleId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const db = getDb();
      const staffRole = ctx.staff.role as StaffRole;
      const isManager = ROLE_LEVEL[staffRole] >= ROLE_LEVEL.manager;

      const [sale] = await db
        .select()
        .from(sales)
        .where(eq(sales.id, input.saleId))
        .limit(1);
      if (!sale) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Sale not found" });
      }
      if (!isManager && sale.staffId !== ctx.staff.sub) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You can only view your own sales",
        });
      }

      const [cashier] = await db
        .select({ name: users.name })
        .from(users)
        .where(eq(users.id, sale.staffId))
        .limit(1);
      const lines = await db
        .select()
        .from(saleItems)
        .where(eq(saleItems.saleId, sale.id));
      const payments = await db
        .select({
          method: salePayments.method,
          amountKobo: salePayments.amountKobo,
          reference: salePayments.reference,
          terminalId: salePayments.terminalId,
          terminalName: bankPosTerminals.name,
        })
        .from(salePayments)
        .leftJoin(
          bankPosTerminals,
          eq(bankPosTerminals.id, salePayments.terminalId),
        )
        .where(eq(salePayments.saleId, sale.id));
      let returnedByName: string | null = null;
      if (sale.returnedById) {
        const [by] = await db
          .select({ name: users.name })
          .from(users)
          .where(eq(users.id, sale.returnedById))
          .limit(1);
        returnedByName = by?.name ?? null;
      }
      let customerName: string | null = null;
      if (sale.customerId) {
        const [cust] = await db
          .select({ name: customers.name })
          .from(customers)
          .where(eq(customers.id, sale.customerId))
          .limit(1);
        customerName = cust?.name ?? null;
      }

      const paidKobo = payments.reduce((s, p) => s + p.amountKobo, 0);
      return {
        saleId: sale.id,
        receiptNo: sale.receiptNo,
        cashierName: cashier?.name ?? "Staff",
        soldAt: sale.soldAt.toISOString(),
        status: sale.status,
        returnedAt: sale.returnedAt ? sale.returnedAt.toISOString() : null,
        returnedByName,
        returnReason: sale.returnReason,
        lines: lines.map((l) => ({
          itemName: l.itemName,
          quantity: l.quantity,
          modifiers: l.modifiersJson
            ? (JSON.parse(l.modifiersJson) as ModifierSnapshot[])
            : [],
          lineTotalKobo: l.lineTotalKobo,
        })),
        subtotalKobo: sale.subtotalKobo,
        discountKobo: sale.discountKobo,
        totalKobo: sale.totalKobo,
        customerId: sale.customerId,
        customerName,
        creditKobo: sale.creditKobo,
        payments: payments.map((p) => ({
          method: p.method,
          amountKobo: p.amountKobo,
          reference: p.reference,
          terminalId: p.terminalId,
          terminalName: p.terminalName,
        })),
        changeKobo: Math.max(0, paidKobo - sale.totalKobo),
      };
    }),

  /** Return a finished sale — manager and above only. */
  returnSale: roleProcedure("manager")
    .input(
      z.object({
        saleId: z.number().int().positive(),
        reason: z.string().trim().min(3).max(255),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const [sale] = await db
        .select()
        .from(sales)
        .where(eq(sales.id, input.saleId))
        .limit(1);
      if (!sale) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Sale not found" });
      }
      if (sale.status === "returned") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This sale was already returned",
        });
      }
      await db.transaction(async (tx) => {
        await tx
          .update(sales)
          .set({
            status: "returned",
            returnedAt: new Date(),
            returnedById: ctx.staff.sub,
            returnReason: input.reason,
          })
          .where(eq(sales.id, sale.id));
        // Returning a credit sale cancels the debt it created. Repayments
        // aren't allocated per-sale, so the balance is simply floored at 0.
        if (sale.creditKobo > 0 && sale.customerId) {
          await tx
            .update(customers)
            .set({
              creditBalanceKobo: sql`greatest(0, credit_balance_kobo - ${sale.creditKobo})`,
            })
            .where(eq(customers.id, sale.customerId));
        }
      });
      void logEvent(getDb(), {
        actor: ctx.staff,
        action: "sale.return",
        entityType: "sale",
        entityId: sale.id,
        detail: `Receipt ${sale.receiptNo} returned${input.reason ? ` — ${input.reason}` : ""}`,
      });
      return { ok: true as const, saleId: sale.id, receiptNo: sale.receiptNo };
    }),
});
