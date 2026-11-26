// Permission matrix — shared by API enforcement and frontend gating.
//
// Every page and every sensitive action belongs to a DOMAIN. A role's level
// in a domain is none | view | manage (manage implies view). Defaults below
// are the factory matrix; admins can override per role×domain in the
// role_permissions table — the effective matrix = defaults + overrides.
// The "permissions" domain itself (editing this matrix) is hardcoded and can
// never be overridden, so nobody can lock the admins out.

import type { StaffRole } from "./roles";

export const PERM_LEVELS = ["none", "view", "manage"] as const;
export type PermLevel = (typeof PERM_LEVELS)[number];

export interface PermissionDomain {
  key: string;
  label: string;
  description: string;
  /** Domain supports the view level (page/report access). */
  hasView: boolean;
  /** Domain supports the manage level (create/edit/void/approve). */
  hasManage: boolean;
}

export const PERMISSION_DOMAINS: PermissionDomain[] = [
  { key: "pos", label: "New Sale (POS)", description: "Ring up sales and take payment at the till", hasView: false, hasManage: true },
  { key: "orders", label: "Orders board", description: "Kitchen/delivery tickets — advance or cancel", hasView: true, hasManage: true },
  { key: "sales", label: "Sales history", description: "Own sales; manage = process returns", hasView: true, hasManage: true },
  { key: "salesAll", label: "All staff sales", description: "See every staff member's sales, not just your own", hasView: true, hasManage: false },
  { key: "menu", label: "Menu", description: "Dishes, categories, prices, modifiers", hasView: true, hasManage: true },
  { key: "stock", label: "Stock", description: "Inventory items, restock/usage/waste, adjustments", hasView: true, hasManage: true },
  { key: "customers", label: "Customers", description: "Customer records, credit, repayments", hasView: true, hasManage: true },
  { key: "expenses", label: "Expenses", description: "Record and void expenses", hasView: true, hasManage: true },
  { key: "expenseApprovals", label: "Expense approvals", description: "Approve or reject expenses waiting for sign-off", hasView: false, hasManage: true },
  { key: "drawer", label: "Cash drawer", description: "Expected cash, drawer counts, count history", hasView: true, hasManage: true },
  { key: "terminals", label: "POS terminals", description: "Bank POS terminals and their daily stats", hasView: true, hasManage: true },
  { key: "settlements", label: "Settlements", description: "Delivery-partner invoices and batch payments", hasView: true, hasManage: true },
  { key: "reports", label: "Reports & insights", description: "Analytics, KPIs, AI insights", hasView: true, hasManage: false },
  { key: "activity", label: "Activity log", description: "Audit trail of sensitive actions", hasView: true, hasManage: false },
  { key: "staff", label: "Staff", description: "Staff accounts and roles", hasView: true, hasManage: true },
  { key: "settings", label: "Settings", description: "Restaurant profile and receipt layout", hasView: true, hasManage: true },
  { key: "attendanceTeam", label: "Team attendance", description: "Everyone's clock-in/out records", hasView: true, hasManage: false },
  { key: "partners", label: "Delivery partners", description: "Glovo/Chowdeck connections and webhook tokens", hasView: true, hasManage: true },
  /** Meta-domain: editing this matrix. Hardcoded admin+ — not overridable. */
  { key: "permissions", label: "Permission matrix", description: "Edit what each role can do (this page)", hasView: false, hasManage: true },
];

export type DomainKey = (typeof PERMISSION_DOMAINS)[number]["key"];

/** Effective access a role has, domain → level (only non-"none" entries). */
export type PermissionMap = Partial<Record<DomainKey, Exclude<PermLevel, "none">>>;

const V = "view" as const;
const M = "manage" as const;

/** Factory matrix — what each role can do before any admin overrides. */
export const DEFAULT_ROLE_PERMISSIONS: Record<StaffRole, PermissionMap> = {
  sales: {
    pos: M,
    orders: M,
    sales: V, // own sales only
    customers: M,
    drawer: M,
  },
  "ordering-sales": {
    pos: M,
    orders: M,
    sales: V,
    customers: M,
    drawer: M,
  },
  accountant: {
    sales: V,
    salesAll: V,
    customers: V,
    expenses: M,
    drawer: M,
    terminals: M,
    settlements: M,
    reports: V,
    activity: V,
    attendanceTeam: V,
    stock: V,
  },
  auditor: {
    orders: V,
    sales: V,
    salesAll: V,
    menu: V,
    stock: V,
    customers: V,
    expenses: V,
    drawer: V,
    terminals: V,
    settlements: V,
    reports: V,
    activity: V,
    attendanceTeam: V,
    partners: V,
    staff: V,
  },
  manager: {
    pos: M,
    orders: M,
    sales: M,
    salesAll: V,
    menu: M,
    stock: M,
    customers: M,
    expenses: M,
    drawer: M,
    terminals: M,
    settlements: M,
    reports: V,
    activity: V,
    attendanceTeam: V,
    partners: M,
  },
  admin: {
    pos: M,
    orders: M,
    sales: M,
    salesAll: V,
    menu: M,
    stock: M,
    customers: M,
    expenses: M,
    drawer: M,
    terminals: M,
    settlements: M,
    reports: V,
    activity: V,
    staff: M,
    settings: M,
    attendanceTeam: V,
    partners: M,
    permissions: M,
    expenseApprovals: M,
  },
  superadmin: {
    pos: M,
    orders: M,
    sales: M,
    salesAll: V,
    menu: M,
    stock: M,
    customers: M,
    expenses: M,
    drawer: M,
    terminals: M,
    settlements: M,
    reports: V,
    activity: V,
    staff: M,
    settings: M,
    attendanceTeam: V,
    partners: M,
    permissions: M,
    expenseApprovals: M,
  },
};

const RANK: Record<PermLevel, number> = { none: 0, view: 1, manage: 2 };

/** True when `have` satisfies `need` (manage implies view). */
export function levelSatisfies(
  have: PermLevel | undefined,
  need: PermLevel,
): boolean {
  return RANK[have ?? "none"] >= RANK[need];
}

/** Domains whose matrix cells are editable (permissions is hardcoded). */
export const EDITABLE_DOMAINS = PERMISSION_DOMAINS.filter(
  (d) => d.key !== "permissions",
);

/**
 * Role × domain override row as stored in role_permissions. The level is
 * absolute for that cell — "none" revokes a factory default; deleting the
 * row restores the factory default.
 */
export interface PermissionOverride {
  role: StaffRole;
  domain: DomainKey;
  level: PermLevel;
}

/**
 * Effective permission map for a role: factory defaults with admin overrides
 * applied on top. The permissions domain is always factory-controlled.
 */
export function effectivePermissions(
  role: StaffRole,
  overrides: PermissionOverride[],
): PermissionMap {
  const base: PermissionMap = { ...DEFAULT_ROLE_PERMISSIONS[role] };
  for (const o of overrides) {
    if (o.role !== role || o.domain === "permissions") continue;
    if (o.level === "none") {
      delete base[o.domain];
    } else {
      base[o.domain] = o.level;
    }
  }
  return base;
}
