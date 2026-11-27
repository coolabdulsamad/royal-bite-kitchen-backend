import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, asc, eq, gte, lt, sql } from "drizzle-orm";
import { createRouter } from "../middleware";
import { authedProcedure, permProcedure } from "../auth/guards";
import { getDb } from "../queries/connection";
import { logEvent } from "../audit";
import { bankPosTerminals, salePayments, sales } from "@db/schema";
import { roleHas } from "../permissions";
import type { StaffRole } from "@contracts/roles";

/**
 * Bank POS terminal registry. Any staff role can list ACTIVE terminals (the
 * cashier checkout needs them); creating, editing and disabling is manager+.
 */
export const terminalsRouter = createRouter({
  list: authedProcedure.query(async ({ ctx }) => {
    const db = getDb();
    const isManager = await roleHas(
      db,
      ctx.staff.role as StaffRole,
      "terminals",
      "view",
    );
    const rows = await db
      .select({
        id: bankPosTerminals.id,
        name: bankPosTerminals.name,
        provider: bankPosTerminals.provider,
        terminalCode: bankPosTerminals.terminalCode,
        active: bankPosTerminals.active,
        notes: bankPosTerminals.notes,
        createdAt: bankPosTerminals.createdAt,
      })
      .from(bankPosTerminals)
      // Cashiers only ever see active terminals; managers see everything.
      .where(isManager ? undefined : eq(bankPosTerminals.active, true))
      .orderBy(asc(bankPosTerminals.name));
    return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
  }),

  create: permProcedure("terminals", "manage")
    .input(
      z.object({
        name: z.string().trim().min(2).max(64),
        provider: z.string().trim().max(64).optional(),
        terminalCode: z.string().trim().max(64).optional(),
        notes: z.string().trim().max(255).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const [row] = await db
        .insert(bankPosTerminals)
        .values({
          name: input.name,
          provider: input.provider || null,
          terminalCode: input.terminalCode || null,
          notes: input.notes || null,
          createdById: ctx.staff.sub,
        })
        .$returningId();
      void logEvent(db, {
        actor: ctx.staff,
        action: "terminal.create",
        entityType: "terminal",
        entityId: row.id,
        detail: `Terminal ${input.name} registered${input.provider ? ` (${input.provider})` : ""}`,
      });
      return { ok: true as const, id: row.id };
    }),

  update: permProcedure("terminals", "manage")
    .input(
      z.object({
        id: z.number().int().positive(),
        name: z.string().trim().min(2).max(64).optional(),
        provider: z.string().trim().max(64).nullish(),
        terminalCode: z.string().trim().max(64).nullish(),
        notes: z.string().trim().max(255).nullish(),
        active: z.boolean().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const [result] = await db
        .update(bankPosTerminals)
        .set({
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.provider !== undefined ? { provider: input.provider || null } : {}),
          ...(input.terminalCode !== undefined
            ? { terminalCode: input.terminalCode || null }
            : {}),
          ...(input.notes !== undefined ? { notes: input.notes || null } : {}),
          ...(input.active !== undefined ? { active: input.active } : {}),
        })
        .where(eq(bankPosTerminals.id, input.id));
      if (result.affectedRows === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Terminal not found" });
      }
      void logEvent(db, {
        actor: ctx.staff,
        action: "terminal.update",
        entityType: "terminal",
        entityId: input.id,
        detail: `Terminal #${input.id} updated${input.active === false ? " (disabled)" : input.active === true ? " (enabled)" : ""}`,
      });
      return { ok: true as const, id: input.id };
    }),

  /**
   * Per-terminal card takings for a date range (default: today). Excludes
   * returned sales so the numbers match what should be in each machine's
   * settlement. The "unassigned" bucket catches bank_pos payments taken
   * without a terminal pick (older sales, or terminals not yet registered).
   */
  todayStats: permProcedure("terminals", "view")
    .input(
      z
        .object({
          /** YYYY-MM-DD, server-local days (inclusive). Default: today. */
          from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
          to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        })
        .nullish(),
    )
    .query(async ({ input }) => {
      const db = getDb();
      const dayStart = new Date();
      dayStart.setHours(0, 0, 0, 0);
      const from = input?.from
        ? (() => {
            const [y, m, d] = input.from!.split("-").map(Number);
            return new Date(y, m - 1, d);
          })()
        : dayStart;
      let to: Date | undefined;
      if (input?.to) {
        const [y, m, d] = input.to.split("-").map(Number);
        to = new Date(y, m - 1, d + 1);
      } else if (input?.from) {
        to = new Date(from.getFullYear(), from.getMonth(), from.getDate() + 1);
      }

      const terminals = await db
        .select()
        .from(bankPosTerminals)
        .orderBy(asc(bankPosTerminals.name));

      const payConds = [
        eq(salePayments.method, "bank_pos"),
        gte(sales.soldAt, from),
        eq(sales.status, "completed"),
      ];
      if (to) payConds.push(lt(sales.soldAt, to));

      const sums = await db
        .select({
          terminalId: salePayments.terminalId,
          payments: sql<number>`count(*)`,
          totalKobo: sql<number>`coalesce(sum(${salePayments.amountKobo}), 0)`,
        })
        .from(salePayments)
        .innerJoin(sales, eq(sales.id, salePayments.saleId))
        .where(and(...payConds))
        .groupBy(salePayments.terminalId);

      const byTerminal = new Map(sums.map((s) => [s.terminalId, s]));
      const unassigned = byTerminal.get(null);

      return {
        dayStart: from.toISOString(),
        dayEnd: to ? to.toISOString() : null,
        terminals: terminals.map((t) => {
          const s = byTerminal.get(t.id);
          return {
            id: t.id,
            name: t.name,
            provider: t.provider,
            active: t.active,
            payments: s?.payments ?? 0,
            totalKobo: Number(s?.totalKobo ?? 0),
          };
        }),
        unassigned: {
          payments: unassigned?.payments ?? 0,
          totalKobo: Number(unassigned?.totalKobo ?? 0),
        },
      };
    }),
});
