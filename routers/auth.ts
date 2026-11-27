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
    const self = await db.query.users.findFirst({
      where: (t) => eq(t.id, ctx.staff.sub),
    });
    return {
      id: ctx.staff.sub,
      // Read identity from the DB row, not the JWT — a self-service
      // username change must show up immediately, not after re-login.
      staffCode: self?.staffCode ?? ctx.staff.staffCode,
      name: self?.name ?? ctx.staff.name,
      username: self?.username ?? ctx.staff.username,
      role: ctx.staff.role,
      permissions,
      /** Full own profile — the My Account page shows it read-only. */
      profile: self
        ? {
            phone: self.phone,
            email: self.email,
            gender: self.gender,
            dateOfBirth: self.dateOfBirth,
            address: self.address,
            stateOfOrigin: self.stateOfOrigin,
            employmentDate: self.employmentDate,
            guarantorName: self.guarantorName,
            guarantorPhone: self.guarantorPhone,
            guarantorAddress: self.guarantorAddress,
            nextOfKinName: self.nextOfKinName,
            nextOfKinPhone: self.nextOfKinPhone,
            bankName: self.bankName,
            bankAccountNumber: self.bankAccountNumber,
          }
        : null,
    };
  }),

  /**
   * Self-service: a staff member may change ONLY their own username and
   * phone number (plus their secret via changeSecret). Every other profile
   * field — guarantor, bank, next of kin, … — is recorded by management
   * through staff.updateProfile.
   */
  updateProfile: authedProcedure
    .input(
      z.object({
        username: z
          .string()
          .trim()
          .min(3)
          .max(60)
          .regex(/^[a-zA-Z0-9._-]+$/, "Letters, numbers, dot, dash, underscore only")
          .optional(),
        phone: z.string().trim().max(40).nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      if (input.username) {
        const clash = await db.query.users.findFirst({
          where: (t) => eq(t.username, input.username!),
        });
        if (clash && clash.id !== ctx.staff.sub) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "That username is already taken",
          });
        }
      }
      await db
        .update(users)
        .set({
          ...(input.username !== undefined ? { username: input.username } : {}),
          ...(input.phone !== undefined
            ? { phone: input.phone?.trim() ? input.phone.trim() : null }
            : {}),
        })
        .where(eq(users.id, ctx.staff.sub));
      const self = await db.query.users.findFirst({
        where: (t) => eq(t.id, ctx.staff.sub),
      });
      return { ok: true as const, username: self?.username, phone: self?.phone };
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
