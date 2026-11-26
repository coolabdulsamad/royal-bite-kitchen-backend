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
} from "lucide-react";
import type { StaffRole } from "@contracts/roles";

export interface NavItem {
  title: string;
  path: string;
  icon: LucideIcon;
  phase: string;
  minRole: StaffRole;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Service",
    items: [
      { title: "New Sale", path: "/pos", icon: ShoppingCart, phase: "Live", minRole: "sales" },
      { title: "Orders", path: "/orders", icon: ClipboardList, phase: "Live", minRole: "sales" },
      { title: "Sales History", path: "/sales", icon: History, phase: "Live", minRole: "sales" },
    ],
  },
  {
    label: "Management",
    items: [
      { title: "Menu", path: "/menu", icon: BookOpen, phase: "Live", minRole: "manager" },
      { title: "Customers", path: "/customers", icon: Users, phase: "Live", minRole: "sales" },
      { title: "Stock", path: "/stock", icon: Package, phase: "Live", minRole: "sales" },
      { title: "Money", path: "/money", icon: Wallet, phase: "Live", minRole: "sales" },
      { title: "Staff", path: "/staff", icon: UserCog, phase: "Live", minRole: "admin" },
      { title: "Reports", path: "/reports", icon: BarChart3, phase: "Live", minRole: "manager" },
    ],
  },
  {
    label: "System",
    items: [
      { title: "My Account", path: "/account", icon: KeyRound, phase: "Live", minRole: "sales" },
      { title: "Attendance", path: "/attendance", icon: Clock, phase: "Live", minRole: "sales" },
      { title: "Activity", path: "/activity", icon: ScrollText, phase: "Live", minRole: "manager" },
      { title: "Settings", path: "/settings", icon: Settings, phase: "Live", minRole: "admin" },
    ],
  },
];

export const ALL_NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((group) => group.items);
