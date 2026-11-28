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

// ── Full staff profile ─────────────────────────────────────────────────────
const dateStr = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

/** Optional profile fields a manager records for a staff member. */
const staffProfileInput = {
  phone: z.string().trim().max(40).nullish(),
  email: z.string().trim().max(120).nullish(),
  gender: z.enum(["male", "female", "other"]).nullish(),
  dateOfBirth: dateStr.nullish(),
  address: z.string().trim().max(255).nullish(),
  stateOfOrigin: z.string().trim().max(60).nullish(),
  employmentDate: dateStr.nullish(),
  guarantorName: z.string().trim().max(120).nullish(),
  guarantorPhone: z.string().trim().max(40).nullish(),
  guarantorAddress: z.string().trim().max(255).nullish(),
  nextOfKinName: z.string().trim().max(120).nullish(),
  nextOfKinPhone: z.string().trim().max(40).nullish(),
  bankName: z.string().trim().max(80).nullish(),
  bankAccountNumber: z.string().trim().max(20).nullish(),
  salaryNote: z.string().trim().max(255).nullish(),
} as const;

/** Monthly salary in NAIRA — transformed to kobo; null clears it. */
const salaryInput = z
  .number()
  .min(0)
  .max(100_000_000)
  .nullish()
  .transform((n) => (n == null ? null : Math.round(n * 100)));

const PROFILE_FIELD_NAMES = Object.keys(staffProfileInput) as Array<
  keyof typeof staffProfileInput
>;

/** "" → null so optional text fields clear cleanly. */
function profileValues(input: Record<string, unknown>) {
  const out: Record<string, string | null> = {};
  for (const key of PROFILE_FIELD_NAMES) {
    const v = input[key];
    if (v === undefined) continue;
    out[key] = typeof v === "string" && v.trim() === "" ? null : (v as string | null);
  }
  return out;
}

/** publicUser + the full profile — manager-facing staff list/edit. */
function fullUser(u: User) {
  return {
    ...publicUser(u),
    phone: u.phone,
    email: u.email,
    gender: u.gender,
    dateOfBirth: u.dateOfBirth,
    address: u.address,
    stateOfOrigin: u.stateOfOrigin,
    employmentDate: u.employmentDate,
    guarantorName: u.guarantorName,
    guarantorPhone: u.guarantorPhone,
    guarantorAddress: u.guarantorAddress,
    nextOfKinName: u.nextOfKinName,
    nextOfKinPhone: u.nextOfKinPhone,
    bankName: u.bankName,
    bankAccountNumber: u.bankAccountNumber,
    salaryKobo: u.salaryKobo,
    salaryNote: u.salaryNote,
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
    return rows.filter((r) => ROLE_LEVEL[r.role] <= max).map(fullUser);
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
        salaryKobo: salaryInput,
        ...staffProfileInput,
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
        ...profileValues(input),
        ...(input.salaryKobo !== undefined ? { salaryKobo: input.salaryKobo } : {}),
      });
      void logEvent(db, {
        actor: ctx.staff,
        action: "staff.create",
        entityType: "staff",
        detail: `${input.name} (${input.staffCode}) added as ${input.role}`,
      });
      return { ok: true };
    }),

  /**
   * Edit an account's core identity + full profile (manager+).
   * Staff edit only their own username/phone via auth.updateProfile — every
   * other field is recorded here by management.
   */
  updateProfile: manageProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        name: z.string().trim().min(2).max(120).optional(),
        username: z
          .string()
          .trim()
          .min(3)
          .max(60)
          .regex(/^[a-zA-Z0-9._-]+$/, "Letters, numbers, dot, dash, underscore only")
          .optional(),
        staffCode: z
          .string()
          .trim()
          .min(2)
          .max(20)
          .regex(/^[A-Za-z0-9-]+$/)
          .optional(),
        role: z.enum(STAFF_ROLES).optional(),
        salaryKobo: salaryInput,
        ...staffProfileInput,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const target = await db.query.users.findFirst({
        where: (t) => eq(t.id, input.id),
      });
      if (!target) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Account not found" });
      }
      assertCanManage(ctx.staff.role, target.role);
      if (input.role) assertCanManage(ctx.staff.role, input.role);
      if (input.id === ctx.staff.sub && input.role && input.role !== target.role) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "You cannot change your own role",
        });
      }

      if (input.username || input.staffCode) {
        const clash = await db.query.users.findFirst({
          where: (t, { eq: e, or: o }) =>
            o(
              input.username ? e(t.username, input.username) : undefined,
              input.staffCode ? e(t.staffCode, input.staffCode) : undefined,
            ),
        });
        if (clash && clash.id !== input.id) {
          throw new TRPCError({
            code: "CONFLICT",
            message:
              clash.username === input.username
                ? "That username is already taken"
                : "That staff code is already taken",
          });
        }
      }

      await db
        .update(users)
        .set({
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.username !== undefined ? { username: input.username } : {}),
          ...(input.staffCode !== undefined ? { staffCode: input.staffCode } : {}),
          ...(input.role !== undefined ? { role: input.role } : {}),
          ...profileValues(input),
          ...(input.salaryKobo !== undefined ? { salaryKobo: input.salaryKobo } : {}),
        })
        .where(eq(users.id, input.id));
      void logEvent(db, {
        actor: ctx.staff,
        action: "staff.update_profile",
        entityType: "staff",
        entityId: target.id,
        detail: `${target.name} (${target.staffCode}) profile updated`,
      });
      return { ok: true as const };
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
