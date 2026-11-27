import { z } from "zod";
import { and, desc, eq, gte, isNull, lt, sql } from "drizzle-orm";
import { createRouter } from "../middleware";
import { permProcedure } from "../auth/guards";
import { getDb } from "../queries/connection";
import {
  categories,
  expenses,
  menuItems,
  saleItems,
  salePayments,
  sales,
  users,
} from "@db/schema";

const rangeInput = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
});

/** [fromStart, toExclusive) using server-local midnights (app convention). */
export function rangeBounds(input: { from: Date; to: Date }) {
  const fromStart = new Date(input.from);
  fromStart.setHours(0, 0, 0, 0);
  const toEnd = new Date(input.to);
  toEnd.setHours(0, 0, 0, 0);
  toEnd.setDate(toEnd.getDate() + 1);
  return { fromStart, toEnd };
}

/** Completed, non-returned sales inside the range. */
export function salesInRange(fromStart: Date, toEnd: Date) {
  return and(
    eq(sales.status, "completed"),
    isNull(sales.returnedAt),
    gte(sales.soldAt, fromStart),
    lt(sales.soldAt, toEnd),
  );
}

/**
 * Sales & expense analytics. Manager+ only — every endpoint is scoped to a
 * [from, to] business-date range (inclusive both ends, server-local days).
 */
export const reportsRouter = createRouter({
  overview: permProcedure("reports", "view").input(rangeInput).query(async ({ input }) => {
    const db = getDb();
    const { fromStart, toEnd } = rangeBounds(input);

    const [saleRow] = await db
      .select({
        revenueKobo: sql<number>`coalesce(sum(${sales.totalKobo}), 0)`,
        salesCount: sql<number>`count(*)`,
        discountKobo: sql<number>`coalesce(sum(${sales.discountKobo}), 0)`,
      })
      .from(sales)
      .where(salesInRange(fromStart, toEnd));

    const [itemRow] = await db
      .select({ itemsSold: sql<number>`coalesce(sum(${saleItems.quantity}), 0)` })
      .from(saleItems)
      .innerJoin(sales, eq(sales.id, saleItems.saleId))
      .where(salesInRange(fromStart, toEnd));

    const [returnRow] = await db
      .select({ n: sql<number>`count(*)` })
      .from(sales)
      .where(
        and(
          sql`${sales.returnedAt} is not null`,
          gte(sales.soldAt, fromStart),
          lt(sales.soldAt, toEnd),
        ),
      );

    const [expenseRow] = await db
      .select({ expensesKobo: sql<number>`coalesce(sum(${expenses.amountKobo}), 0)` })
      .from(expenses)
      .where(
        and(
          isNull(expenses.voidedAt),
          eq(expenses.status, "approved"),
          gte(expenses.expenseAt, fromStart),
          lt(expenses.expenseAt, toEnd),
        ),
      );

    const revenueKobo = Number(saleRow?.revenueKobo ?? 0);
    const salesCount = Number(saleRow?.salesCount ?? 0);
    const expensesKobo = Number(expenseRow?.expensesKobo ?? 0);
    return {
      revenueKobo,
      salesCount,
      avgTicketKobo: salesCount > 0 ? Math.round(revenueKobo / salesCount) : 0,
      itemsSold: Number(itemRow?.itemsSold ?? 0),
      discountKobo: Number(saleRow?.discountKobo ?? 0),
      returnsCount: Number(returnRow?.n ?? 0),
      expensesKobo,
      netKobo: revenueKobo - expensesKobo,
    };
  }),

  daily: permProcedure("reports", "view").input(rangeInput).query(async ({ input }) => {
    const db = getDb();
    const { fromStart, toEnd } = rangeBounds(input);
    const day = sql<string>`date_format(${sales.soldAt}, '%Y-%m-%d')`.as("day");
    const rows = await db
      .select({
        day,
        revenueKobo: sql<number>`coalesce(sum(${sales.totalKobo}), 0)`,
        salesCount: sql<number>`count(*)`,
      })
      .from(sales)
      .where(salesInRange(fromStart, toEnd))
      .groupBy(sql`day`)
      .orderBy(sql`day`);
    return {
      days: rows.map((r) => ({
        date: String(r.day),
        revenueKobo: Number(r.revenueKobo),
        salesCount: Number(r.salesCount),
      })),
    };
  }),

  topItems: permProcedure("reports", "view")
    .input(rangeInput.extend({ limit: z.number().int().min(1).max(50).default(10) }))
    .query(async ({ input }) => {
      const db = getDb();
      const { fromStart, toEnd } = rangeBounds(input);
      const rows = await db
        .select({
          itemName: saleItems.itemName,
          quantity: sql<number>`coalesce(sum(${saleItems.quantity}), 0)`,
          revenueKobo: sql<number>`coalesce(sum(${saleItems.lineTotalKobo}), 0)`,
        })
        .from(saleItems)
        .innerJoin(sales, eq(sales.id, saleItems.saleId))
        .where(salesInRange(fromStart, toEnd))
        .groupBy(saleItems.itemName)
        .orderBy(desc(sql`sum(${saleItems.lineTotalKobo})`))
        .limit(input.limit);
      return {
        items: rows.map((r) => ({
          itemName: r.itemName,
          quantity: Number(r.quantity),
          revenueKobo: Number(r.revenueKobo),
        })),
      };
    }),

  paymentMethods: permProcedure("reports", "view").input(rangeInput).query(async ({ input }) => {
    const db = getDb();
    const { fromStart, toEnd } = rangeBounds(input);
    const rows = await db
      .select({
        method: salePayments.method,
        totalKobo: sql<number>`coalesce(sum(${salePayments.amountKobo}), 0)`,
        payments: sql<number>`count(*)`,
      })
      .from(salePayments)
      .innerJoin(sales, eq(sales.id, salePayments.saleId))
      .where(salesInRange(fromStart, toEnd))
      .groupBy(salePayments.method)
      .orderBy(desc(sql`sum(${salePayments.amountKobo})`));
    return {
      methods: rows.map((r) => ({
        method: r.method,
        totalKobo: Number(r.totalKobo),
        payments: Number(r.payments),
      })),
    };
  }),

  categories: permProcedure("reports", "view").input(rangeInput).query(async ({ input }) => {
    const db = getDb();
    const { fromStart, toEnd } = rangeBounds(input);
    const rows = await db
      .select({
        categoryName: categories.name,
        revenueKobo: sql<number>`coalesce(sum(${saleItems.lineTotalKobo}), 0)`,
        quantity: sql<number>`coalesce(sum(${saleItems.quantity}), 0)`,
      })
      .from(saleItems)
      .innerJoin(sales, eq(sales.id, saleItems.saleId))
      .innerJoin(menuItems, eq(menuItems.id, saleItems.itemId))
      .innerJoin(categories, eq(categories.id, menuItems.categoryId))
      .where(salesInRange(fromStart, toEnd))
      .groupBy(categories.name)
      .orderBy(desc(sql`sum(${saleItems.lineTotalKobo})`));
    return {
      categories: rows.map((r) => ({
        categoryName: r.categoryName,
        revenueKobo: Number(r.revenueKobo),
        quantity: Number(r.quantity),
      })),
    };
  }),

  staff: permProcedure("reports", "view").input(rangeInput).query(async ({ input }) => {
    const db = getDb();
    const { fromStart, toEnd } = rangeBounds(input);
    const rows = await db
      .select({
        staffName: users.name,
        staffCode: users.staffCode,
        salesCount: sql<number>`count(*)`,
        revenueKobo: sql<number>`coalesce(sum(${sales.totalKobo}), 0)`,
      })
      .from(sales)
      .innerJoin(users, eq(users.id, sales.staffId))
      .where(salesInRange(fromStart, toEnd))
      .groupBy(users.id, users.name, users.staffCode)
      .orderBy(desc(sql`sum(${sales.totalKobo})`));
    return {
      staff: rows.map((r) => ({
        staffName: r.staffName,
        staffCode: r.staffCode,
        salesCount: Number(r.salesCount),
        revenueKobo: Number(r.revenueKobo),
      })),
    };
  }),

  hours: permProcedure("reports", "view").input(rangeInput).query(async ({ input }) => {
    const db = getDb();
    const { fromStart, toEnd } = rangeBounds(input);
    const hour = sql<number>`hour(${sales.soldAt})`.as("hour");
    const rows = await db
      .select({
        hour,
        salesCount: sql<number>`count(*)`,
        revenueKobo: sql<number>`coalesce(sum(${sales.totalKobo}), 0)`,
      })
      .from(sales)
      .where(salesInRange(fromStart, toEnd))
      .groupBy(sql`hour`)
      .orderBy(sql`hour`);
    return {
      hours: rows.map((r) => ({
        hour: Number(r.hour),
        salesCount: Number(r.salesCount),
        revenueKobo: Number(r.revenueKobo),
      })),
    };
  }),

  expenseCategories: permProcedure("reports", "view").input(rangeInput).query(async ({ input }) => {
    const db = getDb();
    const { fromStart, toEnd } = rangeBounds(input);
    const rows = await db
      .select({
        category: expenses.category,
        totalKobo: sql<number>`coalesce(sum(${expenses.amountKobo}), 0)`,
        count: sql<number>`count(*)`,
      })
      .from(expenses)
      .where(
        and(
          isNull(expenses.voidedAt),
          eq(expenses.status, "approved"),
          gte(expenses.expenseAt, fromStart),
          lt(expenses.expenseAt, toEnd),
        ),
      )
      .groupBy(expenses.category)
      .orderBy(desc(sql`sum(${expenses.amountKobo})`));
    return {
      categories: rows.map((r) => ({
        category: r.category,
        totalKobo: Number(r.totalKobo),
        count: Number(r.count),
      })),
    };
  }),
});
