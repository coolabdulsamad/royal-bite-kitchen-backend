import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { asc, eq } from "drizzle-orm";
import { createRouter } from "../middleware";
import { authedProcedure, roleProcedure } from "../auth/guards";
import { getDb } from "../queries/connection";
import { logEvent } from "../audit";
import {
  categories,
  itemModifierGroups,
  menuItems,
  modifierGroups,
  modifierOptions,
} from "@db/schema";
import { nairaToKobo } from "@contracts/money";

const managerProcedure = roleProcedure("manager");

async function nextSortOrder(
  table: "categories" | "menu_items",
  categoryId?: number,
): Promise<number> {
  const db = getDb();
  if (table === "categories") {
    const rows = await db.select({ s: categories.sortOrder }).from(categories);
    return rows.reduce((m, r) => Math.max(m, r.s), 0) + 1;
  }
  const rows = await db
    .select({ s: menuItems.sortOrder })
    .from(menuItems)
    .where(eq(menuItems.categoryId, categoryId!));
  return rows.reduce((m, r) => Math.max(m, r.s), 0) + 1;
}

export const menuRouter = createRouter({
  // -------------------------------------------------------------------------
  // Reads — any signed-in staff (the POS needs this too)
  // -------------------------------------------------------------------------

  /** Everything the POS / menu screens need in one call. */
  fullMenu: authedProcedure.query(async () => {
    const db = getDb();
    const cats = await db.query.categories.findMany({
      orderBy: [asc(categories.sortOrder), asc(categories.id)],
    });
    const items = await db.query.menuItems.findMany({
      orderBy: [asc(menuItems.sortOrder), asc(menuItems.id)],
    });
    const groups = await db.query.modifierGroups.findMany({
      orderBy: [asc(modifierGroups.id)],
    });
    const options = await db.query.modifierOptions.findMany({
      orderBy: [asc(modifierOptions.id)],
    });
    const links = await db.query.itemModifierGroups.findMany({
      orderBy: [asc(itemModifierGroups.sortOrder), asc(itemModifierGroups.id)],
    });

    return cats.map((cat) => ({
      ...cat,
      items: items
        .filter((it) => it.categoryId === cat.id)
        .map((it) => ({
          ...it,
          modifierGroups: links
            .filter((l) => l.itemId === it.id)
            .map((l) => groups.find((g) => g.id === l.groupId))
            .filter((g): g is NonNullable<typeof g> => Boolean(g))
            .map((g) => ({
              ...g,
              options: options.filter((o) => o.groupId === g.id),
            })),
        })),
    }));
  }),

  /** All modifier groups with their options (for the modifiers manager tab). */
  modifierLibrary: authedProcedure.query(async () => {
    const db = getDb();
    const groups = await db.query.modifierGroups.findMany({
      orderBy: [asc(modifierGroups.id)],
    });
    const options = await db.query.modifierOptions.findMany({
      orderBy: [asc(modifierOptions.id)],
    });
    return groups.map((g) => ({
      ...g,
      options: options.filter((o) => o.groupId === g.id),
    }));
  }),

  // -------------------------------------------------------------------------
  // Category writes — manager and above
  // -------------------------------------------------------------------------

  createCategory: managerProcedure
    .input(z.object({ name: z.string().trim().min(1).max(80) }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db.insert(categories).values({
        name: input.name,
        sortOrder: await nextSortOrder("categories"),
      });
      return { ok: true };
    }),

  renameCategory: managerProcedure
    .input(z.object({ id: z.number(), name: z.string().trim().min(1).max(80) }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db
        .update(categories)
        .set({ name: input.name })
        .where(eq(categories.id, input.id));
      return { ok: true };
    }),

  setCategoryActive: managerProcedure
    .input(z.object({ id: z.number(), active: z.boolean() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db
        .update(categories)
        .set({ active: input.active })
        .where(eq(categories.id, input.id));
      return { ok: true };
    }),

  deleteCategory: managerProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const itemCount = await db.query.menuItems.findFirst({
        where: (t) => eq(t.categoryId, input.id),
      });
      if (itemCount) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This category still has items — move or delete them first",
        });
      }
      await db.delete(categories).where(eq(categories.id, input.id));
      return { ok: true };
    }),

  // -------------------------------------------------------------------------
  // Item writes
  // -------------------------------------------------------------------------

  createItem: managerProcedure
    .input(
      z.object({
        categoryId: z.number(),
        name: z.string().trim().min(1).max(120),
        description: z.string().trim().max(500).optional(),
        /** Price in NAIRA (decimal) — converted to kobo server-side. */
        price: z.number().min(0).max(10_000_000),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const cat = await db.query.categories.findFirst({
        where: (t) => eq(t.id, input.categoryId),
      });
      if (!cat) throw new TRPCError({ code: "NOT_FOUND", message: "Category not found" });
      const [row] = await db
        .insert(menuItems)
        .values({
          categoryId: input.categoryId,
          name: input.name,
          description: input.description || null,
          priceKobo: nairaToKobo(input.price),
          sortOrder: await nextSortOrder("menu_items", input.categoryId),
        })
        .$returningId();
      void logEvent(db, {
        actor: ctx.staff,
        action: "menu.item",
        entityType: "menu",
        entityId: row.id,
        detail: `Menu item "${input.name}" created · ₦${input.price.toLocaleString("en-NG")}`,
      });
      return { ok: true, id: row.id };
    }),

  updateItem: managerProcedure
    .input(
      z.object({
        id: z.number(),
        name: z.string().trim().min(1).max(120).optional(),
        description: z.string().trim().max(500).optional(),
        price: z.number().min(0).max(10_000_000).optional(),
        categoryId: z.number().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const patch: Partial<typeof menuItems.$inferInsert> = {};
      if (input.name !== undefined) patch.name = input.name;
      if (input.description !== undefined)
        patch.description = input.description || null;
      if (input.price !== undefined) patch.priceKobo = nairaToKobo(input.price);
      if (input.categoryId !== undefined) patch.categoryId = input.categoryId;
      if (Object.keys(patch).length === 0) return { ok: true };
      await db.update(menuItems).set(patch).where(eq(menuItems.id, input.id));
      void logEvent(db, {
        actor: ctx.staff,
        action: "menu.item",
        entityType: "menu",
        entityId: input.id,
        detail: `Menu item #${input.id} updated (${Object.keys(patch).join(", ")})`,
      });
      return { ok: true };
    }),

  setItemAvailability: managerProcedure
    .input(z.object({ id: z.number(), available: z.boolean() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db
        .update(menuItems)
        .set({ available: input.available })
        .where(eq(menuItems.id, input.id));
      return { ok: true };
    }),

  deleteItem: managerProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db
        .delete(itemModifierGroups)
        .where(eq(itemModifierGroups.itemId, input.id));
      await db.delete(menuItems).where(eq(menuItems.id, input.id));
      return { ok: true };
    }),

  /** Replace the set of modifier groups attached to an item. */
  setItemModifierGroups: managerProcedure
    .input(z.object({ itemId: z.number(), groupIds: z.array(z.number()) }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db
        .delete(itemModifierGroups)
        .where(eq(itemModifierGroups.itemId, input.itemId));
      for (const [i, groupId] of input.groupIds.entries()) {
        await db
          .insert(itemModifierGroups)
          .values({ itemId: input.itemId, groupId, sortOrder: i });
      }
      return { ok: true };
    }),

  // -------------------------------------------------------------------------
  // Modifier library writes
  // -------------------------------------------------------------------------

  createModifierGroup: managerProcedure
    .input(
      z.object({
        name: z.string().trim().min(1).max(80),
        selectionType: z.enum(["single", "multi"]),
        required: z.boolean(),
      }),
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      await db.insert(modifierGroups).values(input);
      return { ok: true };
    }),

  updateModifierGroup: managerProcedure
    .input(
      z.object({
        id: z.number(),
        name: z.string().trim().min(1).max(80).optional(),
        selectionType: z.enum(["single", "multi"]).optional(),
        required: z.boolean().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const { id, ...patch } = input;
      if (Object.keys(patch).length === 0) return { ok: true };
      await db.update(modifierGroups).set(patch).where(eq(modifierGroups.id, id));
      return { ok: true };
    }),

  deleteModifierGroup: managerProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db
        .delete(itemModifierGroups)
        .where(eq(itemModifierGroups.groupId, input.id));
      await db
        .delete(modifierOptions)
        .where(eq(modifierOptions.groupId, input.id));
      await db.delete(modifierGroups).where(eq(modifierGroups.id, input.id));
      return { ok: true };
    }),

  addModifierOption: managerProcedure
    .input(
      z.object({
        groupId: z.number(),
        name: z.string().trim().min(1).max(80),
        /** Extra price in NAIRA (decimal). 0 = no extra charge. */
        priceDelta: z.number().min(0).max(10_000_000),
      }),
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      await db.insert(modifierOptions).values({
        groupId: input.groupId,
        name: input.name,
        priceDeltaKobo: nairaToKobo(input.priceDelta),
      });
      return { ok: true };
    }),

  updateModifierOption: managerProcedure
    .input(
      z.object({
        id: z.number(),
        name: z.string().trim().min(1).max(80).optional(),
        priceDelta: z.number().min(0).max(10_000_000).optional(),
        active: z.boolean().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const patch: Partial<typeof modifierOptions.$inferInsert> = {};
      if (input.name !== undefined) patch.name = input.name;
      if (input.priceDelta !== undefined)
        patch.priceDeltaKobo = nairaToKobo(input.priceDelta);
      if (input.active !== undefined) patch.active = input.active;
      if (Object.keys(patch).length === 0) return { ok: true };
      await db
        .update(modifierOptions)
        .set(patch)
        .where(eq(modifierOptions.id, input.id));
      return { ok: true };
    }),

  deleteModifierOption: managerProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db.delete(modifierOptions).where(eq(modifierOptions.id, input.id));
      return { ok: true };
    }),
});
