/**
 * Permission resolution for the API. Overrides live in role_permissions and
 * are read on every guard check through a short-lived in-process cache — the
 * table is tiny and the database is remote, so one cached read serves many
 * requests; permission edits bust the cache immediately.
 */
import { sql } from "drizzle-orm";
import {
  effectivePermissions,
  levelSatisfies,
  type DomainKey,
  type PermLevel,
  type PermissionMap,
  type PermissionOverride,
} from "@contracts/permissions";
import type { StaffRole } from "@contracts/roles";

// Structural type — satisfied by the drizzle MySQL database.
import type { SQLWrapper } from "drizzle-orm";
import type { MySqlRawQueryResult } from "drizzle-orm/mysql2";
type DbLike = {
  execute: (query: string | SQLWrapper) => Promise<MySqlRawQueryResult>;
};

let cache: { at: number; rows: PermissionOverride[] } | null = null;
const TTL_MS = 30_000;

async function loadOverrides(db: DbLike): Promise<PermissionOverride[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.rows;
  const result = (await db.execute(
    sql`SELECT role, domain, level FROM role_permissions`,
  )) as unknown as [PermissionOverride[], unknown];
  const rows = result[0];
  const list = rows.map((r) => ({
    role: r.role,
    domain: r.domain,
    level: r.level,
  }));
  cache = { at: Date.now(), rows: list };
  return list;
}

/** Call after any write to role_permissions. */
export function bustPermissionsCache() {
  cache = null;
}

/** Effective permission map for a role (defaults + overrides). */
export async function permissionsFor(
  db: DbLike,
  role: StaffRole,
): Promise<PermissionMap> {
  return effectivePermissions(role, await loadOverrides(db));
}

/** True when the role's effective level in `domain` satisfies `need`. */
export async function roleHas(
  db: DbLike,
  role: StaffRole,
  domain: DomainKey,
  need: PermLevel,
): Promise<boolean> {
  const map = await permissionsFor(db, role);
  return levelSatisfies(map[domain], need);
}

/** True when ANY of the [domain, need] checks passes (single map load). */
export async function roleHasAny(
  db: DbLike,
  role: StaffRole,
  checks: [DomainKey, Exclude<PermLevel, "none">][],
): Promise<boolean> {
  const map = await permissionsFor(db, role);
  return checks.some(([d, l]) => levelSatisfies(map[d], l));
}
