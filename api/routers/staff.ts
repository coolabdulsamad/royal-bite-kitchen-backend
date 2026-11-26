import { z } from "zod";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { TRPCError } from "@trpc/server";
import { asc, eq } from "drizzle-orm";
import { createRouter } from "../middleware";
import { authedProcedure, permProcedure } from "../auth/guards";
import { getDb } from "../queries/connection";
import { logEvent } from "../audit";
import { users, type User } from "@db/schema";
import {
  ROLE_LEVEL,
  STAFF_ROLES,
  type StaffRole,
} from "@contracts/roles";

/**
 * Management hierarchy:
 *  - superadmin can manage anyone (any role, including other superadmins)
 *  - every other role can only manage accounts strictly BELOW its own level
 *  - nobody can deactivate or reset their own account through this router
 */
function assertCanManage(actorRole: StaffRole, targetRole: StaffRole) {
  if (actorRole === "superadmin") return;
  if (ROLE_LEVEL[targetRole] >= ROLE_LEVEL[actorRole]) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You can only manage accounts below your own role",
    });
  }
}

function manageableRoles(actorRole: StaffRole): readonly StaffRole[] {
  if (actorRole === "superadmin") return STAFF_ROLES;
  return STAFF_ROLES.filter(
    (r) => ROLE_LEVEL[r] < ROLE_LEVEL[actorRole],
  );
}

function publicUser(u: User) {
  return {
    id: u.id,
    staffCode: u.staffCode,
    name: u.name,
    username: u.username,
    role: u.role,
    active: u.active,
  };
}

const manageProcedure = permProcedure("staff", "manage");
const viewProcedure = permProcedure("staff", "view");

export const staffRouter = createRouter({
  list: viewProcedure.query(async ({ ctx }) => {
    const db = getDb();
    const rows = await db.select().from(users).orderBy(asc(users.staffCode));
    // Show accounts at or below the actor's own level.
    const max =
      ctx.staff.role === "superadmin" ? 99 : ROLE_LEVEL[ctx.staff.role];
    return rows.filter((r) => ROLE_LEVEL[r.role] <= max).map(publicUser);
  }),

  manageableRoles: viewProcedure.query(({ ctx }) =>
    manageableRoles(ctx.staff.role),
  ),

  /** id + name of all staff — manager+ (for filters like Sales History). */
  names: authedProcedure.query(async () => {
    const db = getDb();
    const rows = await db
      .select({ id: users.id, name: users.name })
      .from(users)
      .orderBy(asc(users.name));
    return rows;
  }),

  create: manageProcedure
    .input(
      z.object({
        name: z.string().trim().min(2).max(120),
        username: z
          .string()
          .trim()
          .min(3)
          .max(60)
          .regex(/^[a-zA-Z0-9._-]+$/, "Letters, numbers, dot, dash, underscore only"),
        staffCode: z
          .string()
          .trim()
          .min(2)
          .max(20)
          .regex(/^[A-Za-z0-9-]+$/),
        role: z.enum(STAFF_ROLES),
        secret: z.string().min(4).max(60),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertCanManage(ctx.staff.role, input.role);
      const db = getDb();

      const clash = await db.query.users.findFirst({
        where: (t, { eq: e, or: o }) =>
          o(e(t.username, input.username), e(t.staffCode, input.staffCode)),
      });
      if (clash) {
        throw new TRPCError({
          code: "CONFLICT",
          message:
            clash.username === input.username
              ? "That username is already taken"
              : "That staff code is already taken",
        });
      }

      await db.insert(users).values({
        name: input.name,
        username: input.username,
        staffCode: input.staffCode,
        role: input.role,
        secretHash: bcrypt.hashSync(input.secret, 10),
      });
      void logEvent(db, {
        actor: ctx.staff,
        action: "staff.create",
        entityType: "staff",
        detail: `${input.name} (${input.staffCode}) added as ${input.role}`,
      });
      return { ok: true };
    }),

  setActive: manageProcedure
    .input(z.object({ id: z.number(), active: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      if (input.id === ctx.staff.sub) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "You cannot deactivate your own account",
        });
      }
      const db = getDb();
      const target = await db.query.users.findFirst({
        where: (t) => eq(t.id, input.id),
      });
      if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "Account not found" });
      assertCanManage(ctx.staff.role, target.role);
      await db.update(users).set({ active: input.active }).where(eq(users.id, target.id));
      return { ok: true };
    }),

  /** Resets the target's secret to a generated one and returns it ONCE. */
  resetSecret: manageProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      if (input.id === ctx.staff.sub) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Change your own secret from My Account instead",
        });
      }
      const db = getDb();
      const target = await db.query.users.findFirst({
        where: (t) => eq(t.id, input.id),
      });
      if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "Account not found" });
      assertCanManage(ctx.staff.role, target.role);

      const newSecret = crypto.randomBytes(4).toString("hex"); // 8 chars
      await db
        .update(users)
        .set({ secretHash: bcrypt.hashSync(newSecret, 10) })
        .where(eq(users.id, target.id));
      return { ok: true, secret: newSecret, name: target.name };
    }),
});
