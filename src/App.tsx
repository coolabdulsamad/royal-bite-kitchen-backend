import { Navigate, Route, Routes } from "react-router";
import { AppShell } from "@/components/shell/AppShell";
import { RequireAuth } from "@/components/shell/RequireAuth";
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
import { SettingsPage } from "@/pages/placeholders";

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
        <Route path="/" element={<Navigate to="/pos" replace />} />
        <Route path="/pos" element={<PosPage />} />
        <Route path="/orders" element={<OrdersPage />} />
        <Route path="/sales" element={<SalesPage />} />
        <Route path="/customers" element={<CustomersPage />} />
        <Route path="/stock" element={<StockPage />} />
        <Route path="/attendance" element={<AttendancePage />} />
        <Route path="/account" element={<AccountPage />} />
        <Route
          path="/menu"
          element={
            <RequireAuth minRole="manager">
              <MenuPage />
            </RequireAuth>
          }
        />
        <Route
          path="/money"
          element={
            <RequireAuth>
              <MoneyPage />
            </RequireAuth>
          }
        />
        <Route
          path="/activity"
          element={
            <RequireAuth minRole="manager">
              <ActivityPage />
            </RequireAuth>
          }
        />
        <Route
          path="/reports"
          element={
            <RequireAuth minRole="manager">
              <ReportsPage />
            </RequireAuth>
          }
        />
        <Route
          path="/staff"
          element={
            <RequireAuth minRole="admin">
              <StaffPage />
            </RequireAuth>
          }
        />
        <Route
          path="/settings"
          element={
            <RequireAuth minRole="admin">
              <SettingsPage />
            </RequireAuth>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/pos" replace />} />
    </Routes>
  );
}
