import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { AlertTriangle, Bell, LogOut, Menu, PanelLeftClose, PanelLeftOpen, X, XCircle } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { useBusinessSettings } from "@/lib/businessSettings";
import { PrinterMenu } from "@/components/PrinterMenu";
import { SyncMenu } from "@/components/SyncMenu";
import { outboxStore } from "@/lib/offline";
import { ALL_NAV_ITEMS, NAV_GROUPS, navItemAllowed, type NavItem } from "@/lib/nav";
import { useAuth } from "@/lib/auth";
import { ROLE_LABEL } from "@contracts/roles";
import { usePerms } from "@/lib/perms";

function BrandBlock({ collapsed = false }: { collapsed?: boolean }) {
  return (
    <div
      className={`flex h-16 items-center gap-3 border-b border-royal-line ${
        collapsed ? "justify-center px-0" : "px-5"
      }`}
    >
      <img
        src="/logo.jpeg"
        alt="Royal Bite Kitchen"
        className="h-9 w-9 shrink-0 rounded-sm object-cover"
      />
      {!collapsed && (
        <div>
          <p className="font-display text-lg leading-none tracking-wide text-royal-cream">
            ROYAL BITE
          </p>
          <p className="mt-1 text-[9px] uppercase tracking-[0.35em] text-royal-dim">
            Kitchen · POS
          </p>
        </div>
      )}
    </div>
  );
}

function Nav({
  onNavigate,
  collapsed = false,
}: {
  onNavigate?: () => void;
  collapsed?: boolean;
}) {
  const { map } = usePerms();

  const visibleGroups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item: NavItem) => navItemAllowed(item, map)),
  })).filter((group) => group.items.length > 0);

  return (
    <nav className="royal-scroll flex-1 overflow-y-auto py-4">
      {visibleGroups.map((group) => (
        <div key={group.label} className="mb-5">
          {collapsed ? (
            <div className="mx-4 mb-2 border-t border-royal-line/60" />
          ) : (
            <p className="mb-2 px-5 text-[10px] font-semibold uppercase tracking-[0.25em] text-royal-dim/70">
              {group.label}
            </p>
          )}
          {group.items.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              onClick={onNavigate}
              title={collapsed ? item.title : undefined}
              aria-label={item.title}
              className={({ isActive }) =>
                `flex items-center gap-3 border-l-2 py-2.5 text-sm transition-colors duration-150 ${
                  collapsed ? "justify-center px-0" : "px-5"
                } ${
                  isActive
                    ? "border-royal-accent bg-royal-faint/40 text-royal-cream"
                    : "border-transparent text-royal-dim hover:bg-royal-faint/20 hover:text-royal-cream"
                }`
              }
            >
              <item.icon className="h-4 w-4 shrink-0" strokeWidth={1.75} />
              {!collapsed && <span className="flex-1">{item.title}</span>}
            </NavLink>
          ))}
        </div>
      ))}
    </nav>
  );
}

function SidebarFooter({
  collapsed = false,
  onToggle,
}: {
  collapsed?: boolean;
  onToggle?: () => void;
}) {
  return (
    <div
      className={`flex items-center border-t border-royal-line py-3 ${
        collapsed ? "justify-center px-0" : "justify-between px-5"
      }`}
    >
      {!collapsed && (
        <p className="text-[10px] tracking-wide text-royal-dim/60">
          v24 · Royal Bite Kitchen POS
        </p>
      )}
      {onToggle && (
        <button
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          data-testid="sidebar-toggle"
          className="p-1.5 text-royal-dim transition-colors hover:text-royal-cream"
        >
          {collapsed ? (
            <PanelLeftOpen className="h-4 w-4" strokeWidth={1.75} />
          ) : (
            <PanelLeftClose className="h-4 w-4" strokeWidth={1.75} />
          )}
        </button>
      )}
    </div>
  );
}

function AlertsBell() {
  const { has } = usePerms();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const canSeeAlerts = has("reports", "view");

  const today = new Date();
  const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const alerts = trpc.insights.generate.useQuery(
    { from: iso, to: iso },
    { enabled: canSeeAlerts, refetchInterval: 120_000 },
  );
  const items = (alerts.data?.insights ?? []).filter((i) => i.tone === "bad" || i.tone === "warn");

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  if (!canSeeAlerts) return null;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-label="Alerts"
        title="Alerts"
        onClick={() => setOpen((v) => !v)}
        className="relative p-2 text-royal-dim transition-colors hover:text-royal-cream"
        data-testid="alerts-bell"
      >
        <Bell className="h-4 w-4" strokeWidth={1.75} />
        {items.length > 0 && (
          <span
            className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white"
            data-testid="alerts-badge"
          >
            {items.length}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-80 border border-royal-line bg-royal-panel shadow-2xl" data-testid="alerts-panel">
          <p className="border-b border-royal-line px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.25em] text-royal-accent">
            Needs attention · today
          </p>
          {items.length === 0 ? (
            <p className="px-4 py-5 text-sm text-royal-dim">
              Nothing needs attention right now.
            </p>
          ) : (
            <div className="max-h-80 divide-y divide-royal-line overflow-y-auto">
              {items.map((i) => (
                <div key={i.id} className="px-4 py-3" data-testid={`alert-${i.id}`}>
                  <p className={`flex items-center gap-2 text-sm font-semibold ${i.tone === "bad" ? "text-red-300" : "text-amber-300"}`}>
                    {i.tone === "bad" ? (
                      <XCircle className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
                    ) : (
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
                    )}
                    {i.title}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-royal-dim">{i.body}</p>
                </div>
              ))}
            </div>
          )}
          <NavLink
            to="/reports"
            onClick={() => setOpen(false)}
            className="block border-t border-royal-line px-4 py-3 text-center text-[10px] font-semibold uppercase tracking-[0.25em] text-royal-accent transition-colors hover:bg-royal-faint/40"
          >
            Open reports
          </NavLink>
        </div>
      )}
    </div>
  );
}

function UserChip() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  if (!user) return null;

  return (
    <div className="flex items-center gap-3">
      <NavLink to="/account" className="group flex items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-full border border-royal-line text-[11px] font-semibold text-royal-accent">
          {user.name
            .split(" ")
            .map((part) => part[0])
            .slice(0, 2)
            .join("")
            .toUpperCase()}
        </span>
        <span className="hidden text-left sm:block">
          <span className="block text-xs leading-4 text-royal-cream transition-colors group-hover:text-royal-accent">
            {user.name}
          </span>
          <span className="block text-[9px] uppercase tracking-[0.2em] text-royal-dim">
            {ROLE_LABEL[user.role]} · {user.staffCode}
          </span>
        </span>
      </NavLink>
      <button
        type="button"
        aria-label="Sign out"
        title="Sign out"
        onClick={() => {
          logout();
          navigate("/login", { replace: true });
        }}
        className="p-2 text-royal-dim transition-colors hover:text-royal-accent"
      >
        <LogOut className="h-4 w-4" strokeWidth={1.75} />
      </button>
    </div>
  );
}

export function AppShell() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem("rbk.sidebar") === "collapsed",
  );
  const location = useLocation();
  const ping = trpc.ping.useQuery(undefined, {
    refetchInterval: 30_000,
    retry: 1,
  });
  const apiOnline = Boolean(ping.data) && !ping.isError;

  function toggleSidebar() {
    setCollapsed((v) => {
      const next = !v;
      localStorage.setItem("rbk.sidebar", next ? "collapsed" : "expanded");
      return next;
    });
  }

  // Keep business settings (receipt name/footer) warm for direct printing.
  useBusinessSettings();

  // Start the offline outbox (auto-sync on reconnect + interval).
  useEffect(() => {
    void outboxStore.init();
  }, []);

  const current = ALL_NAV_ITEMS.find((item) => item.path === location.pathname);

  return (
    <div className="min-h-screen bg-royal-bg font-sans text-royal-cream">
      {/* Desktop sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 hidden flex-col border-r border-royal-line bg-royal-bgsoft transition-[width] duration-200 lg:flex ${
          collapsed ? "w-20" : "w-64"
        }`}
        data-testid="desktop-sidebar"
      >
        <BrandBlock collapsed={collapsed} />
        <Nav collapsed={collapsed} />
        <SidebarFooter collapsed={collapsed} onToggle={toggleSidebar} />
      </aside>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setDrawerOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 flex w-72 flex-col border-r border-royal-line bg-royal-bgsoft">
            <div className="flex items-center justify-between border-b border-royal-line pr-3">
              <BrandBlock />
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="p-2 text-royal-dim transition-colors hover:text-royal-cream"
                aria-label="Close menu"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <Nav onNavigate={() => setDrawerOpen(false)} />
            <SidebarFooter />
          </aside>
        </div>
      )}

      {/* Main column */}
      <div
        className={`transition-[padding] duration-200 ${
          collapsed ? "lg:pl-20" : "lg:pl-64"
        }`}
      >
        <header className="sticky top-0 z-40 flex h-16 items-center gap-3 border-b border-royal-line bg-royal-bg/85 px-4 backdrop-blur-md sm:px-6">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="p-2 text-royal-dim transition-colors hover:text-royal-cream lg:hidden"
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </button>
          <h1 className="font-display text-xl text-royal-cream">
            {current?.title ?? "Royal Bite Kitchen"}
          </h1>

          <div className="ml-auto flex items-center gap-4">
            <SyncMenu />
            <PrinterMenu />
            <AlertsBell />
            <span className="hidden items-center gap-2 text-xs text-royal-dim md:flex">
              <span
                className={`inline-block h-1.5 w-1.5 rounded-full ${
                  ping.isLoading
                    ? "bg-amber-400"
                    : apiOnline
                      ? "bg-emerald-400"
                      : "bg-rose-500"
                }`}
              />
              {ping.isLoading ? "Connecting…" : apiOnline ? "API online" : "API offline"}
            </span>
            <UserChip />
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1400px] p-4 sm:p-6 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
