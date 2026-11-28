// Accounts router (v36) — the "general bank": cash on hand, bank account and
// POS settlements, with balances derived from the immutable money ledger.
// Money in/out, internal transfers (e.g. depositing till cash at the bank)
// and the full per-account transaction history live here.

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, gte, like, lt, or, sql } from "drizzle-orm";
import { createRouter } from "../middleware";
import { permProcedure } from "../auth/guards";
import { getDb } from "../queries/connection";
import { logEvent } from "../audit";
import { accounts, accountTransactions, users } from "@db/schema";
import { ledgerBalance, postToLedger } from "../ledger";
import { formatNaira } from "@contracts/money";

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

function dayStart(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function todayStart(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

const MONEY_IN_CATEGORIES = ["owner_investment", "loan_received", "other_income"] as const;
const MONEY_OUT_CATEGORIES = ["bank_charges", "owner_draw", "supplier_payment", "other_payout"] as const;

const LEDGER_KINDS = [
  "sale_payment",
  "expense",
  "transfer",
  "money_in",
  "money_out",
  "adjustment",
  "credit_repayment",
  "payroll",
] as const;

const amountField = z
  .number()
  .positive()
  .max(100_000_000)
  .transform((n) => Math.round(n * 100));

export const accountsRouter = createRouter({
  /** All accounts with derived balances + today's in/out. */
  list: permProcedure("accounts", "view").query(async () => {
    const db = getDb();
    const accts = await db.select().from(accounts).where(eq(accounts.active, true));
    const today = todayStart();
    const rows = await Promise.all(
      accts.map(async (a) => {
        const [agg] = await db
          .select({
            balance: sql<number>`coalesce(sum(case when ${accountTransactions.direction} = 'in' then ${accountTransactions.amountKobo} else -${accountTransactions.amountKobo} end), 0)`.as("b"),
            todayIn: sql<number>`coalesce(sum(case when ${accountTransactions.direction} = 'in' and ${accountTransactions.createdAt} >= ${today} then ${accountTransactions.amountKobo} else 0 end), 0)`.as("ti"),
            todayOut: sql<number>`coalesce(sum(case when ${accountTransactions.direction} = 'out' and ${accountTransactions.createdAt} >= ${today} then ${accountTransactions.amountKobo} else 0 end), 0)`.as("to_"),
            txCount: sql<number>`count(*)`.as("c"),
          })
          .from(accountTransactions)
          .where(eq(accountTransactions.accountId, a.id));
        return {
          id: a.id,
          code: a.code,
          name: a.name,
          type: a.type,
          balanceKobo: Number(agg?.balance ?? 0),
          todayInKobo: Number(agg?.todayIn ?? 0),
          todayOutKobo: Number(agg?.todayOut ?? 0),
          txCount: Number(agg?.txCount ?? 0),
        };
      }),
    );
    return {
      accounts: rows,
      totalBalanceKobo: rows.reduce((s, r) => s + r.balanceKobo, 0),
      totalTodayInKobo: rows.reduce((s, r) => s + r.todayInKobo, 0),
      totalTodayOutKobo: rows.reduce((s, r) => s + r.todayOutKobo, 0),
    };
  }),

  /** Ledger history — filters: account, kind, staff, date range, search, paging. */
  transactions: permProcedure("accounts", "view")
    .input(
      z.object({
        accountId: z.number().int().positive().optional(),
        kind: z.enum(LEDGER_KINDS).optional(),
        direction: z.enum(["in", "out"]).optional(),
        staffId: z.number().int().positive().optional(),
        from: dateStr.optional(),
        to: dateStr.optional(),
        q: z.string().trim().max(120).optional(),
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(5).max(100).default(25),
      }),
    )
    .query(async ({ input }) => {
      const db = getDb();
      const conditions = [];
      if (input.accountId !== undefined) conditions.push(eq(accountTransactions.accountId, input.accountId));
      if (input.kind) conditions.push(eq(accountTransactions.kind, input.kind));
      if (input.direction) conditions.push(eq(accountTransactions.direction, input.direction));
      if (input.staffId !== undefined) conditions.push(eq(accountTransactions.staffId, input.staffId));
      if (input.from) conditions.push(gte(accountTransactions.createdAt, dayStart(input.from)));
      if (input.to) {
        const end = dayStart(input.to);
        end.setDate(end.getDate() + 1);
        conditions.push(lt(accountTransactions.createdAt, end));
      }
      if (input.q) {
        const q = `%${input.q.replace(/[%_]/g, "")}%`;
        conditions.push(
          or(
            like(accountTransactions.note, q),
            like(accountTransactions.refId, q),
            like(accountTransactions.transferGroup, q),
          ),
        );
      }
      const where = conditions.length ? and(...conditions) : undefined;

      const [totals] = await db
        .select({
          totalIn: sql<number>`coalesce(sum(case when ${accountTransactions.direction} = 'in' then ${accountTransactions.amountKobo} else 0 end), 0)`.as("ti"),
          totalOut: sql<number>`coalesce(sum(case when ${accountTransactions.direction} = 'out' then ${accountTransactions.amountKobo} else 0 end), 0)`.as("to_"),
          count: sql<number>`count(*)`.as("c"),
        })
        .from(accountTransactions)
        .where(where);

      const rows = await db
        .select({
          id: accountTransactions.id,
          accountId: accountTransactions.accountId,
          accountName: accounts.name,
          accountCode: accounts.code,
          direction: accountTransactions.direction,
          amountKobo: accountTransactions.amountKobo,
          kind: accountTransactions.kind,
          refType: accountTransactions.refType,
          refId: accountTransactions.refId,
          transferGroup: accountTransactions.transferGroup,
          counterAccountId: accountTransactions.counterAccountId,
          note: accountTransactions.note,
          staffId: accountTransactions.staffId,
          staffName: users.name,
          createdAt: accountTransactions.createdAt,
        })
        .from(accountTransactions)
        .innerJoin(accounts, eq(accounts.id, accountTransactions.accountId))
        .leftJoin(users, eq(users.id, accountTransactions.staffId))
        .where(where)
        .orderBy(desc(accountTransactions.id))
        .limit(input.pageSize)
        .offset((input.page - 1) * input.pageSize);

      return {
        rows: rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
        total: Number(totals?.count ?? 0),
        totalInKobo: Number(totals?.totalIn ?? 0),
        totalOutKobo: Number(totals?.totalOut ?? 0),
        page: input.page,
        pageSize: input.pageSize,
      };
    }),

  /** Manual money in — owner investment, a loan received, other income. */
  moneyIn: permProcedure("accounts", "manage")
    .input(
      z.object({
        accountId: z.number().int().positive(),
        amount: amountField,
        category: z.enum(MONEY_IN_CATEGORIES),
        note: z.string().trim().min(3).max(255),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const [acct] = await db.select().from(accounts).where(eq(accounts.id, input.accountId));
      if (!acct || !acct.active) throw new TRPCError({ code: "NOT_FOUND", message: "Account not found." });
      await postToLedger(db, [{
        accountId: acct.id,
        direction: "in",
        amountKobo: input.amount,
        kind: "money_in",
        refType: input.category,
        note: input.note,
        staffId: ctx.staff.sub,
      }]);
      void logEvent(db, {
        actor: ctx.staff,
        action: "account.money_in",
        entityType: "account",
        entityId: acct.id,
        detail: `${acct.name} +${formatNaira(input.amount)} · ${input.category} — ${input.note.slice(0, 120)}`,
      });
      return { ok: true as const, balanceKobo: await ledgerBalance(db, acct.id) };
    }),

  /** Manual money out — bank charges, owner draw, a supplier paid off-book. */
  moneyOut: permProcedure("accounts", "manage")
    .input(
      z.object({
        accountId: z.number().int().positive(),
        amount: amountField,
        category: z.enum(MONEY_OUT_CATEGORIES),
        note: z.string().trim().min(3).max(255),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const [acct] = await db.select().from(accounts).where(eq(accounts.id, input.accountId));
      if (!acct || !acct.active) throw new TRPCError({ code: "NOT_FOUND", message: "Account not found." });
      const balance = await ledgerBalance(db, acct.id);
      if (input.amount > balance) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `${acct.name} only holds ${formatNaira(balance)} — you can't take out ${formatNaira(input.amount)}.`,
        });
      }
      await postToLedger(db, [{
        accountId: acct.id,
        direction: "out",
        amountKobo: input.amount,
        kind: "money_out",
        refType: input.category,
        note: input.note,
        staffId: ctx.staff.sub,
      }]);
      void logEvent(db, {
        actor: ctx.staff,
        action: "account.money_out",
        entityType: "account",
        entityId: acct.id,
        detail: `${acct.name} −${formatNaira(input.amount)} · ${input.category} — ${input.note.slice(0, 120)}`,
      });
      return { ok: true as const, balanceKobo: balance - input.amount };
    }),

  /** Internal transfer — e.g. depositing till cash at the bank (cash → bank). */
  transfer: permProcedure("accounts", "manage")
    .input(
      z.object({
        fromAccountId: z.number().int().positive(),
        toAccountId: z.number().int().positive(),
        amount: amountField,
        note: z.string().trim().max(255).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.fromAccountId === input.toAccountId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Pick two different accounts." });
      }
      const db = getDb();
      return db.transaction(async (tx) => {
        const accts = await tx.select().from(accounts).for("update");
        const from = accts.find((a) => a.id === input.fromAccountId && a.active);
        const to = accts.find((a) => a.id === input.toAccountId && a.active);
        if (!from || !to) throw new TRPCError({ code: "NOT_FOUND", message: "Account not found." });
        const balance = await ledgerBalance(tx, from.id);
        if (input.amount > balance) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `${from.name} only holds ${formatNaira(balance)} — the transfer can't exceed that.`,
          });
        }
        const group = `TRF-${Date.now()}`;
        await postToLedger(tx, [
          {
            accountId: from.id, direction: "out", amountKobo: input.amount, kind: "transfer",
            transferGroup: group, counterAccountId: to.id,
            note: input.note ?? `Transfer to ${to.name}`, staffId: ctx.staff.sub,
          },
          {
            accountId: to.id, direction: "in", amountKobo: input.amount, kind: "transfer",
            transferGroup: group, counterAccountId: from.id,
            note: input.note ?? `Transfer from ${from.name}`, staffId: ctx.staff.sub,
          },
        ]);
        void logEvent(getDb(), {
          actor: ctx.staff,
          action: "account.transfer",
          entityType: "account",
          entityId: from.id,
          detail: `${from.name} → ${to.name} · ${formatNaira(input.amount)}${input.note ? ` — ${input.note.slice(0, 100)}` : ""}`,
        });
        return { ok: true as const, transferGroup: group, fromBalanceKobo: balance - input.amount };
      });
    }),
});
