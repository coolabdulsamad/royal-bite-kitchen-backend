import type { ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router";
import { AppShell } from "@/components/shell/AppShell";
import { RequireAuth } from "@/components/shell/RequireAuth";
import { ALL_NAV_ITEMS, homePathFor } from "@/lib/nav";
import { usePermissionMap } from "@/lib/perms";
import Login from "@/pages/Login";
import StaffPage from "@/pages/Staff";
import AccountPage from "@/pages/Account";
import MenuPage from "@/pages/Menu";
import PosPage from "@/pages/Pos";
import DisplayPage from "@/pages/Display";
import SalesPage from "@/pages/Sales";
import OrdersPage from "@/pages/Orders";
import MoneyPage from "@/pages/Money";
import ActivityPage from "@/pages/Activity";
import CustomersPage from "@/pages/Customers";
import StockPage from "@/pages/Stock";
import AttendancePage from "@/pages/Attendance";
import ReportsPage from "@/pages/Reports";
import SettingsPage from "@/pages/Settings";
import SettlementsPage from "@/pages/Settlements";
import PermissionsPage from "@/pages/Permissions";

/** Wrap a page in the nav item's permission gate (looked up by path). */
function gated(path: string, page: ReactNode) {
  const item = ALL_NAV_ITEMS.find((i) => i.path === path);
  return <RequireAuth item={item}>{page}</RequireAuth>;
}

function HomeRedirect() {
  const map = usePermissionMap();
  return <Navigate to={homePathFor(map)} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/display" element={<DisplayPage />} />
      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route path="/" element={<HomeRedirect />} />
        <Route path="/pos" element={gated("/pos", <PosPage />)} />
        <Route path="/orders" element={gated("/orders", <OrdersPage />)} />
        <Route path="/sales" element={gated("/sales", <SalesPage />)} />
        <Route path="/customers" element={gated("/customers", <CustomersPage />)} />
        <Route path="/stock" element={gated("/stock", <StockPage />)} />
        <Route path="/attendance" element={<AttendancePage />} />
        <Route path="/account" element={<AccountPage />} />
        <Route path="/menu" element={gated("/menu", <MenuPage />)} />
        <Route path="/money" element={gated("/money", <MoneyPage />)} />
        <Route path="/activity" element={gated("/activity", <ActivityPage />)} />
        <Route path="/reports" element={gated("/reports", <ReportsPage />)} />
        <Route path="/settlements" element={gated("/settlements", <SettlementsPage />)} />
        <Route path="/staff" element={gated("/staff", <StaffPage />)} />
        <Route path="/settings" element={gated("/settings", <SettingsPage />)} />
        <Route path="/permissions" element={gated("/permissions", <PermissionsPage />)} />
      </Route>
      <Route path="*" element={<HomeRedirect />} />
    </Routes>
  );
}
