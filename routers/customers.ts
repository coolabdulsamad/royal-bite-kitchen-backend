import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, gt, like, or, sql } from "drizzle-orm";
import { createRouter } from "../middleware";
import { permProcedure } from "../auth/guards";
import { getDb } from "../queries/connection";
import { logEvent } from "../audit";
import { formatNaira } from "@contracts/money";
import { customerPayments, customers, sales, users } from "@db/schema";
import { postToLedger } from "../ledger";
import { nairaToKobo } from "@contracts/money";

/** MySQL duplicate-key errors arrive wrapped by drizzle — walk the cause chain. */
function isDuplicate(err: unknown): boolean {
  let cur: unknown = err;
  for (let depth = 0; depth < 6 && cur; depth++) {
    const e = cur as { code?: string; errno?: number; message?: string };
    if (
      e.code === "ER_DUP_ENTRY" ||
      e.errno === 1062 ||
      (typeof e.message === "string" && e.message.includes("Duplicate entry"))
    ) {
      return true;
    }
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}

// ── Full customer profile ──────────────────────────────────────────────────
const dateStr = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

/** Optional profile fields recorded for a customer. */
const customerProfileInput = {
  email: z.string().trim().max(120).nullish(),
  gender: z.enum(["male", "female", "other"]).nullish(),
  dateOfBirth: dateStr.nullish(),
  address: z.string().trim().max(255).nullish(),
  city: z.string().trim().max(60).nullish(),
  state: z.string().trim().max(60).nullish(),
  alternatePhone: z.string().trim().max(40).nullish(),
  occupation: z.string().trim().max(80).nullish(),
  guarantorName: z.string().trim().max(120).nullish(),
  guarantorPhone: z.string().trim().max(40).nullish(),
  referralSource: z.string().trim().max(80).nullish(),
} as const;

const PROFILE_FIELD_NAMES = Object.keys(customerProfileInput) as Array<
  keyof typeof customerProfileInput
>;

/** "" → null so optional text fields clear cleanly. */
function profileValues(input: Record<string, unknown>) {
  const out: Record<string, string | null> = {};
  for (const key of PROFILE_FIELD_NAMES) {
    const v = input[key];
    if (v === undefined) continue;
    out[key] = typeof v === "string" && v.trim() === "" ? null : (v as string | null);
  }
  return out;
}

/**
 * Customers & credit tabs. Any staff member can look customers up, add a new
 * one mid-checkout and record a repayment (money in); editing, deactivating
 * and reactivating profiles is manager+.
 */
export const customersRouter = createRouter({
  list: permProcedure("customers", "view")
    .input(
      z.object({
        search: z.string().trim().max(120).optional(),
        owingOnly: z.boolean().default(false),
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(100).default(50),
      }),
    )
    .query(async ({ input }) => {
      const db = getDb();
      const conditions = [];
      if (input.search) {
        const q = `%${input.search}%`;
        conditions.push(or(like(customers.name, q), like(customers.phone, q)));
      }
      if (input.owingOnly) conditions.push(gt(customers.creditBalanceKobo, 0));
      const where = conditions.length ? and(...conditions) : undefined;

      const [rows, [countRow]] = await Promise.all([
        db
          .select({
            id: customers.id,
            name: customers.name,
            phone: customers.phone,
            notes: customers.notes,
            creditBalanceKobo: customers.creditBalanceKobo,
            active: customers.active,
            createdAt: customers.createdAt,
          })
          .from(customers)
          .where(where)
          // Owing customers first — they're the ones staff need one tap away.
          .orderBy(desc(customers.creditBalanceKobo), asc(customers.name))
          .limit(input.pageSize)
          .offset((input.page - 1) * input.pageSize),
        db
          .select({ total: sql<number>`count(*)` })
          .from(customers)
          .where(where),
      ]);

      return {
        rows: rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
        total: Number(countRow?.total ?? 0),
        page: input.page,
        pageSize: input.pageSize,
      };
    }),

  create: permProcedure("customers", "manage")
    .input(
      z.object({
        name: z.string().trim().min(2).max(120),
        phone: z.string().trim().min(5).max(40).optional(),
        notes: z.string().trim().max(255).optional(),
        ...customerProfileInput,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      try {
        const [row] = await db
          .insert(customers)
          .values({
            name: input.name,
            phone: input.phone || null,
            notes: input.notes || null,
            ...profileValues(input),
            createdById: ctx.staff.sub,
          })
          .$returningId();
        void logEvent(db, {
          actor: ctx.staff,
          action: "customer.create",
          entityType: "customer",
          entityId: row.id,
          detail: `Customer ${input.name} added`,
        });
        return { ok: true as const, id: row.id };
      } catch (err) {
        if (isDuplicate(err)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "That phone number already belongs to another customer",
          });
        }
        throw err;
      }
    }),

  update: permProcedure("customers", "manage")
    .input(
      z.object({
        id: z.number().int().positive(),
        name: z.string().trim().min(2).max(120).optional(),
        phone: z.string().trim().min(5).max(40).nullish(),
        notes: z.string().trim().max(255).nullish(),
        active: z.boolean().optional(),
        ...customerProfileInput,
      }),
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      try {
        const [result] = await db
          .update(customers)
          .set({
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.phone !== undefined ? { phone: input.phone || null } : {}),
            ...(input.notes !== undefined ? { notes: input.notes || null } : {}),
            ...(input.active !== undefined ? { active: input.active } : {}),
            ...profileValues(input),
          })
          .where(eq(customers.id, input.id));
        if (result.affectedRows === 0) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Customer not found" });
        }
        return { ok: true as const, id: input.id };
      } catch (err) {
        if (isDuplicate(err)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "That phone number already belongs to another customer",
          });
        }
        throw err;
      }
    }),

  /**
   * Profile + full credit ledger: every sale that left money on the tab and
   * every repayment, newest first. Any staff can view (they collect debts).
   */
  detail: permProcedure("customers", "view")
    .input(z.object({ customerId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const db = getDb();
      const [customer] = await db
        .select()
        .from(customers)
        .where(eq(customers.id, input.customerId))
        .limit(1);
      if (!customer) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Customer not found" });
      }

      const [creditSales, repayments] = await Promise.all([
        db
          .select({
            saleId: sales.id,
            receiptNo: sales.receiptNo,
            soldAt: sales.soldAt,
            totalKobo: sales.totalKobo,
            creditKobo: sales.creditKobo,
            status: sales.status,
            cashierName: users.name,
          })
          .from(sales)
          .innerJoin(users, eq(users.id, sales.staffId))
          .where(
            and(eq(sales.customerId, input.customerId), gt(sales.creditKobo, 0)),
          )
          .orderBy(desc(sales.soldAt))
          .limit(50),
        db
          .select({
            id: customerPayments.id,
            createdAt: customerPayments.createdAt,
            amountKobo: customerPayments.amountKobo,
            method: customerPayments.method,
            reference: customerPayments.reference,
            note: customerPayments.note,
            receivedByName: users.name,
          })
          .from(customerPayments)
          .innerJoin(users, eq(users.id, customerPayments.receivedById))
          .where(eq(customerPayments.customerId, input.customerId))
          .orderBy(desc(customerPayments.createdAt))
          .limit(50),
      ]);

      return {
        customer: {
          id: customer.id,
          name: customer.name,
          phone: customer.phone,
          notes: customer.notes,
          email: customer.email,
          gender: customer.gender,
          dateOfBirth: customer.dateOfBirth,
          address: customer.address,
          city: customer.city,
          state: customer.state,
          alternatePhone: customer.alternatePhone,
          occupation: customer.occupation,
          guarantorName: customer.guarantorName,
          guarantorPhone: customer.guarantorPhone,
          referralSource: customer.referralSource,
          creditBalanceKobo: customer.creditBalanceKobo,
          active: customer.active,
          createdAt: customer.createdAt.toISOString(),
        },
        creditSales: creditSales.map((s) => ({
          ...s,
          soldAt: s.soldAt.toISOString(),
        })),
        repayments: repayments.map((p) => ({
          ...p,
          createdAt: p.createdAt.toISOString(),
        })),
      };
    }),

  /**
   * Record a debt repayment. The conditional UPDATE means two tills repaying
   * at once can never push the balance negative — the loser gets a friendly
   * 400 and the whole repayment rolls back.
   */
  repay: permProcedure("customers", "manage")
    .input(
      z.object({
        customerId: z.number().int().positive(),
        /** Amount in NAIRA. */
        amount: z.number().positive().max(100_000_000),
        method: z.enum(["cash", "bank_pos", "transfer"]),
        reference: z.string().trim().max(120).optional(),
        note: z.string().trim().max(255).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const amountKobo = nairaToKobo(input.amount);

      const [customer] = await db
        .select()
        .from(customers)
        .where(eq(customers.id, input.customerId))
        .limit(1);
      if (!customer) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Customer not found" });
      }
      if (!customer.active) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This customer is deactivated — a manager must reactivate them first",
        });
      }

      const repaid = await db.transaction(async (tx) => {
        const [updated] = await tx
          .update(customers)
          .set({ creditBalanceKobo: sql`credit_balance_kobo - ${amountKobo}` })
          .where(
            and(
              eq(customers.id, input.customerId),
              gt(customers.creditBalanceKobo, 0),
              sql`credit_balance_kobo >= ${amountKobo}`,
            ),
          );
        if (updated.affectedRows === 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `That repayment is more than the customer's balance — they owe ₦${(customer.creditBalanceKobo / 100).toLocaleString("en-NG")}`,
          });
        }
        await tx.insert(customerPayments).values({
          customerId: input.customerId,
          amountKobo,
          method: input.method,
          reference: input.reference || null,
          note: input.note || null,
          receivedById: ctx.staff.sub,
        });
        // Money ledger (v36): the repayment is real money coming in.
        await postToLedger(tx, [{
          method: input.method,
          direction: "in",
          amountKobo,
          kind: "credit_repayment",
          refType: "customer",
          refId: String(input.customerId),
          note: `Debt repayment — ${customer.name}`,
          staffId: ctx.staff.sub,
        }]);
        return {
          ok: true as const,
          customerId: input.customerId,
          newBalanceKobo: customer.creditBalanceKobo - amountKobo,
          customerName: customer.name,
        };
      });
      void logEvent(db, {
        actor: ctx.staff,
        action: "customer.repay",
        entityType: "customer",
        entityId: repaid.customerId,
        detail: `${repaid.customerName} repaid ${formatNaira(amountKobo)} via ${input.method} · balance now ${formatNaira(repaid.newBalanceKobo)}`,
      });
      return {
        ok: true as const,
        customerId: repaid.customerId,
        newBalanceKobo: repaid.newBalanceKobo,
      };
    }),
});
