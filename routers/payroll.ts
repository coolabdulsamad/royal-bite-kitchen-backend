// Payroll router (v37) — salary structures live on the staff record; a payroll
// run pays one month ("YYYY-MM") for every active staff member with a salary.
// Draft runs can be adjusted per staff (bonus/deduction/note); paying a run
// posts one immutable ledger out-row per staff member from the chosen account,
// so salaries reduce the real balances like any other expense.

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { createRouter } from "../middleware";
import { permProcedure } from "../auth/guards";
import { getDb } from "../queries/connection";
import { logEvent } from "../audit";
import { accounts, payrollItems, payrollRuns, users } from "@db/schema";
import { ledgerBalance, postToLedger } from "../ledger";
import { formatNaira } from "@contracts/money";

const periodStr = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Period must be YYYY-MM");

/** Naira in, kobo out (0 allowed — a bonus/deduction can legitimately be 0). */
const nairaAmount = z
  .number()
  .min(0)
  .max(100_000_000)
  .transform((n) => Math.round(n * 100));

export const payrollRouter = createRouter({
  /** All runs, newest first, with item counts and payer info. */
  list: permProcedure("payroll", "view")
    .input(
      z
        .object({
          status: z.enum(["draft", "paid", "cancelled"]).optional(),
          q: z.string().trim().max(20).optional(),
        })
        .nullish(),
    )
    .query(async ({ input }) => {
      const db = getDb();
      const conditions = [];
      if (input?.status) conditions.push(eq(payrollRuns.status, input.status));
      if (input?.q) conditions.push(eq(payrollRuns.period, input.q.replace(/[^0-9-]/g, "").slice(0, 7)));
      const where = conditions.length ? and(...conditions) : undefined;
      const rows = await db
        .select({
          id: payrollRuns.id,
          period: payrollRuns.period,
          status: payrollRuns.status,
          totalKobo: payrollRuns.totalKobo,
          accountId: payrollRuns.accountId,
          accountName: accounts.name,
          note: payrollRuns.note,
          createdByName: users.name,
          createdAt: payrollRuns.createdAt,
          paidAt: payrollRuns.paidAt,
          itemCount: sql<number>`(select count(*) from payroll_items pi where pi.run_id = ${payrollRuns.id})`.as("ic"),
        })
        .from(payrollRuns)
        .leftJoin(accounts, eq(accounts.id, payrollRuns.accountId))
        .innerJoin(users, eq(users.id, payrollRuns.createdById))
        .where(where)
        .orderBy(desc(payrollRuns.id));
      return {
        rows: rows.map((r) => ({
          ...r,
          itemCount: Number(r.itemCount),
          createdAt: r.createdAt.toISOString(),
          paidAt: r.paidAt ? r.paidAt.toISOString() : null,
        })),
      };
    }),

  /** One run with its per-staff items. */
  detail: permProcedure("payroll", "view")
    .input(z.object({ runId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const db = getDb();
      const [run] = await db
        .select({
          id: payrollRuns.id,
          period: payrollRuns.period,
          status: payrollRuns.status,
          totalKobo: payrollRuns.totalKobo,
          accountId: payrollRuns.accountId,
          accountName: accounts.name,
          note: payrollRuns.note,
          createdByName: users.name,
          createdAt: payrollRuns.createdAt,
          paidAt: payrollRuns.paidAt,
        })
        .from(payrollRuns)
        .leftJoin(accounts, eq(accounts.id, payrollRuns.accountId))
        .innerJoin(users, eq(users.id, payrollRuns.createdById))
        .where(eq(payrollRuns.id, input.runId));
      if (!run) throw new TRPCError({ code: "NOT_FOUND", message: "Payroll run not found." });
      const items = await db
        .select({
          id: payrollItems.id,
          staffId: payrollItems.staffId,
          staffName: users.name,
          staffCode: users.staffCode,
          role: users.role,
          baseKobo: payrollItems.baseKobo,
          bonusKobo: payrollItems.bonusKobo,
          deductionKobo: payrollItems.deductionKobo,
          netKobo: payrollItems.netKobo,
          note: payrollItems.note,
        })
        .from(payrollItems)
        .innerJoin(users, eq(users.id, payrollItems.staffId))
        .where(eq(payrollItems.runId, run.id))
        .orderBy(users.name);
      return {
        run: {
          ...run,
          createdAt: run.createdAt.toISOString(),
          paidAt: run.paidAt ? run.paidAt.toISOString() : null,
        },
        items,
      };
    }),

  /** Create a draft run for a month from every active staff member with a salary. */
  generate: permProcedure("payroll", "manage")
    .input(z.object({ period: periodStr, note: z.string().trim().max(255).optional() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      return db.transaction(async (tx) => {
        // Lock the runs table region for this period — no duplicate live run.
        const existing = await tx
          .select({ id: payrollRuns.id, status: payrollRuns.status })
          .from(payrollRuns)
          .where(eq(payrollRuns.period, input.period))
          .for("update");
        if (existing.some((r) => r.status !== "cancelled")) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `A payroll run for ${input.period} already exists.`,
          });
        }
        const staff = await tx
          .select({
            id: users.id,
            name: users.name,
            salaryKobo: users.salaryKobo,
          })
          .from(users)
          .where(eq(users.active, true));
        const paid = staff.filter((s) => (s.salaryKobo ?? 0) > 0);
        if (paid.length === 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "No active staff member has a salary set — set salaries on the Staff page first.",
          });
        }
        const total = paid.reduce((s, p) => s + (p.salaryKobo ?? 0), 0);
        const [res] = await tx.insert(payrollRuns).values({
          period: input.period,
          totalKobo: total,
          note: input.note,
          createdById: ctx.staff.sub,
        });
        const runId = Number(res.insertId);
        await tx.insert(payrollItems).values(
          paid.map((s) => ({
            runId,
            staffId: s.id,
            baseKobo: s.salaryKobo ?? 0,
            netKobo: s.salaryKobo ?? 0,
          })),
        );
        void logEvent(getDb(), {
          actor: ctx.staff,
          action: "payroll.generate",
          entityType: "payroll_run",
          entityId: runId,
          detail: `${input.period} — ${paid.length} staff · ${formatNaira(total)}`,
        });
        return {
          ok: true as const,
          runId,
          itemCount: paid.length,
          skippedCount: staff.length - paid.length,
          totalKobo: total,
        };
      });
    }),

  /** Adjust a draft item — bonus, deduction, note. Net recomputed. */
  updateItem: permProcedure("payroll", "manage")
    .input(
      z.object({
        itemId: z.number().int().positive(),
        bonus: nairaAmount.optional(),
        deduction: nairaAmount.optional(),
        note: z.string().trim().max(255).nullish(),
      }),
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      return db.transaction(async (tx) => {
        const [item] = await tx
          .select({
            id: payrollItems.id,
            runId: payrollItems.runId,
            baseKobo: payrollItems.baseKobo,
            bonusKobo: payrollItems.bonusKobo,
            deductionKobo: payrollItems.deductionKobo,
            status: payrollRuns.status,
            period: payrollRuns.period,
          })
          .from(payrollItems)
          .innerJoin(payrollRuns, eq(payrollRuns.id, payrollItems.runId))
          .where(eq(payrollItems.id, input.itemId))
          .for("update");
        if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "Payroll item not found." });
        if (item.status !== "draft") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Only draft runs can be edited." });
        }
        const bonus = input.bonus ?? item.bonusKobo;
        const deduction = input.deduction ?? item.deductionKobo;
        const net = item.baseKobo + bonus - deduction;
        if (net < 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "The deduction can't exceed the salary plus bonus.",
          });
        }
        await tx
          .update(payrollItems)
          .set({
            bonusKobo: bonus,
            deductionKobo: deduction,
            netKobo: net,
            ...(input.note !== undefined ? { note: input.note } : {}),
          })
          .where(eq(payrollItems.id, item.id));
        const [agg] = await tx
          .select({ total: sql<number>`coalesce(sum(${payrollItems.netKobo}), 0)`.as("t") })
          .from(payrollItems)
          .where(eq(payrollItems.runId, item.runId));
        await tx
          .update(payrollRuns)
          .set({ totalKobo: Number(agg?.total ?? 0) })
          .where(eq(payrollRuns.id, item.runId));
        return { ok: true as const, netKobo: net, totalKobo: Number(agg?.total ?? 0) };
      });
    }),

  /** Remove one staff member from a draft run. */
  removeItem: permProcedure("payroll", "manage")
    .input(z.object({ itemId: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      return db.transaction(async (tx) => {
        const [item] = await tx
          .select({ id: payrollItems.id, runId: payrollItems.runId, status: payrollRuns.status })
          .from(payrollItems)
          .innerJoin(payrollRuns, eq(payrollRuns.id, payrollItems.runId))
          .where(eq(payrollItems.id, input.itemId))
          .for("update");
        if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "Payroll item not found." });
        if (item.status !== "draft") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Only draft runs can be edited." });
        }
        await tx.delete(payrollItems).where(eq(payrollItems.id, item.id));
        const [agg] = await tx
          .select({ total: sql<number>`coalesce(sum(${payrollItems.netKobo}), 0)`.as("t") })
          .from(payrollItems)
          .where(eq(payrollItems.runId, item.runId));
        await tx
          .update(payrollRuns)
          .set({ totalKobo: Number(agg?.total ?? 0) })
          .where(eq(payrollRuns.id, item.runId));
        return { ok: true as const, totalKobo: Number(agg?.total ?? 0) };
      });
    }),

  /** Pay a draft run from an account — one ledger out-row per staff member. */
  pay: permProcedure("payroll", "manage")
    .input(z.object({ runId: z.number().int().positive(), accountId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      return db.transaction(async (tx) => {
        const [run] = await tx
          .select()
          .from(payrollRuns)
          .where(eq(payrollRuns.id, input.runId))
          .for("update");
        if (!run) throw new TRPCError({ code: "NOT_FOUND", message: "Payroll run not found." });
        if (run.status !== "draft") {
          throw new TRPCError({ code: "BAD_REQUEST", message: `This run is already ${run.status}.` });
        }
        const [acct] = await tx.select().from(accounts).where(eq(accounts.id, input.accountId)).for("update");
        if (!acct || !acct.active) throw new TRPCError({ code: "NOT_FOUND", message: "Account not found." });
        const balance = await ledgerBalance(tx, acct.id);
        if (run.totalKobo > balance) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `${acct.name} only holds ${formatNaira(balance)} — the payroll total is ${formatNaira(run.totalKobo)}.`,
          });
        }
        const items = await tx
          .select({
            staffId: payrollItems.staffId,
            netKobo: payrollItems.netKobo,
            staffName: users.name,
          })
          .from(payrollItems)
          .innerJoin(users, eq(users.id, payrollItems.staffId))
          .where(eq(payrollItems.runId, run.id));
        if (items.length === 0) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "This run has no staff to pay." });
        }
        await postToLedger(
          tx,
          items.map((it) => ({
            accountId: acct.id,
            direction: "out" as const,
            amountKobo: it.netKobo,
            kind: "payroll" as const,
            refType: "payroll_run",
            refId: String(run.id),
            note: `Salary ${run.period} — ${it.staffName}`,
            staffId: it.staffId,
          })),
        );
        await tx
          .update(payrollRuns)
          .set({ status: "paid", accountId: acct.id, paidAt: new Date() })
          .where(eq(payrollRuns.id, run.id));
        void logEvent(getDb(), {
          actor: ctx.staff,
          action: "payroll.pay",
          entityType: "payroll_run",
          entityId: run.id,
          detail: `${run.period} paid from ${acct.name} — ${items.length} staff · ${formatNaira(run.totalKobo)}`,
        });
        return { ok: true as const, paidCount: items.length, totalKobo: run.totalKobo };
      });
    }),

  /** Cancel a draft run (paid runs are immutable — the ledger has moved). */
  cancel: permProcedure("payroll", "manage")
    .input(z.object({ runId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const [run] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, input.runId));
      if (!run) throw new TRPCError({ code: "NOT_FOUND", message: "Payroll run not found." });
      if (run.status !== "draft") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            run.status === "paid"
              ? "Paid runs can't be cancelled — the salaries have already left the account."
              : "This run is already cancelled.",
        });
      }
      await db
        .update(payrollRuns)
        .set({ status: "cancelled", cancelledAt: new Date() })
        .where(eq(payrollRuns.id, run.id));
      void logEvent(db, {
        actor: ctx.staff,
        action: "payroll.cancel",
        entityType: "payroll_run",
        entityId: run.id,
        detail: `${run.period} draft cancelled`,
      });
      return { ok: true as const };
    }),

  /** Staff salary overview — who has a salary set, who doesn't (for setup). */
  staffSalaries: permProcedure("payroll", "view").query(async () => {
    const db = getDb();
    const rows = await db
      .select({
        id: users.id,
        name: users.name,
        staffCode: users.staffCode,
        role: users.role,
        active: users.active,
        salaryKobo: users.salaryKobo,
        salaryNote: users.salaryNote,
      })
      .from(users)
      .orderBy(users.name);
    return { rows };
  }),
});
