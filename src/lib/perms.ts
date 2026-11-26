import { useMemo } from "react";
import { useAuth } from "@/lib/auth";
import {
  DEFAULT_ROLE_PERMISSIONS,
  levelSatisfies,
  type DomainKey,
  type PermLevel,
  type PermissionMap,
} from "@contracts/permissions";

export type PermCheck = [DomainKey, Exclude<PermLevel, "none">];

/**
 * The signed-in user's effective permission map. auth.me returns it; a stale
 * cached user (pre-permissions) falls back to the factory matrix for the role
 * so the UI never locks itself out between deploys.
 */
export function usePermissionMap(): PermissionMap {
  const { user } = useAuth();
  return useMemo(() => {
    if (!user) return {};
    return user.permissions ?? DEFAULT_ROLE_PERMISSIONS[user.role] ?? {};
  }, [user]);
}

/** True when the user's level in `domain` satisfies `need` (manage ⊇ view). */
export function hasPerm(
  map: PermissionMap,
  domain: DomainKey,
  need: Exclude<PermLevel, "none">,
): boolean {
  return levelSatisfies(map[domain], need);
}

export function hasAnyPerm(map: PermissionMap, checks: PermCheck[]): boolean {
  return checks.some(([d, l]) => hasPerm(map, d, l));
}

/** Hook: has(domain, need) + hasAny(checks) bound to the current user. */
export function usePerms() {
  const map = usePermissionMap();
  return useMemo(
    () => ({
      map,
      has: (domain: DomainKey, need: Exclude<PermLevel, "none"> = "view") =>
        hasPerm(map, domain, need),
      hasAny: (checks: PermCheck[]) => hasAnyPerm(map, checks),
    }),
    [map],
  );
}
