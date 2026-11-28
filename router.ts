import { createRouter, publicQuery } from "./middleware";
import { accountsRouter } from "./routers/accounts";
import { authRouter } from "./routers/auth";
import { attendanceRouter } from "./routers/attendance";
import { auditRouter } from "./routers/audit";
import { settingsRouter } from "./routers/settings";
import { customersRouter } from "./routers/customers";
import { insightsRouter } from "./routers/insights";
import { menuRouter } from "./routers/menu";
import { moneyRouter } from "./routers/money";
import { notificationsRouter } from "./routers/notifications";
import { ordersRouter } from "./routers/orders";
import { partnersRouter } from "./routers/partners";
import { permissionsRouter } from "./routers/permissions";
import { reportsRouter } from "./routers/reports";
import { salesRouter } from "./routers/sales";
import { settlementsRouter } from "./routers/settlements";
import { staffRouter } from "./routers/staff";
import { stockRouter } from "./routers/stock";
import { terminalsRouter } from "./routers/terminals";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),
  auth: authRouter,
  attendance: attendanceRouter,
  staff: staffRouter,
  menu: menuRouter,
  orders: ordersRouter,
  notifications: notificationsRouter,
  partners: partnersRouter,
  permissions: permissionsRouter,
  sales: salesRouter,
  settlements: settlementsRouter,
  terminals: terminalsRouter,
  money: moneyRouter,
  accounts: accountsRouter,
  reports: reportsRouter,
  insights: insightsRouter,
  audit: auditRouter,
  settings: settingsRouter,
  customers: customersRouter,
  stock: stockRouter,
});

export type AppRouter = typeof appRouter;
