// Shared staff role definitions — imported by the API (db schema, guards)
// and the frontend (nav gating, role badges) so both sides agree exactly.

export const STAFF_ROLES = [
  "sales",
  "ordering-sales",
  "accountant",
  "auditor",
  "manager",
  "admin",
  "superadmin",
] as const;

export type StaffRole = (typeof STAFF_ROLES)[number];

/**
 * Ladder used ONLY for staff-management rules (who may create/edit whom) —
 * page and action access is governed by the permission matrix
 * (contracts/permissions.ts), NOT by this number. Accountant and auditor are
 * specialist roles that sit beside the ladder, not on it.
 */
export const ROLE_LEVEL: Record<StaffRole, number> = {
  sales: 1,
  "ordering-sales": 2,
  accountant: 2,
  auditor: 2,
  manager: 3,
  admin: 4,
  superadmin: 5,
};

export const ROLE_LABEL: Record<StaffRole, string> = {
  sales: "Cashier",
  "ordering-sales": "Ordering",
  accountant: "Accountant",
  auditor: "Auditor",
  manager: "Manager",
  admin: "Admin",
  superadmin: "Super Admin",
};

export function roleAtLeast(role: StaffRole, min: StaffRole): boolean {
  return ROLE_LEVEL[role] >= ROLE_LEVEL[min];
}
