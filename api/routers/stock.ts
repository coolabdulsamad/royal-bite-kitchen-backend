import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, gte, like, lt, sql } from "drizzle-orm";
import { createRouter } from "../middleware";
import { permProcedure } from "../auth/guards";
import { getDb } from "../queries/connection";
import { logEvent } from "../audit";
import { stockItems, stockMovements, users } from "@db/schema";
import { nairaToKobo } from "@contracts/money";
import { STOCK_MOVEMENT_TYPES, toMilli } from "@contracts/stock";

/** Server-local calendar day bounds for a YYYY-MM-DD string (a raw
 *  `new Date("2026-11-27")` parses as UTC midnight and shifts the day). */
function dayStart(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/**
 * Stock (ingredients & supplies). Everyone can see levels and record
 * restock/usage/waste — the kitchen needs that. Creating, editing,
 * deactivating items and making ADJUSTMENTS (corrections) is manager+,
 * because adjustments are the classic theft vector.
 */
export const stockRouter = createRouter({
  list: permProcedure("stock", "view")
    .input(
      z.object({
        search: z.string().trim().max(120).optional(),
        lowOnly: z.boolean().default(false),
        includeInactive: z.boolean().default(false),
      }),
    )
    .query(async ({ input }) => {
      const db = getDb();
      const conditions = [];
      if (input.search) conditions.push(like(stockItems.name, `%${input.search}%`));
      if (!input.includeInactive) conditions.push(eq(stockItems.active, true));
      if (input.lowOnly) {
        conditions.push(
          sql`${stockItems.lowStockAtMilli} IS NOT NULL AND ${stockItems.quantityMilli} <= ${stockItems.lowStockAtMilli}`,
        );
      }
      const where = conditions.length ? and(...conditions) : undefined;

      const rows = await db
        .select()
        .from(stockItems)
        .where(where)
        .orderBy(stockItems.name);

      const [lastMoves, lowCountRows] = await Promise.all([
        rows.length
          ? db
              .select({
                itemId: stockMovements.itemId,
                lastAt: sql<Date>`max(${stockMovements.createdAt})`,
              })
              .from(stockMovements)
              .where(
                inArrayIds(rows.map((r) => r.id)),
              )
              .groupBy(stockMovements.itemId)
          : Promise.resolve([]),
        db
          .select({ n: sql<number>`count(*)` })
          .from(stockItems)
          .where(
            and(
              eq(stockItems.active, true),
              sql`${stockItems.lowStockAtMilli} IS NOT NULL AND ${stockItems.quantityMilli} <= ${stockItems.lowStockAtMilli}`,
            ),
          ),
      ]);
      const lastByItem = new Map(
        lastMoves.map((m) => [m.itemId, asUtcIso(m.lastAt)]),
      );

      return {
        rows: rows.map((r) => ({
          id: r.id,
          name: r.name,
          unit: r.unit,
          quantityMilli: r.quantityMilli,
          lowStockAtMilli: r.lowStockAtMilli,
          costPerUnitKobo: r.costPerUnitKobo,
          active: r.active,
          low: r.lowStockAtMilli !== null && r.quantityMilli <= r.lowStockAtMilli,
          lastMovementAt: lastByItem.get(r.id) ?? null,
        })),
        lowCount: Number(lowCountRows[0]?.n ?? 0),
      };
    }),

  create: permProcedure("stock", "manage")
    .input(
      z.object({
        name: z.string().trim().min(2).max(120),
        unit: z.string().trim().min(1).max(20),
        /** Opening quantity in units (e.g. 25 for 25 kg). */
        openingQuantity: z.number().min(0).max(1_000_000).default(0),
        lowStockAt: z.number().min(0).max(1_000_000).nullish(),
        /** Cost per unit in NAIRA, informational. */
        costPerUnit: z.number().min(0).max(100_000_000).nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const openingMilli = toMilli(input.openingQuantity);
      const created = await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(stockItems)
          .values({
            name: input.name,
            unit: input.unit,
            quantityMilli: openingMilli,
            lowStockAtMilli:
              input.lowStockAt !== null && input.lowStockAt !== undefined
                ? toMilli(input.lowStockAt)
                : null,
            costPerUnitKobo:
              input.costPerUnit !== null && input.costPerUnit !== undefined
                ? nairaToKobo(input.costPerUnit)
                : null,
            createdById: ctx.staff.sub,
          })
          .$returningId();
        if (openingMilli > 0) {
          await tx.insert(stockMovements).values({
            itemId: row.id,
            type: "adjustment",
            deltaMilli: openingMilli,
            balanceAfterMilli: openingMilli,
            note: "Opening stock",
            staffId: ctx.staff.sub,
          });
        }
        return { ok: true as const, id: row.id };
      });
      void logEvent(db, {
        actor: ctx.staff,
        action: "stock.create",
        entityType: "stock",
        entityId: created.id,
        detail: `${input.name} (${input.unit}) added to stock`,
      });
      return created;
    }),

  update: permProcedure("stock", "manage")
    .input(
      z.object({
        id: z.number().int().positive(),
        name: z.string().trim().min(2).max(120).optional(),
        unit: z.string().trim().min(1).max(20).optional(),
        lowStockAt: z.number().min(0).max(1_000_000).nullish(),
        costPerUnit: z.number().min(0).max(100_000_000).nullish(),
        active: z.boolean().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const [result] = await db
        .update(stockItems)
        .set({
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.unit !== undefined ? { unit: input.unit } : {}),
          ...(input.lowStockAt !== undefined
            ? {
                lowStockAtMilli:
                  input.lowStockAt === null ? null : toMilli(input.lowStockAt),
              }
            : {}),
          ...(input.costPerUnit !== undefined
            ? {
                costPerUnitKobo:
                  input.costPerUnit === null ? null : nairaToKobo(input.costPerUnit),
              }
            : {}),
          ...(input.active !== undefined ? { active: input.active } : {}),
        })
        .where(eq(stockItems.id, input.id));
      if (result.affectedRows === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Stock item not found" });
      }
      void logEvent(db, {
        actor: ctx.staff,
        action: "stock.update",
        entityType: "stock",
        entityId: input.id,
        detail: `Stock item #${input.id} updated${input.active === false ? " (deactivated)" : input.active === true ? " (reactivated)" : ""}`,
      });
      return { ok: true as const, id: input.id };
    }),

  /**
   * Record a restock (+), usage (−) or waste (−). Outflows are a conditional
   * UPDATE that can't take stock below zero — two people scooping the last
   * of the rice at once get one success and one friendly error.
   */
  move: permProcedure("stock", "manage")
    .input(
      z.object({
        itemId: z.number().int().positive(),
        type: z.enum(["restock", "usage", "waste"]),
        /** Quantity in units, always positive — the sign comes from type. */
        quantity: z.number().positive().max(1_000_000),
        note: z.string().trim().max(255).optional(),
        /** Restock only: total cost in NAIRA (informational). */
        totalCost: z.number().positive().max(100_000_000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const deltaMilli =
        input.type === "restock" ? toMilli(input.quantity) : -toMilli(input.quantity);
      if (input.totalCost !== undefined && input.type !== "restock") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "A cost can only be attached to a restock",
        });
      }

      const [item] = await db
        .select()
        .from(stockItems)
        .where(eq(stockItems.id, input.itemId))
        .limit(1);
      if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "Stock item not found" });
      if (!item.active) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "That item is deactivated — a manager must reactivate it first",
        });
      }

      const moved = await db.transaction(async (tx) => {
        const [updated] =
          input.type === "restock"
            ? await tx
                .update(stockItems)
                .set({
                  quantityMilli: sql`quantity_milli + ${deltaMilli}`,
                  // A priced restock refreshes the known unit cost.
                  ...(input.totalCost !== undefined
                    ? {
                        costPerUnitKobo: Math.round(
                          nairaToKobo(input.totalCost) / input.quantity,
                        ),
                      }
                    : {}),
                })
                .where(eq(stockItems.id, input.itemId))
            : await tx
                .update(stockItems)
                .set({ quantityMilli: sql`quantity_milli + ${deltaMilli}` })
                .where(
                  and(
                    eq(stockItems.id, input.itemId),
                    gte(stockItems.quantityMilli, -deltaMilli),
                  ),
                );
        if (updated.affectedRows === 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Only ${(item.quantityMilli / 1000).toLocaleString("en-NG")} ${item.unit} of ${item.name} left — not enough for that`,
          });
        }
        const balanceAfterMilli = item.quantityMilli + deltaMilli;
        await tx.insert(stockMovements).values({
          itemId: input.itemId,
          type: input.type,
          deltaMilli,
          balanceAfterMilli,
          totalCostKobo:
            input.totalCost !== undefined ? nairaToKobo(input.totalCost) : null,
          note: input.note || null,
          staffId: ctx.staff.sub,
        });
        return { ok: true as const, itemId: input.itemId, balanceAfterMilli, itemName: item.name, unit: item.unit };
      });
      void logEvent(db, {
        actor: ctx.staff,
        action: "stock.move",
        entityType: "stock",
        entityId: moved.itemId,
        detail: `${input.type} · ${moved.itemName} · now ${(moved.balanceAfterMilli / 1000).toLocaleString("en-NG")} ${moved.unit}`,
      });
      return { ok: true as const, itemId: moved.itemId, balanceAfterMilli: moved.balanceAfterMilli };
    }),

  /** Manager-only correction: set the exact counted quantity. */
  adjust: permProcedure("stock", "manage")
    .input(
      z.object({
        itemId: z.number().int().positive(),
        /** The true counted quantity in units. */
        newQuantity: z.number().min(0).max(1_000_000),
        note: z.string().trim().min(3).max(255),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const newMilli = toMilli(input.newQuantity);
      const adjusted = await db.transaction(async (tx) => {
        // Read BEFORE the update so the ledger records the true delta.
        const [item] = await tx
          .select()
          .from(stockItems)
          .where(eq(stockItems.id, input.itemId))
          .limit(1);
        if (!item) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Stock item not found" });
        }
        await tx
          .update(stockItems)
          .set({ quantityMilli: newMilli })
          .where(eq(stockItems.id, input.itemId));
        await tx.insert(stockMovements).values({
          itemId: input.itemId,
          type: "adjustment",
          deltaMilli: newMilli - item.quantityMilli,
          balanceAfterMilli: newMilli,
          note: input.note,
          staffId: ctx.staff.sub,
        });
        return { ok: true as const, itemId: input.itemId, balanceAfterMilli: newMilli, itemName: item.name, unit: item.unit };
      });
      void logEvent(db, {
        actor: ctx.staff,
        action: "stock.adjust",
        entityType: "stock",
        entityId: adjusted.itemId,
        detail: `Adjustment · ${adjusted.itemName} set to ${(adjusted.balanceAfterMilli / 1000).toLocaleString("en-NG")} ${adjusted.unit} — ${input.note}`,
      });
      return { ok: true as const, itemId: adjusted.itemId, balanceAfterMilli: adjusted.balanceAfterMilli };
    }),

  /**
   * KPI tiles for the Stock page header. One round of aggregate queries —
   * never loop per item against the remote database.
   */
  summary: permProcedure("stock", "view").query(async () => {
    const db = getDb();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [itemStats, todayStats] = await Promise.all([
      db
        .select({
          totalItems: sql<number>`count(*)`,
          lowCount: sql<number>`coalesce(sum(${stockItems.lowStockAtMilli} IS NOT NULL AND ${stockItems.quantityMilli} <= ${stockItems.lowStockAtMilli}), 0)`,
          outCount: sql<number>`coalesce(sum(${stockItems.quantityMilli} <= 0), 0)`,
          stockValueKobo: sql<number>`coalesce(sum(CASE WHEN ${stockItems.costPerUnitKobo} IS NOT NULL AND ${stockItems.quantityMilli} > 0 THEN ${stockItems.quantityMilli} * ${stockItems.costPerUnitKobo} / 1000 ELSE 0 END), 0)`,
        })
        .from(stockItems)
        .where(eq(stockItems.active, true)),
      db
        .select({
          movementsToday: sql<number>`count(*)`,
          wasteToday: sql<number>`coalesce(sum(${stockMovements.type} = 'waste'), 0)`,
          restockSpendTodayKobo: sql<number>`coalesce(sum(CASE WHEN ${stockMovements.type} = 'restock' THEN ${stockMovements.totalCostKobo} ELSE 0 END), 0)`,
        })
        .from(stockMovements)
        .where(gte(stockMovements.createdAt, todayStart)),
    ]);

    const s = itemStats[0];
    const t = todayStats[0];
    return {
      totalItems: Number(s?.totalItems ?? 0),
      lowCount: Number(s?.lowCount ?? 0),
      outOfStockCount: Number(s?.outCount ?? 0),
      stockValueKobo: Math.round(Number(s?.stockValueKobo ?? 0)),
      movementsToday: Number(t?.movementsToday ?? 0),
      wasteToday: Number(t?.wasteToday ?? 0),
      restockSpendTodayKobo: Math.round(Number(t?.restockSpendTodayKobo ?? 0)),
    };
  }),

  /**
   * One stock item with its filtered + paginated movement ledger and
   * aggregates over the CURRENT filters — powers the full item page
   * (KPI cards, filters, print view).
   */
  detail: permProcedure("stock", "view")
    .input(
      z.object({
        itemId: z.number().int().positive(),
        type: z.enum(STOCK_MOVEMENT_TYPES).optional(),
        staffId: z.number().int().positive().optional(),
        /** YYYY-MM-DD, server-local day. */
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(5).max(100).default(25),
      }),
    )
    .query(async ({ input }) => {
      const db = getDb();
      const [item] = await db
        .select({
          id: stockItems.id,
          name: stockItems.name,
          unit: stockItems.unit,
          quantityMilli: stockItems.quantityMilli,
          lowStockAtMilli: stockItems.lowStockAtMilli,
          costPerUnitKobo: stockItems.costPerUnitKobo,
          active: stockItems.active,
          createdAt: stockItems.createdAt,
          createdByName: users.name,
        })
        .from(stockItems)
        .leftJoin(users, eq(users.id, stockItems.createdById))
        .where(eq(stockItems.id, input.itemId))
        .limit(1);
      if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "Stock item not found" });

      const conditions = [eq(stockMovements.itemId, input.itemId)];
      if (input.type) conditions.push(eq(stockMovements.type, input.type));
      if (input.staffId) conditions.push(eq(stockMovements.staffId, input.staffId));
      if (input.from) conditions.push(gte(stockMovements.createdAt, dayStart(input.from)));
      if (input.to) {
        const end = dayStart(input.to);
        end.setDate(end.getDate() + 1);
        conditions.push(lt(stockMovements.createdAt, end));
      }
      const where = and(...conditions);

      const [totalsRows, countRows, rows] = await Promise.all([
        db
          .select({
            restockedMilli: sql<number>`coalesce(sum(CASE WHEN ${stockMovements.type} = 'restock' THEN ${stockMovements.deltaMilli} ELSE 0 END), 0)`,
            usageMilli: sql<number>`coalesce(sum(CASE WHEN ${stockMovements.type} = 'usage' THEN -${stockMovements.deltaMilli} ELSE 0 END), 0)`,
            wasteMilli: sql<number>`coalesce(sum(CASE WHEN ${stockMovements.type} = 'waste' THEN -${stockMovements.deltaMilli} ELSE 0 END), 0)`,
            adjustmentNetMilli: sql<number>`coalesce(sum(CASE WHEN ${stockMovements.type} = 'adjustment' THEN ${stockMovements.deltaMilli} ELSE 0 END), 0)`,
            spendKobo: sql<number>`coalesce(sum(${stockMovements.totalCostKobo}), 0)`,
          })
          .from(stockMovements)
          .where(where),
        db
          .select({ n: sql<number>`count(*)` })
          .from(stockMovements)
          .where(where),
        db
          .select({
            id: stockMovements.id,
            type: stockMovements.type,
            deltaMilli: stockMovements.deltaMilli,
            balanceAfterMilli: stockMovements.balanceAfterMilli,
            totalCostKobo: stockMovements.totalCostKobo,
            note: stockMovements.note,
            createdAt: stockMovements.createdAt,
            staffId: stockMovements.staffId,
            staffName: users.name,
          })
          .from(stockMovements)
          .innerJoin(users, eq(users.id, stockMovements.staffId))
          .where(where)
          .orderBy(desc(stockMovements.createdAt), desc(stockMovements.id))
          .limit(input.pageSize)
          .offset((input.page - 1) * input.pageSize),
      ]);

      const t = totalsRows[0];
      return {
        item: {
          ...item,
          createdAt: item.createdAt.toISOString(),
          createdByName: item.createdByName ?? null,
          low: item.lowStockAtMilli !== null && item.quantityMilli <= item.lowStockAtMilli,
          stockValueKobo:
            item.costPerUnitKobo !== null && item.quantityMilli > 0
              ? Math.round((item.quantityMilli * item.costPerUnitKobo) / 1000)
              : 0,
        },
        totals: {
          restockedMilli: Number(t?.restockedMilli ?? 0),
          usageMilli: Number(t?.usageMilli ?? 0),
          wasteMilli: Number(t?.wasteMilli ?? 0),
          adjustmentNetMilli: Number(t?.adjustmentNetMilli ?? 0),
          spendKobo: Math.round(Number(t?.spendKobo ?? 0)),
        },
        movements: rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
        total: Number(countRows[0]?.n ?? 0),
        page: input.page,
        pageSize: input.pageSize,
      };
    }),

  history: permProcedure("stock", "view")
    .input(
      z.object({
        itemId: z.number().int().positive(),
        limit: z.number().int().min(1).max(100).default(50),
      }),
    )
    .query(async ({ input }) => {
      const db = getDb();
      const rows = await db
        .select({
          id: stockMovements.id,
          type: stockMovements.type,
          deltaMilli: stockMovements.deltaMilli,
          balanceAfterMilli: stockMovements.balanceAfterMilli,
          totalCostKobo: stockMovements.totalCostKobo,
          note: stockMovements.note,
          createdAt: stockMovements.createdAt,
          staffName: users.name,
        })
        .from(stockMovements)
        .innerJoin(users, eq(users.id, stockMovements.staffId))
        .where(eq(stockMovements.itemId, input.itemId))
        .orderBy(desc(stockMovements.createdAt), desc(stockMovements.id))
        .limit(input.limit);
      return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
    }),
});

/** Raw aggregates (max(created_at)) come back as timezone-less strings like
 *  "2026-11-26 06:11:00" — they are UTC wall time, so pin the Z or Date
 *  would parse them in the server's local zone and shift the result. */
function asUtcIso(value: unknown): string {
  const s = String(value);
  const hasZone = s.endsWith("Z") || /[+-]\d{2}:?\d{2}$/.test(s);
  return new Date(hasZone ? s : `${s.replace(" ", "T")}Z`).toISOString();
}

/** inArray needs a non-empty tuple; callers guard rows.length above. */
function inArrayIds(ids: number[]) {
  return sql`${stockMovements.itemId} IN (${sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  )})`;
}
