import type { LucideIcon } from "lucide-react";
import {
  ShoppingCart,
  ClipboardList,
  History,
  BookOpen,
  Users,
  Wallet,
  Package,
  UserCog,
  BarChart3,
  Settings,
  KeyRound,
  Clock,
  ScrollText,
  HandCoins,
  ShieldCheck,
} from "lucide-react";
import type { DomainKey, PermLevel } from "@contracts/permissions";
import { hasAnyPerm, hasPerm, type PermCheck } from "@/lib/perms";
import type { PermissionMap } from "@contracts/permissions";

export interface NavItem {
  title: string;
  path: string;
  icon: LucideIcon;
  phase: string;
  /** Single gate: user needs this domain level (manage satisfies view). */
  perm?: [DomainKey, Exclude<PermLevel, "none">];
  /** Multi-gate: ANY of these grants access (e.g. Money = any money domain). */
  permAny?: PermCheck[];
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Service",
    items: [
      { title: "New Sale", path: "/pos", icon: ShoppingCart, phase: "Live", perm: ["pos", "manage"] },
      { title: "Orders", path: "/orders", icon: ClipboardList, phase: "Live", perm: ["orders", "view"] },
      { title: "Sales History", path: "/sales", icon: History, phase: "Live", perm: ["sales", "view"] },
    ],
  },
  {
    label: "Management",
    items: [
      { title: "Menu", path: "/menu", icon: BookOpen, phase: "Live", perm: ["menu", "view"] },
      { title: "Customers", path: "/customers", icon: Users, phase: "Live", perm: ["customers", "view"] },
      { title: "Stock", path: "/stock", icon: Package, phase: "Live", perm: ["stock", "view"] },
      {
        title: "Money",
        path: "/money",
        icon: Wallet,
        phase: "Live",
        permAny: [
          ["expenses", "view"],
          ["drawer", "view"],
          ["terminals", "view"],
        ],
      },
      { title: "Settlements", path: "/settlements", icon: HandCoins, phase: "Live", perm: ["settlements", "view"] },
      { title: "Staff", path: "/staff", icon: UserCog, phase: "Live", perm: ["staff", "view"] },
      { title: "Reports", path: "/reports", icon: BarChart3, phase: "Live", perm: ["reports", "view"] },
    ],
  },
  {
    label: "System",
    items: [
      { title: "My Account", path: "/account", icon: KeyRound, phase: "Live" },
      { title: "Attendance", path: "/attendance", icon: Clock, phase: "Live" },
      { title: "Activity", path: "/activity", icon: ScrollText, phase: "Live", perm: ["activity", "view"] },
      { title: "Settings", path: "/settings", icon: Settings, phase: "Live", perm: ["settings", "view"] },
      { title: "Permissions", path: "/permissions", icon: ShieldCheck, phase: "Live", perm: ["permissions", "manage"] },
    ],
  },
];

export const ALL_NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((group) => group.items);

/** True when the user may see this nav item / open this route. */
export function navItemAllowed(item: NavItem, map: PermissionMap): boolean {
  if (item.permAny) return hasAnyPerm(map, item.permAny);
  if (item.perm) return hasPerm(map, item.perm[0], item.perm[1]);
  return true;
}

/** Where a user should land after login: first permitted page. */
export function homePathFor(map: PermissionMap | undefined): string {
  const safe = map ?? {};
  const first = ALL_NAV_ITEMS.find(
    (item) => item.path !== "/account" && navItemAllowed(item, safe),
  );
  return first?.path ?? "/account";
}
