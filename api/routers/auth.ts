import { z } from "zod";
import bcrypt from "bcryptjs";
import { TRPCError } from "@trpc/server";
import { eq, or } from "drizzle-orm";
import { createRouter, publicQuery } from "../middleware";
import { authedProcedure } from "../auth/guards";
import { signStaffToken } from "../auth/jwt";
import { getDb } from "../queries/connection";
import { permissionsFor } from "../permissions";
import { users, type User } from "@db/schema";
import type { StaffRole } from "@contracts/roles";

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

export const authRouter = createRouter({
  login: publicQuery
    .input(z.object({ identifier: z.string().min(1), secret: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const idf = input.identifier.trim();
      const user = await db.query.users.findFirst({
        where: (t) => or(eq(t.username, idf), eq(t.staffCode, idf)),
      });
      if (!user || !user.active || !bcrypt.compareSync(input.secret, user.secretHash)) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Invalid staff ID or PIN/password",
        });
      }
      const token = signStaffToken({
        sub: user.id,
        username: user.username,
        staffCode: user.staffCode,
        name: user.name,
        role: user.role,
      });
      const permissions = await permissionsFor(db, user.role);
      return { token, user: { ...publicUser(user), permissions } };
    }),

  me: authedProcedure.query(async ({ ctx }) => {
    const db = getDb();
    const permissions = await permissionsFor(db, ctx.staff.role as StaffRole);
    return {
      id: ctx.staff.sub,
      staffCode: ctx.staff.staffCode,
      name: ctx.staff.name,
      username: ctx.staff.username,
      role: ctx.staff.role,
      permissions,
    };
  }),

  changeSecret: authedProcedure
    .input(
      z.object({
        current: z.string().min(1),
        next: z.string().min(4).max(60),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const user = await db.query.users.findFirst({
        where: (t) => eq(t.id, ctx.staff.sub),
      });
      if (!user || !bcrypt.compareSync(input.current, user.secretHash)) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Current PIN/password is wrong",
        });
      }
      await db
        .update(users)
        .set({ secretHash: bcrypt.hashSync(input.next, 10) })
        .where(eq(users.id, user.id));
      return { ok: true };
    }),
});
