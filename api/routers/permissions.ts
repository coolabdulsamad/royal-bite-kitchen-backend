import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { createRouter } from "../middleware";
import { authedProcedure, permProcedure } from "../auth/guards";
import { getDb } from "../queries/connection";
import { rolePermissions } from "../../db/schema";
import {
  DEFAULT_ROLE_PERMISSIONS,
  EDITABLE_DOMAINS,
  PERMISSION_DOMAINS,
  PERM_LEVELS,
  effectivePermissions,
  type DomainKey,
  type PermissionOverride,
} from "@contracts/permissions";
import { ROLE_LEVEL, STAFF_ROLES, type StaffRole } from "@contracts/roles";
import { bustPermissionsCache, permissionsFor } from "../permissions";
import { logEvent } from "../audit";

const DOMAIN_KEYS = PERMISSION_DOMAINS.map((d) => d.key) as [DomainKey, ...DomainKey[]];

/** Roles whose cells `actorRole` may edit: strictly below your own level. */
function editableRoles(actorRole: StaffRole): StaffRole[] {
  return STAFF_ROLES.filter((r) => ROLE_LEVEL[r] < ROLE_LEVEL[actorRole]);
}

export const permissionsRouter = createRouter({
  /**
   * The full matrix for the editor UI: factory defaults, stored overrides,
   * effective levels, plus which roles/domains the caller may actually edit.
   */
  matrix: permProcedure("permissions", "manage").query(async ({ ctx }) => {
    const db = getDb();
    const rows = await db.select().from(rolePermissions);
    const overrides: PermissionOverride[] = rows.map((r) => ({
      role: r.role as StaffRole,
      domain: r.domain as DomainKey,
      level: r.level,
    }));
    const roles = STAFF_ROLES.map((role) => ({
      role,
      defaults: DEFAULT_ROLE_PERMISSIONS[role],
      effective: effectivePermissions(role, overrides),
    }));
    return {
      domains: PERMISSION_DOMAINS,
      roles,
      overrides,
      editableRoles: editableRoles(ctx.staff.role as StaffRole),
      editableDomains: EDITABLE_DOMAINS.map((d) => d.key),
    };
  }),

  /**
   * Batch-apply matrix edits. Guards: you can only edit roles below your own
   * level; the superadmin row and the permissions domain are hardcoded and
   * reject every change — the matrix can never lock out the admins.
   */
  setMatrix: permProcedure("permissions", "manage")
    .input(
      z.object({
        changes: z
          .array(
            z.object({
              role: z.enum(STAFF_ROLES),
              domain: z.enum(DOMAIN_KEYS),
              /** Absolute level for the cell; "default" removes the override. */
              level: z.enum([...PERM_LEVELS, "default"] as const),
            }),
          )
          .min(1)
          .max(200),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const actorRole = ctx.staff.role as StaffRole;
      const editable = new Set<StaffRole>(editableRoles(actorRole));
      const editableDomains = new Set<string>(EDITABLE_DOMAINS.map((d) => d.key));

      for (const c of input.changes) {
        if (c.role === "superadmin") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "The Super Admin row is fixed at full access",
          });
        }
        if (!editableDomains.has(c.domain)) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "The permission-matrix permission itself cannot be edited",
          });
        }
        if (!editable.has(c.role)) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: `You can only edit roles below your own — ${c.role} is out of your reach`,
          });
        }
      }

      const db = getDb();
      await db.transaction(async (tx) => {
        for (const c of input.changes) {
          if (c.level === "default") {
            await tx
              .delete(rolePermissions)
              .where(
                and(
                  eq(rolePermissions.role, c.role),
                  eq(rolePermissions.domain, c.domain),
                ),
              );
          } else {
            await tx
              .insert(rolePermissions)
              .values({
                role: c.role,
                domain: c.domain,
                level: c.level,
                updatedById: ctx.staff.sub,
              })
              .onDuplicateKeyUpdate({
                set: { level: c.level, updatedById: ctx.staff.sub },
              });
          }
        }
      });
      bustPermissionsCache();

      void logEvent(db, {
        actor: ctx.staff,
        action: "permissions.update",
        entityType: "role",
        entityId: null,
        detail: input.changes
          .map((c) => `${c.role}.${c.domain} → ${c.level}`)
          .join("; ")
          .slice(0, 480),
      });
      return { ok: true as const, applied: input.changes.length };
    }),

  /** Any signed-in staff member's own effective map — auth.me uses this too. */
  mine: authedProcedure.query(async ({ ctx }) => {
    const db = getDb();
    return permissionsFor(db, ctx.staff.role as StaffRole);
  }),
});
