import { randomBytes } from "node:crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { desc, eq } from "drizzle-orm";
import { createRouter } from "../middleware";
import { roleProcedure } from "../auth/guards";
import { getDb } from "../queries/connection";
import { logEvent } from "../audit";
import { partnerConnections } from "@db/schema";
import { PARTNER_PROVIDERS } from "@contracts/partners";

/**
 * Delivery-partner connections — manager and above only. The webhook token
 * is a secret: list/update never return it; it is revealed exactly once, on
 * create or rotate (same discipline as API keys everywhere else).
 */
export const partnersRouter = createRouter({
  list: roleProcedure("manager").query(async () => {
    const db = getDb();
    const rows = await db
      .select({
        id: partnerConnections.id,
        provider: partnerConnections.provider,
        name: partnerConnections.name,
        storeRef: partnerConnections.storeRef,
        active: partnerConnections.active,
        lastOrderAt: partnerConnections.lastOrderAt,
        createdAt: partnerConnections.createdAt,
      })
      .from(partnerConnections)
      .orderBy(desc(partnerConnections.createdAt));
    return rows.map((r) => ({
      ...r,
      lastOrderAt: r.lastOrderAt ? r.lastOrderAt.toISOString() : null,
      createdAt: r.createdAt.toISOString(),
    }));
  }),

  create: roleProcedure("manager")
    .input(
      z.object({
        provider: z.enum(PARTNER_PROVIDERS),
        name: z.string().trim().min(2).max(64),
        storeRef: z.string().trim().max(64).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const token = randomBytes(30).toString("base64url"); // 40 chars
      const [row] = await db
        .insert(partnerConnections)
        .values({
          provider: input.provider,
          name: input.name,
          token,
          storeRef: input.storeRef || null,
          createdById: ctx.staff.sub,
        })
        .$returningId();
      void logEvent(db, {
        actor: ctx.staff,
        action: "partner.create",
        entityType: "partner",
        entityId: row.id,
        detail: `${input.provider} connection "${input.name}" created`,
      });
      return {
        ok: true as const,
        id: row.id,
        provider: input.provider,
        name: input.name,
        /** Shown ONCE — paste it into the partner dashboard now. */
        token,
      };
    }),

  update: roleProcedure("manager")
    .input(
      z.object({
        id: z.number().int().positive(),
        name: z.string().trim().min(2).max(64).optional(),
        storeRef: z.string().trim().max(64).nullish(),
        active: z.boolean().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const [existing] = await db
        .select({ id: partnerConnections.id })
        .from(partnerConnections)
        .where(eq(partnerConnections.id, input.id))
        .limit(1);
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Connection not found" });
      }
      await db
        .update(partnerConnections)
        .set({
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.storeRef !== undefined ? { storeRef: input.storeRef || null } : {}),
          ...(input.active !== undefined ? { active: input.active } : {}),
        })
        .where(eq(partnerConnections.id, input.id));
      return { ok: true as const, id: input.id };
    }),

  /** Mint a fresh token (the old one stops working immediately). Shown once. */
  rotateToken: roleProcedure("manager")
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const token = randomBytes(30).toString("base64url");
      const [result] = await db
        .update(partnerConnections)
        .set({ token })
        .where(eq(partnerConnections.id, input.id));
      if (result.affectedRows === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Connection not found" });
      }
      return { ok: true as const, id: input.id, token };
    }),
});
