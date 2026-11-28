import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, gte, inArray, isNotNull, isNull, like, lt, or, sql } from "drizzle-orm";
import { createRouter } from "../middleware";
import { permProcedure } from "../auth/guards";
import { getDb } from "../queries/connection";
import { logEvent } from "../audit";
import { formatNaira, type ExpenseApprovalPolicy } from "@contracts/money";
import { toExpenseApprovalPolicy } from "@contracts/settings";
import {
  customerPayments,
  drawerCounts,
  expenses,
  salePayments,
  sales,
  settings,
  users,
} from "@db/schema";
import { roleHas } from "../permissions";
import { postToLedger } from "../ledger";
import type { StaffRole } from "@contracts/roles";

/** Server-local midnight today — same convention as terminals.todayStats. */
function todayStart(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Server-local midnight for a YYYY-MM-DD string (never `new Date(iso)` — that parses as UTC). */
function dayStart(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const EXPENSE_STATUS_FILTERS = ["pending", "approved", "rejected", "voided"] as const;

const EXPENSE_CATEGORIES = [
  "supplies",
  "utilities",
  "wages",
  "rent",
  "transport",
  "equipment",
  "other",
] as const;

/** Sum cash movements in [from, to) and derive what the drawer should hold. */
async function expectedCashKobo(db: ReturnType<typeof getDb>, from: Date, to?: Date) {
  const saleConds = [
    eq(salePayments.method, "cash"),
    gte(sales.soldAt, from),
    eq(sales.status, "completed"),
    isNull(sales.returnedAt),
  ];
  const repayConds = [eq(customerPayments.method, "cash"), gte(customerPayments.createdAt, from)];
  const expenseConds = [
    eq(expenses.method, "cash"),
    // Only APPROVED expenses touch the drawer — pending ones are not
    // money-out yet, rejected ones never were.
    eq(expenses.status, "approved"),
    gte(expenses.expenseAt, from),
    isNull(expenses.voidedAt),
  ];
  if (to) {
    saleConds.push(lt(sales.soldAt, to));
    repayConds.push(lt(customerPayments.createdAt, to));
    expenseConds.push(lt(expenses.expenseAt, to));
  }
  const [saleRows] = await db
    .select({ total: sql<number>`coalesce(sum(${salePayments.amountKobo}), 0)` })
    .from(salePayments)
    .innerJoin(sales, eq(sales.id, salePayments.saleId))
    .where(and(...saleConds));
  const [repayRows] = await db
    .select({ total: sql<number>`coalesce(sum(${customerPayments.amountKobo}), 0)` })
    .from(customerPayments)
    .where(and(...repayConds));
  const [expenseRows] = await db
    .select({ total: sql<number>`coalesce(sum(${expenses.amountKobo}), 0)` })
    .from(expenses)
    .where(and(...expenseConds));
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

function toExpense(
  row: typeof expenses.$inferSelect,
  staffName: string | null,
  voidedByName: string | null,
  decidedByName: string | null = null,
) {
  return {
    expenseId: row.id,
    category: row.category,
    amountKobo: row.amountKobo,
    note: row.note,
    method: row.method,
    staffName,
    expenseAt: row.expenseAt.toISOString(),
    status: row.status,
    decidedByName,
    decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
    rejectReason: row.rejectReason,
    voidedAt: row.voidedAt ? row.voidedAt.toISOString() : null,
    voidedByName,
    voidReason: row.voidReason,
  };
}

/** Read the approval policy from the settings table (defaults: required, no threshold). */
async function approvalPolicy(db: ReturnType<typeof getDb>): Promise<ExpenseApprovalPolicy> {
  const rows = await db
    .select({ key: settings.key, value: settings.value })
    .from(settings)
    .where(
      inArray(settings.key, ["expense_approval_required", "expense_approval_threshold_kobo"]),
    );
  return toExpenseApprovalPolicy(rows);
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
        // Approval workflow (v29): staff without the expenseApprovals grant
        // record expenses as PENDING — they don't touch the drawer or reports
        // until an approver signs off. Auto-approve when the policy is off,
        // when the amount is below the configured threshold, or when the
        // creator can approve expenses themselves.
        const [policy, canApprove] = await Promise.all([
          approvalPolicy(db),
          roleHas(db, ctx.staff.role as StaffRole, "expenseApprovals", "manage"),
        ]);
        const autoApproved =
          !policy.required || amountKobo < policy.thresholdKobo || canApprove;
        const status = autoApproved ? ("approved" as const) : ("pending" as const);
        const [result] = await db.insert(expenses).values({
          category: input.category,
          amountKobo,
          note: input.note,
          method: input.method,
          staffId: ctx.staff.sub,
          status,
          ...(input.expenseAt ? { expenseAt: input.expenseAt } : {}),
        });
        // Money ledger (v36): an approved expense is money leaving the
        // account that paid it. Pending expenses post on approval instead.
        if (status === "approved") {
          await postToLedger(db, [{
            method: input.method,
            direction: "out",
            amountKobo,
            kind: "expense",
            refType: "expense",
            refId: String(Number(result.insertId)),
            note: `${input.category} — ${input.note.slice(0, 100)}`,
            staffId: ctx.staff.sub,
          }]);
        }
        void logEvent(db, {
          actor: ctx.staff,
          action: "expense.create",
          entityType: "expense",
          entityId: Number(result.insertId),
          detail: `${input.category} · ${formatNaira(amountKobo)} · ${input.method}${status === "pending" ? " · PENDING approval" : ""} — ${input.note.slice(0, 120)}`,
        });
        return { ok: true, expenseId: Number(result.insertId), amountKobo, status };
      }),

    list: permProcedure("expenses", "view")
      .input(
        z
          .object({
            limit: z.number().int().min(1).max(200).default(100),
            /** Managers see everyone's expenses by default; staff always see their own. */
            all: z.boolean().default(true),
            /** v33: search note text, filter by category/method/status/date range, paginate. */
            q: z.string().trim().max(120).optional(),
            category: z.enum(EXPENSE_CATEGORIES).optional(),
            method: z.enum(["cash", "bank_pos", "transfer"]).optional(),
            status: z.enum(EXPENSE_STATUS_FILTERS).optional(),
            /** v36: filter to one staff member's expenses (any role with view). */
            staffId: z.number().int().positive().optional(),
            /** YYYY-MM-DD, server-local days (inclusive). */
            from: dateStr.optional(),
            to: dateStr.optional(),
            page: z.number().int().min(1).optional(),
            pageSize: z.number().int().min(5).max(100).optional(),
          })
          .nullish(),
      )
      .query(async ({ ctx, input }) => {
        const db = getDb();
        const showAll = input?.all ?? true;

        const conditions = [];
        if (!showAll) conditions.push(eq(expenses.staffId, ctx.staff.sub));
        // v36: explicit per-person filter — narrows even a manager's "all" view
        // to one staff member (who recorded the expense).
        if (input?.staffId !== undefined) {
          conditions.push(eq(expenses.staffId, input.staffId));
        }
        if (input?.q) {
          const needle = `%${input.q.replace(/[%_]/g, "")}%`;
          const qCond = or(like(expenses.note, needle), like(expenses.category, needle));
          if (qCond) conditions.push(qCond);
        }
        if (input?.category) conditions.push(eq(expenses.category, input.category));
        if (input?.method) conditions.push(eq(expenses.method, input.method));
        if (input?.status === "voided") conditions.push(isNotNull(expenses.voidedAt));
        else if (input?.status === "approved") {
          const approvedCond = and(eq(expenses.status, "approved"), isNull(expenses.voidedAt));
          if (approvedCond) conditions.push(approvedCond);
        } else if (input?.status) conditions.push(eq(expenses.status, input.status));
        if (input?.from) conditions.push(gte(expenses.expenseAt, dayStart(input.from)));
        if (input?.to) {
          const end = dayStart(input.to);
          end.setDate(end.getDate() + 1);
          conditions.push(lt(expenses.expenseAt, end));
        }
        const where = conditions.length ? and(...conditions) : undefined;

        // Paginated when page/pageSize given; otherwise the legacy flat limit.
        const paged = input?.page !== undefined || input?.pageSize !== undefined;
        const page = input?.page ?? 1;
        const pageSize = input?.pageSize ?? 25;

        const baseQuery = db
          .select({ expense: expenses, staffName: users.name })
          .from(expenses)
          .leftJoin(users, eq(users.id, expenses.staffId))
          .where(where)
          .orderBy(desc(expenses.expenseAt), desc(expenses.id));

        const [rows, countRows, sumRows] = await Promise.all([
          paged ? baseQuery.limit(pageSize).offset((page - 1) * pageSize) : baseQuery.limit(input?.limit ?? 100),
          db.select({ n: sql<number>`count(*)` }).from(expenses).where(where),
          // Money actually gone within the current filter: approved and not voided.
          db
            .select({ total: sql<number>`coalesce(sum(${expenses.amountKobo}), 0)` })
            .from(expenses)
            .where(
              and(where, eq(expenses.status, "approved"), isNull(expenses.voidedAt)),
            ),
        ]);

        const voiderIds = [...new Set(rows.map((r) => r.expense.voidedById).filter(Boolean))] as number[];
        const deciderIds = [...new Set(rows.map((r) => r.expense.decidedById).filter(Boolean))] as number[];
        const nameIds = [...new Set([...voiderIds, ...deciderIds])];
        const nameRows = nameIds.length
          ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, nameIds))
          : [];
        const nameOf = new Map(nameRows.map((v) => [v.id, v.name]));
        return {
          isManager: await roleHas(
            db,
            ctx.staff.role as StaffRole,
            "expenses",
            "manage",
          ),
          expenses: rows.map((r) =>
            toExpense(
              r.expense,
              r.staffName,
              r.expense.voidedById ? nameOf.get(r.expense.voidedById) ?? null : null,
              r.expense.decidedById ? nameOf.get(r.expense.decidedById) ?? null : null,
            ),
          ),
          total: Number(countRows[0]?.n ?? 0),
          approvedTotalKobo: Number(sumRows[0]?.total ?? 0),
          page,
          pageSize,
        };
      }),

    /** The approval queue — every expense waiting for sign-off, oldest first. */
    pendingQueue: permProcedure("expenseApprovals", "manage").query(async () => {
      const db = getDb();
      const rows = await db
        .select({ expense: expenses, staffName: users.name })
        .from(expenses)
        .leftJoin(users, eq(users.id, expenses.staffId))
        .where(eq(expenses.status, "pending"))
        .orderBy(expenses.expenseAt)
        .limit(100);
      return { pending: rows.map((r) => toExpense(r.expense, r.staffName, null)) };
    }),

    approve: permProcedure("expenseApprovals", "manage")
      .input(z.object({ expenseId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        const db = getDb();
        return db.transaction(async (tx) => {
          const [row] = await tx.select().from(expenses).where(eq(expenses.id, input.expenseId)).for("update");
          if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Expense not found." });
          if (row.status !== "pending") {
            throw new TRPCError({ code: "BAD_REQUEST", message: `This expense is already ${row.status}.` });
          }
          if (row.staffId === ctx.staff.sub) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "You cannot approve your own expense — another approver must sign it off." });
          }
          await tx
            .update(expenses)
            .set({ status: "approved", decidedById: ctx.staff.sub, decidedAt: new Date() })
            .where(eq(expenses.id, row.id));
          // Money ledger (v36): approval is the moment the money leaves.
          await postToLedger(tx, [{
            method: row.method,
            direction: "out",
            amountKobo: row.amountKobo,
            kind: "expense",
            refType: "expense",
            refId: String(row.id),
            note: `${row.category} — ${row.note.slice(0, 100)}`,
            staffId: row.staffId,
          }]);
          void logEvent(db, {
            actor: ctx.staff,
            action: "expense.approve",
            entityType: "expense",
            entityId: row.id,
            detail: `${row.category} · ${formatNaira(row.amountKobo)} approved — ${row.note.slice(0, 120)}`,
          });
          return { ok: true, expenseId: row.id };
        });
      }),

    reject: permProcedure("expenseApprovals", "manage")
      .input(z.object({ expenseId: z.number().int().positive(), reason: z.string().trim().min(3).max(255) }))
      .mutation(async ({ ctx, input }) => {
        const db = getDb();
        return db.transaction(async (tx) => {
          const [row] = await tx.select().from(expenses).where(eq(expenses.id, input.expenseId)).for("update");
          if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Expense not found." });
          if (row.status !== "pending") {
            throw new TRPCError({ code: "BAD_REQUEST", message: `This expense is already ${row.status}.` });
          }
          if (row.staffId === ctx.staff.sub) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "You cannot reject your own expense — another approver must decide it." });
          }
          await tx
            .update(expenses)
            .set({ status: "rejected", decidedById: ctx.staff.sub, decidedAt: new Date(), rejectReason: input.reason })
            .where(eq(expenses.id, row.id));
          void logEvent(db, {
            actor: ctx.staff,
            action: "expense.reject",
            entityType: "expense",
            entityId: row.id,
            detail: `${row.category} · ${formatNaira(row.amountKobo)} rejected — ${input.reason}`,
          });
          return { ok: true, expenseId: row.id };
        });
      }),

    void: permProcedure("expenses", "manage")
      .input(z.object({ expenseId: z.number().int().positive(), reason: z.string().trim().min(3).max(255) }))
      .mutation(async ({ ctx, input }) => {
        const db = getDb();
        const result = await db.transaction(async (tx) => {
          const [row] = await tx.select().from(expenses).where(eq(expenses.id, input.expenseId)).for("update");
          if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Expense not found." });
          if (row.voidedAt) throw new TRPCError({ code: "BAD_REQUEST", message: "This expense is already voided." });
          if (row.status === "pending") {
            throw new TRPCError({ code: "BAD_REQUEST", message: "This expense is still waiting for approval — it must be approved or rejected first." });
          }
          if (row.status === "rejected") {
            throw new TRPCError({ code: "BAD_REQUEST", message: "Rejected expenses never counted — there is nothing to void." });
          }
          await tx
            .update(expenses)
            .set({ voidedAt: new Date(), voidedById: ctx.staff.sub, voidReason: input.reason })
            .where(eq(expenses.id, row.id));
          // Money ledger (v36): voiding refunds the money back into the
          // account — a reversing in-row, the ledger stays immutable.
          await postToLedger(tx, [{
            method: row.method,
            direction: "in",
            amountKobo: row.amountKobo,
            kind: "expense",
            refType: "expense_void",
            refId: String(row.id),
            note: `Void reversal — ${row.note.slice(0, 90)}`,
            staffId: ctx.staff.sub,
          }]);
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
    summary: permProcedure("drawer", "view")
      .input(
        z
          .object({
            /** YYYY-MM-DD, server-local days (inclusive). Default: today. */
            from: dateStr.optional(),
            to: dateStr.optional(),
          })
          .nullish(),
      )
      .query(async ({ input }) => {
        const db = getDb();
        const from = input?.from ? dayStart(input.from) : todayStart();
        let to: Date | undefined;
        if (input?.to) {
          to = dayStart(input.to);
          to.setDate(to.getDate() + 1);
        } else if (input?.from) {
          to = new Date(from);
          to.setDate(to.getDate() + 1);
        }
        const summary = await expectedCashKobo(db, from, to);
        return { ...summary, from: from.toISOString(), to: to ? to.toISOString() : null };
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
      .input(
        z
          .object({
            limit: z.number().int().min(1).max(100).default(30),
            /** YYYY-MM-DD, server-local days (inclusive). */
            from: dateStr.optional(),
            to: dateStr.optional(),
          })
          .nullish(),
      )
      .query(async ({ input }) => {
        const db = getDb();
        const conditions = [];
        if (input?.from) conditions.push(gte(drawerCounts.createdAt, dayStart(input.from)));
        if (input?.to) {
          const end = dayStart(input.to);
          end.setDate(end.getDate() + 1);
          conditions.push(lt(drawerCounts.createdAt, end));
        }
        const where = conditions.length ? and(...conditions) : undefined;
        const [rows, countRows] = await Promise.all([
          db
            .select({ count: drawerCounts, staffName: users.name })
            .from(drawerCounts)
            .leftJoin(users, eq(users.id, drawerCounts.countedById))
            .where(where)
            .orderBy(desc(drawerCounts.createdAt))
            .limit(input?.limit ?? 30),
          db.select({ n: sql<number>`count(*)` }).from(drawerCounts).where(where),
        ]);
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
          total: Number(countRows[0]?.n ?? 0),
        };
      }),
  }),
});
