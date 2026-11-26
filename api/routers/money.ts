import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { createRouter } from "../middleware";
import { permProcedure } from "../auth/guards";
import { getDb } from "../queries/connection";
import { logEvent } from "../audit";
import { formatNaira } from "@contracts/money";
import {
  customerPayments,
  drawerCounts,
  expenses,
  salePayments,
  sales,
  users,
} from "@db/schema";
import { roleHas } from "../permissions";
import type { StaffRole } from "@contracts/roles";

/** Server-local midnight today — same convention as terminals.todayStats. */
function todayStart(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

const EXPENSE_CATEGORIES = [
  "supplies",
  "utilities",
  "wages",
  "rent",
  "transport",
  "equipment",
  "other",
] as const;

/** Sum today's cash movements and derive what the drawer should hold. */
async function expectedCashKobo(db: ReturnType<typeof getDb>, dayStart: Date) {
  const [saleRows] = await db
    .select({ total: sql<number>`coalesce(sum(${salePayments.amountKobo}), 0)` })
    .from(salePayments)
    .innerJoin(sales, eq(sales.id, salePayments.saleId))
    .where(
      and(
        eq(salePayments.method, "cash"),
        gte(sales.soldAt, dayStart),
        eq(sales.status, "completed"),
        isNull(sales.returnedAt),
      ),
    );
  const [repayRows] = await db
    .select({ total: sql<number>`coalesce(sum(${customerPayments.amountKobo}), 0)` })
    .from(customerPayments)
    .where(and(eq(customerPayments.method, "cash"), gte(customerPayments.createdAt, dayStart)));
  const [expenseRows] = await db
    .select({ total: sql<number>`coalesce(sum(${expenses.amountKobo}), 0)` })
    .from(expenses)
    .where(
      and(
        eq(expenses.method, "cash"),
        gte(expenses.expenseAt, dayStart),
        isNull(expenses.voidedAt),
      ),
    );
  const cashSales = Number(saleRows?.total ?? 0);
  const cashRepayments = Number(repayRows?.total ?? 0);
  const cashExpenses = Number(expenseRows?.total ?? 0);
  return {
    cashSalesKobo: cashSales,
    cashRepaymentsKobo: cashRepayments,
    cashExpensesKobo: cashExpenses,
    expectedKobo: cashSales + cashRepayments - cashExpenses,
  };
}

function toExpense(row: typeof expenses.$inferSelect, staffName: string | null, voidedByName: string | null) {
  return {
    expenseId: row.id,
    category: row.category,
    amountKobo: row.amountKobo,
    note: row.note,
    method: row.method,
    staffName,
    expenseAt: row.expenseAt.toISOString(),
    voidedAt: row.voidedAt ? row.voidedAt.toISOString() : null,
    voidedByName,
    voidReason: row.voidReason,
  };
}

/**
 * Expenses & cash drawer. Any staff member can record an expense or count
 * the drawer; voiding an expense and viewing count history are manager+.
 * Only CASH expenses/collections affect the expected drawer balance.
 */
export const moneyRouter = createRouter({
  expenses: createRouter({
    create: permProcedure("expenses", "manage")
      .input(
        z.object({
          category: z.enum(EXPENSE_CATEGORIES),
          amount: z.number().positive().max(10_000_000),
          note: z.string().trim().min(3).max(500),
          method: z.enum(["cash", "bank_pos", "transfer"]),
          /** Manager+ only: record an expense as of an earlier time today/past. */
          expenseAt: z.coerce.date().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const db = getDb();
        const amountKobo = Math.round(input.amount * 100);
        if (amountKobo <= 0) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Amount must be at least ₦0.01." });
        }
        const [result] = await db.insert(expenses).values({
          category: input.category,
          amountKobo,
          note: input.note,
          method: input.method,
          staffId: ctx.staff.sub,
          ...(input.expenseAt ? { expenseAt: input.expenseAt } : {}),
        });
        void logEvent(db, {
          actor: ctx.staff,
          action: "expense.create",
          entityType: "expense",
          entityId: Number(result.insertId),
          detail: `${input.category} · ${formatNaira(amountKobo)} · ${input.method} — ${input.note.slice(0, 120)}`,
        });
        return { ok: true, expenseId: Number(result.insertId), amountKobo };
      }),

    list: permProcedure("expenses", "view")
      .input(
        z
          .object({
            limit: z.number().int().min(1).max(200).default(100),
            /** Managers see everyone's expenses by default; staff always see their own. */
            all: z.boolean().default(true),
          })
          .optional(),
      )
      .query(async ({ ctx, input }) => {
        const db = getDb();
        const showAll = input?.all ?? true;
        const rows = await db
          .select({ expense: expenses, staffName: users.name })
          .from(expenses)
          .leftJoin(users, eq(users.id, expenses.staffId))
          .where(showAll ? undefined : eq(expenses.staffId, ctx.staff.sub))
          .orderBy(desc(expenses.expenseAt))
          .limit(input?.limit ?? 100);
        const voiderIds = [...new Set(rows.map((r) => r.expense.voidedById).filter(Boolean))] as number[];
        const voiders = voiderIds.length
          ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, voiderIds))
          : [];
        const voiderName = new Map(voiders.map((v) => [v.id, v.name]));
        return {
          isManager: await roleHas(
            db,
            ctx.staff.role as StaffRole,
            "expenses",
            "manage",
          ),
          expenses: rows.map((r) =>
            toExpense(r.expense, r.staffName, r.expense.voidedById ? voiderName.get(r.expense.voidedById) ?? null : null),
          ),
        };
      }),

    void: permProcedure("expenses", "manage")
      .input(z.object({ expenseId: z.number().int().positive(), reason: z.string().trim().min(3).max(255) }))
      .mutation(async ({ ctx, input }) => {
        const db = getDb();
        const result = await db.transaction(async (tx) => {
          const [row] = await tx.select().from(expenses).where(eq(expenses.id, input.expenseId)).for("update");
          if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Expense not found." });
          if (row.voidedAt) throw new TRPCError({ code: "BAD_REQUEST", message: "This expense is already voided." });
          await tx
            .update(expenses)
            .set({ voidedAt: new Date(), voidedById: ctx.staff.sub, voidReason: input.reason })
            .where(eq(expenses.id, row.id));
          void logEvent(db, {
            actor: ctx.staff,
            action: "expense.void",
            entityType: "expense",
            entityId: row.id,
            detail: `${row.category} · ${formatNaira(row.amountKobo)} voided — ${input.reason}`,
          });
          return { ok: true, expenseId: row.id };
        });
        return result;
      }),
  }),

  drawer: createRouter({
    summary: permProcedure("drawer", "view").query(async () => {
      const db = getDb();
      return expectedCashKobo(db, todayStart());
    }),

    count: permProcedure("drawer", "manage")
      .input(z.object({ counted: z.number().min(0).max(100_000_000), note: z.string().trim().max(255).optional() }))
      .mutation(async ({ ctx, input }) => {
        const db = getDb();
        const dayStart = todayStart();
        const summary = await expectedCashKobo(db, dayStart);
        const countedKobo = Math.round(input.counted * 100);
        const [result] = await db.insert(drawerCounts).values({
          countedKobo,
          expectedKobo: summary.expectedKobo,
          note: input.note ?? null,
          countedById: ctx.staff.sub,
        });
        void logEvent(db, {
          actor: ctx.staff,
          action: "drawer.count",
          entityType: "drawer",
          entityId: Number(result.insertId),
          detail: `Counted ${formatNaira(countedKobo)} vs expected ${formatNaira(summary.expectedKobo)} (${countedKobo === summary.expectedKobo ? "balanced" : countedKobo > summary.expectedKobo ? "over" : "short"})`,
        });
        return {
          ok: true,
          countId: Number(result.insertId),
          countedKobo,
          expectedKobo: summary.expectedKobo,
          diffKobo: countedKobo - summary.expectedKobo,
        };
      }),

    counts: permProcedure("drawer", "view")
      .input(z.object({ limit: z.number().int().min(1).max(100).default(30) }).optional())
      .query(async ({ input }) => {
        const db = getDb();
        const rows = await db
          .select({ count: drawerCounts, staffName: users.name })
          .from(drawerCounts)
          .leftJoin(users, eq(users.id, drawerCounts.countedById))
          .orderBy(desc(drawerCounts.createdAt))
          .limit(input?.limit ?? 30);
        return {
          counts: rows.map((r) => ({
            countId: r.count.id,
            countedKobo: r.count.countedKobo,
            expectedKobo: r.count.expectedKobo,
            diffKobo: r.count.countedKobo - r.count.expectedKobo,
            note: r.count.note,
            staffName: r.staffName,
            countedAt: r.count.createdAt.toISOString(),
          })),
        };
      }),
  }),
});
