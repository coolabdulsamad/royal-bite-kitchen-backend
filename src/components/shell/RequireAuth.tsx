import type { ReactNode } from "react";
import { Link, Navigate, useLocation } from "react-router";
import { ShieldAlert } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { usePermissionMap } from "@/lib/perms";
import { navItemAllowed, homePathFor, type NavItem } from "@/lib/nav";

function FullScreenLoader() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-royal-bg">
      <div className="flex flex-col items-center gap-4">
        <div className="h-8 w-8 animate-spin rounded-full border border-royal-line border-t-royal-accent" />
        <p className="text-[10px] uppercase tracking-[0.3em] text-royal-dim">
          Checking session
        </p>
      </div>
    </div>
  );
}

function NoAccess({ item }: { item: NavItem }) {
  const map = usePermissionMap();
  const home = homePathFor(map);
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <ShieldAlert className="h-10 w-10 text-royal-accent" strokeWidth={1.5} />
      <h2 className="mt-6 font-display text-3xl text-royal-cream">
        Restricted area
      </h2>
      <p className="mt-3 max-w-sm text-sm leading-6 text-royal-dim">
        Your role does not have access to{" "}
        <span className="text-royal-cream">{item.title}</span>. An admin can
        grant it on the Permissions page.
      </p>
      <Link
        to={home}
        className="mt-8 rounded-full border border-royal-accent px-6 py-2.5 text-xs font-semibold uppercase tracking-[0.2em] text-royal-accent transition-colors hover:bg-royal-accent hover:text-royal-bg"
      >
        Back to your area
      </Link>
    </div>
  );
}

export function RequireAuth({
  children,
  item,
}: {
  children: ReactNode;
  /** The nav item this route belongs to — its perm gates access. */
  item?: NavItem;
}) {
  const { status, user } = useAuth();
  const map = usePermissionMap();
  const location = useLocation();

  if (status === "loading") return <FullScreenLoader />;
  if (status === "anon" || !user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  if (item && !navItemAllowed(item, map)) {
    return <NoAccess item={item} />;
  }
  return <>{children}</>;
}
