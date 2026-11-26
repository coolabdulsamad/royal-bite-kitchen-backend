import { TRPCError } from "@trpc/server";
import { publicQuery } from "../middleware";
import { verifyStaffToken, type StaffTokenPayload } from "./jwt";
import { ROLE_LEVEL, type StaffRole } from "@contracts/roles";
import type { DomainKey, PermLevel } from "@contracts/permissions";
import { getDb } from "../queries/connection";
import { roleHas } from "../permissions";
import type { TrpcContext } from "../context";

function extractStaff(ctx: TrpcContext): StaffTokenPayload {
  const header = ctx.req.headers.get("authorization");
  if (!header || !header.startsWith("Bearer ")) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Sign in required" });
  }
  try {
    return verifyStaffToken(header.slice(7));
  } catch {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Session expired — sign in again",
    });
  }
}

/** Requires any signed-in staff member. Injects ctx.staff. */
export const authedProcedure = publicQuery.use(({ ctx, next }) => {
  const staff = extractStaff(ctx);
  return next({ ctx: { ...ctx, staff } });
});

/** Requires a signed-in staff member at or above minRole. Injects ctx.staff. */
export function roleProcedure(minRole: StaffRole) {
  return publicQuery.use(({ ctx, next }) => {
    const staff = extractStaff(ctx);
    if (ROLE_LEVEL[staff.role] < ROLE_LEVEL[minRole]) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Your role is not allowed to do this",
      });
    }
    return next({ ctx: { ...ctx, staff } });
  });
}

/**
 * Requires the SUPERADMIN role specifically — hardcoded like the permissions
 * domain, so the workflow rules guarded by it can never be taken away through
 * the matrix. Injects ctx.staff.
 */
export const superadminProcedure = publicQuery.use(({ ctx, next }) => {
  const staff = extractStaff(ctx);
  if (staff.role !== "superadmin") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Only the super admin can do this",
    });
  }
  return next({ ctx: { ...ctx, staff } });
});

/**
 * Requires the caller's role to hold `need` (view/manage) in `domain` under
 * the effective permission matrix. Injects ctx.staff. This is the standard
 * gate for every domain-protected endpoint.
 */
export function permProcedure(domain: DomainKey, need: Exclude<PermLevel, "none">) {
  return publicQuery.use(async ({ ctx, next }) => {
    const staff = extractStaff(ctx);
    const db = getDb();
    const allowed = await roleHas(db, staff.role as StaffRole, domain, need);
    if (!allowed) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `Your role does not have ${need} access to ${domain} — ask an admin to adjust the permission matrix`,
      });
    }
    return next({ ctx: { ...ctx, staff } });
  });
}
