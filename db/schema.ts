import { relations } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  int,
  mysqlEnum,
  mysqlTable,
  serial,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";
import { STAFF_ROLES } from "../contracts/roles";

// ---------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------

export const users = mysqlTable("users", {
  id: serial("id").primaryKey(),
  staffCode: varchar("staff_code", { length: 20 }).notNull().unique(),
  name: varchar("name", { length: 120 }).notNull(),
  username: varchar("username", { length: 60 }).notNull().unique(),
  secretHash: varchar("secret_hash", { length: 120 }).notNull(),
  role: mysqlEnum("role", STAFF_ROLES).notNull().default("sales"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
});

export type User = typeof users.$inferSelect;

// ---------------------------------------------------------------------------
// Menu
// Money is stored as integer KOBO (₦1 = 100 kobo) so totals are always exact.
// ---------------------------------------------------------------------------

export const categories = mysqlTable("categories", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 80 }).notNull(),
  sortOrder: int("sort_order").notNull().default(0),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const menuItems = mysqlTable("menu_items", {
  id: serial("id").primaryKey(),
  categoryId: bigint("category_id", { mode: "number", unsigned: true })
    .notNull()
    .references(() => categories.id),
  name: varchar("name", { length: 120 }).notNull(),
  description: varchar("description", { length: 500 }),
  priceKobo: int("price_kobo").notNull(),
  available: boolean("available").notNull().default(true),
  sortOrder: int("sort_order").notNull().default(0),
  imageUrl: varchar("image_url", { length: 500 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
});

export const modifierGroups = mysqlTable("modifier_groups", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 80 }).notNull(),
  selectionType: mysqlEnum("selection_type", ["single", "multi"])
    .notNull()
    .default("single"),
  required: boolean("required").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const modifierOptions = mysqlTable("modifier_options", {
  id: serial("id").primaryKey(),
  groupId: bigint("group_id", { mode: "number", unsigned: true })
    .notNull()
    .references(() => modifierGroups.id),
  name: varchar("name", { length: 80 }).notNull(),
  priceDeltaKobo: int("price_delta_kobo").notNull().default(0),
  active: boolean("active").notNull().default(true),
});

export const itemModifierGroups = mysqlTable("item_modifier_groups", {
  id: serial("id").primaryKey(),
  itemId: bigint("item_id", { mode: "number", unsigned: true })
    .notNull()
    .references(() => menuItems.id),
  groupId: bigint("group_id", { mode: "number", unsigned: true })
    .notNull()
    .references(() => modifierGroups.id),
  sortOrder: int("sort_order").notNull().default(0),
});

// ---------------------------------------------------------------------------
// Relations (powers the db.query.* relational API)
// ---------------------------------------------------------------------------

export const categoriesRelations = relations(categories, ({ many }) => ({
  items: many(menuItems),
}));

export const menuItemsRelations = relations(menuItems, ({ one, many }) => ({
  category: one(categories, {
    fields: [menuItems.categoryId],
    references: [categories.id],
  }),
  modifierLinks: many(itemModifierGroups),
}));

export const modifierGroupsRelations = relations(
  modifierGroups,
  ({ many }) => ({
    options: many(modifierOptions),
    itemLinks: many(itemModifierGroups),
  }),
);

export const modifierOptionsRelations = relations(
  modifierOptions,
  ({ one }) => ({
    group: one(modifierGroups, {
      fields: [modifierOptions.groupId],
      references: [modifierGroups.id],
    }),
  }),
);

export const itemModifierGroupsRelations = relations(
  itemModifierGroups,
  ({ one }) => ({
    item: one(menuItems, {
      fields: [itemModifierGroups.itemId],
      references: [menuItems.id],
    }),
    group: one(modifierGroups, {
      fields: [itemModifierGroups.groupId],
      references: [modifierGroups.id],
    }),
  }),
);

export type Category = typeof categories.$inferSelect;
export type MenuItem = typeof menuItems.$inferSelect;
export type ModifierGroup = typeof modifierGroups.$inferSelect;
export type ModifierOption = typeof modifierOptions.$inferSelect;

// ---------------------------------------------------------------------------
// Customers — regulars + credit tabs. The balance is maintained
// transactionally: credit sales raise it, repayments lower it, and
// conditional UPDATEs keep it from ever going negative.
// ---------------------------------------------------------------------------

export const customers = mysqlTable("customers", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 120 }).notNull(),
  /** Optional but unique when present — MySQL allows multiple NULLs. */
  phone: varchar("phone", { length: 40 }).unique(),
  notes: varchar("notes", { length: 255 }),
  /** Outstanding credit in kobo (goods taken, not yet paid for). */
  creditBalanceKobo: int("credit_balance_kobo").notNull().default(0),
  active: boolean("active").notNull().default(true),
  createdById: bigint("created_by_id", { mode: "number", unsigned: true }).references(
    () => users.id,
  ),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/** A repayment against a customer's credit balance. */
export const customerPayments = mysqlTable("customer_payments", {
  id: serial("id").primaryKey(),
  customerId: bigint("customer_id", { mode: "number", unsigned: true })
    .notNull()
    .references(() => customers.id),
  amountKobo: int("amount_kobo").notNull(),
  method: mysqlEnum("method", ["cash", "bank_pos", "transfer"]).notNull(),
  reference: varchar("reference", { length: 120 }),
  note: varchar("note", { length: 255 }),
  receivedById: bigint("received_by_id", { mode: "number", unsigned: true })
    .notNull()
    .references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type Customer = typeof customers.$inferSelect;
export type CustomerPayment = typeof customerPayments.$inferSelect;

// ---------------------------------------------------------------------------
// Stock — ingredients & supplies. Quantities are integer MILLI-UNITS
// (1 unit = 1000) so 2.5 kg stays exact without float errors. Every change
// is a movement row with the staff member who recorded it.
// ---------------------------------------------------------------------------

export const stockItems = mysqlTable("stock_items", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 120 }).notNull(),
  /** Display unit: kg, L, pack, bottle, pcs, crate… */
  unit: varchar("unit", { length: 20 }).notNull(),
  /** Current quantity × 1000. */
  quantityMilli: int("quantity_milli").notNull().default(0),
  /** Low-stock warning threshold × 1000 (null = no warning). */
  lowStockAtMilli: int("low_stock_at_milli"),
  /** Last known cost per unit, informational (kobo). */
  costPerUnitKobo: int("cost_per_unit_kobo"),
  active: boolean("active").notNull().default(true),
  createdById: bigint("created_by_id", { mode: "number", unsigned: true }).references(
    () => users.id,
  ),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const stockMovements = mysqlTable("stock_movements", {
  id: serial("id").primaryKey(),
  itemId: bigint("item_id", { mode: "number", unsigned: true })
    .notNull()
    .references(() => stockItems.id),
  /** restock +, usage −, waste −, adjustment ± (manager only). */
  type: mysqlEnum("type", ["restock", "usage", "waste", "adjustment"]).notNull(),
  /** Signed quantity change × 1000. */
  deltaMilli: int("delta_milli").notNull(),
  /** Quantity after this movement × 1000 (audit snapshot). */
  balanceAfterMilli: int("balance_after_milli").notNull(),
  /** Restock cost, informational for now — feeds expenses in a later step. */
  totalCostKobo: int("total_cost_kobo"),
  note: varchar("note", { length: 255 }),
  staffId: bigint("staff_id", { mode: "number", unsigned: true })
    .notNull()
    .references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type StockItem = typeof stockItems.$inferSelect;
export type StockMovement = typeof stockMovements.$inferSelect;

// ---------------------------------------------------------------------------
// Sales — line prices/modifiers are SNAPSHOTS: editing the menu later never
// rewrites history. Money stays in integer kobo.
// ---------------------------------------------------------------------------

export const sales = mysqlTable("sales", {
  id: serial("id").primaryKey(),
  receiptNo: varchar("receipt_no", { length: 20 }).notNull().unique(),
  staffId: bigint("staff_id", { mode: "number", unsigned: true })
    .notNull()
    .references(() => users.id),
  subtotalKobo: int("subtotal_kobo").notNull(),
  discountKobo: int("discount_kobo").notNull().default(0),
  totalKobo: int("total_kobo").notNull(),
  status: mysqlEnum("status", ["completed", "held", "returned"])
    .notNull()
    .default("completed"),
  /**
   * Idempotency key from the selling device (offline outbox). A retried sync
   * carries the same ref, so the server returns the existing sale instead of
   * recording a duplicate.
   */
  clientRef: varchar("client_ref", { length: 64 }).unique(),
  /** Business date of the sale — usually now, but manager+ can backdate. */
  soldAt: timestamp("sold_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  /** Return metadata — set together when a finished sale is returned (manager+). */
  returnedAt: timestamp("returned_at"),
  returnedById: bigint("returned_by_id", { mode: "number", unsigned: true }).references(
    () => users.id,
  ),
  returnReason: varchar("return_reason", { length: 255 }),
  /** Customer attached to this sale (regulars + credit tabs). */
  customerId: bigint("customer_id", { mode: "number", unsigned: true }).references(
    () => customers.id,
  ),
  /** Part of the total left unpaid on the customer's credit tab. Requires
   *  customerId; 0 for fully-paid sales. */
  creditKobo: int("credit_kobo").notNull().default(0),
});

export const saleItems = mysqlTable("sale_items", {
  id: serial("id").primaryKey(),
  saleId: bigint("sale_id", { mode: "number", unsigned: true })
    .notNull()
    .references(() => sales.id),
  /** Kept for analytics; nullable so deleting a menu item keeps history. */
  itemId: bigint("item_id", { mode: "number", unsigned: true }).references(
    () => menuItems.id,
  ),
  itemName: varchar("item_name", { length: 120 }).notNull(),
  unitPriceKobo: int("unit_price_kobo").notNull(),
  /** JSON snapshot: [{group, option, priceDeltaKobo}] */
  modifiersJson: varchar("modifiers_json", { length: 2000 }),
  quantity: int("quantity").notNull(),
  lineTotalKobo: int("line_total_kobo").notNull(),
});

/**
 * Physical bank POS terminals (card machines) registered by a manager.
 * Cashiers pick one on every bank_pos payment so card money can be
 * reconciled per terminal at the end of the day.
 */
export const bankPosTerminals = mysqlTable("bank_pos_terminals", {
  id: serial("id").primaryKey(),
  /** Staff-facing name, e.g. "Counter 1 — Moniepoint". */
  name: varchar("name", { length: 64 }).notNull(),
  /** Bank / fintech provider (GTB, Moniepoint, OPay, …), informational. */
  provider: varchar("provider", { length: 64 }),
  /** The bank's own terminal ID (TID), informational. */
  terminalCode: varchar("terminal_code", { length: 64 }),
  active: boolean("active").notNull().default(true),
  notes: varchar("notes", { length: 255 }),
  createdById: bigint("created_by_id", { mode: "number", unsigned: true }).references(
    () => users.id,
  ),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type BankPosTerminal = typeof bankPosTerminals.$inferSelect;

export const salePayments = mysqlTable("sale_payments", {
  id: serial("id").primaryKey(),
  saleId: bigint("sale_id", { mode: "number", unsigned: true })
    .notNull()
    .references(() => sales.id),
  method: mysqlEnum("method", ["cash", "bank_pos", "transfer"]).notNull(),
  amountKobo: int("amount_kobo").notNull(),
  reference: varchar("reference", { length: 120 }),
  /** Which physical terminal took a bank_pos payment (optional). */
  terminalId: bigint("terminal_id", { mode: "number", unsigned: true }).references(
    () => bankPosTerminals.id,
  ),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const salesRelations = relations(sales, ({ one, many }) => ({
  staff: one(users, { fields: [sales.staffId], references: [users.id] }),
  customer: one(customers, {
    fields: [sales.customerId],
    references: [customers.id],
  }),
  items: many(saleItems),
  payments: many(salePayments),
}));

export const customersRelations = relations(customers, ({ many }) => ({
  payments: many(customerPayments),
  sales: many(sales),
}));

export const customerPaymentsRelations = relations(customerPayments, ({ one }) => ({
  customer: one(customers, {
    fields: [customerPayments.customerId],
    references: [customers.id],
  }),
  receivedBy: one(users, {
    fields: [customerPayments.receivedById],
    references: [users.id],
  }),
}));

export const stockItemsRelations = relations(stockItems, ({ many }) => ({
  movements: many(stockMovements),
}));

export const stockMovementsRelations = relations(stockMovements, ({ one }) => ({
  item: one(stockItems, {
    fields: [stockMovements.itemId],
    references: [stockItems.id],
  }),
  staff: one(users, {
    fields: [stockMovements.staffId],
    references: [users.id],
  }),
}));

export const saleItemsRelations = relations(saleItems, ({ one }) => ({
  sale: one(sales, { fields: [saleItems.saleId], references: [sales.id] }),
  item: one(menuItems, {
    fields: [saleItems.itemId],
    references: [menuItems.id],
  }),
}));

export const salePaymentsRelations = relations(salePayments, ({ one }) => ({
  sale: one(sales, { fields: [salePayments.saleId], references: [sales.id] }),
  terminal: one(bankPosTerminals, {
    fields: [salePayments.terminalId],
    references: [bankPosTerminals.id],
  }),
}));

export type Sale = typeof sales.$inferSelect;
export type SaleItem = typeof saleItems.$inferSelect;
export type SalePayment = typeof salePayments.$inferSelect;

/**
 * Delivery-partner webhook connections (Glovo / Chowdeck). Each connection
 * owns a secret token the partner sends as x-rbk-webhook-token; the token is
 * generated on create/rotate and shown to staff exactly once. Manager+ only.
 */
export const partnerConnections = mysqlTable("partner_connections", {
  id: serial("id").primaryKey(),
  provider: mysqlEnum("provider", ["glovo", "chowdeck"]).notNull(),
  /** Staff-facing name, e.g. "Glovo — Lekki store". */
  name: varchar("name", { length: 64 }).notNull(),
  /** Bearer-style secret compared on every webhook call. */
  token: varchar("token", { length: 80 }).notNull().unique(),
  /** Partner-side store/branch reference (optional, informational). */
  storeRef: varchar("store_ref", { length: 64 }),
  /**
   * Commission the partner deducts before settling us, in BASIS POINTS
   * (2000 = 20.00%). Settlement invoices snapshot it at creation time.
   */
  commissionBps: int("commission_bps").notNull().default(0),
  active: boolean("active").notNull().default(true),
  createdById: bigint("created_by_id", { mode: "number", unsigned: true }).references(
    () => users.id,
  ),
  lastOrderAt: timestamp("last_order_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type PartnerConnection = typeof partnerConnections.$inferSelect;

// ---------------------------------------------------------------------------
// Delivery-partner settlements
//
// Partner orders (Glovo / Chowdeck) are RECEIVABLES: the partner collects the
// customer's money and pays us in batches, minus commission. A settlement
// invoice accumulates completed partner orders; marking the invoice paid
// posts each order as a dated sale (transfer method, reference = invoice no),
// books the commission as an expense, and marks every order settled.
// ---------------------------------------------------------------------------

export const settlementInvoices = mysqlTable("settlement_invoices", {
  id: serial("id").primaryKey(),
  invoiceNo: varchar("invoice_no", { length: 20 }).notNull().unique(),
  partnerConnectionId: bigint("partner_connection_id", {
    mode: "number",
    unsigned: true,
  })
    .notNull()
    .references(() => partnerConnections.id),
  /** Snapshots — the printed invoice stays true even if the connection is
   *  renamed or its commission rate changes later. */
  partnerName: varchar("partner_name", { length: 64 }).notNull(),
  provider: mysqlEnum("provider", ["glovo", "chowdeck"]).notNull(),
  status: mysqlEnum("status", ["open", "paid", "cancelled"])
    .notNull()
    .default("open"),
  orderCount: int("order_count").notNull(),
  grossKobo: int("gross_kobo").notNull(),
  /** Commission rate applied, basis points (2000 = 20.00%). */
  commissionBps: int("commission_bps").notNull().default(0),
  commissionKobo: int("commission_kobo").notNull().default(0),
  /** What the partner actually owes us: gross − commission. */
  netKobo: int("net_kobo").notNull(),
  /** Oldest / newest order covered by the invoice. */
  periodFrom: timestamp("period_from").notNull(),
  periodTo: timestamp("period_to").notNull(),
  note: varchar("note", { length: 255 }),
  createdById: bigint("created_by_id", { mode: "number", unsigned: true }).references(
    () => users.id,
  ),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  // ------------------------------------------------------ payment metadata
  paidAt: timestamp("paid_at"),
  paidById: bigint("paid_by_id", { mode: "number", unsigned: true }).references(
    () => users.id,
  ),
  paymentMethod: mysqlEnum("payment_method", ["cash", "bank_pos", "transfer"]),
  paymentReference: varchar("payment_reference", { length: 120 }),
  /** Sale id of the commission expense booked on payment (traceability). */
  commissionExpenseId: bigint("commission_expense_id", {
    mode: "number",
    unsigned: true,
  }),
  // ------------------------------------------------------ cancel metadata
  cancelledAt: timestamp("cancelled_at"),
  cancelledById: bigint("cancelled_by_id", {
    mode: "number",
    unsigned: true,
  }).references(() => users.id),
  cancelReason: varchar("cancel_reason", { length: 255 }),
});

/**
 * Invoice ↔ order join. An order may sit on at most one OPEN or PAID invoice
 * (enforced inside the creation transaction); cancelled invoices keep their
 * rows for history but release the orders for re-invoicing.
 */
export const settlementInvoiceOrders = mysqlTable(
  "settlement_invoice_orders",
  {
    id: serial("id").primaryKey(),
    invoiceId: bigint("invoice_id", { mode: "number", unsigned: true })
      .notNull()
      .references(() => settlementInvoices.id),
    orderId: bigint("order_id", { mode: "number", unsigned: true })
      .notNull()
      .references(() => orders.id),
  },
  (table) => [
    uniqueIndex("sio_invoice_order_unique").on(table.invoiceId, table.orderId),
    // The settlement register probes "is this order on a live invoice?" by
    // order id — the unique index above leads with invoice_id and can't help.
    index("sio_order_idx").on(table.orderId),
  ],
);

export const settlementInvoicesRelations = relations(
  settlementInvoices,
  ({ one, many }) => ({
    partnerConnection: one(partnerConnections, {
      fields: [settlementInvoices.partnerConnectionId],
      references: [partnerConnections.id],
    }),
    createdBy: one(users, {
      fields: [settlementInvoices.createdById],
      references: [users.id],
    }),
    orders: many(settlementInvoiceOrders),
  }),
);

export const settlementInvoiceOrdersRelations = relations(
  settlementInvoiceOrders,
  ({ one }) => ({
    invoice: one(settlementInvoices, {
      fields: [settlementInvoiceOrders.invoiceId],
      references: [settlementInvoices.id],
    }),
    order: one(orders, {
      fields: [settlementInvoiceOrders.orderId],
      references: [orders.id],
    }),
  }),
);

export type SettlementInvoice = typeof settlementInvoices.$inferSelect;

/**
 * Kitchen orders — taken by waiters/cashiers before payment, or ingested from
 * a delivery partner (Glovo / Chowdeck webhook). The kitchen works the ticket
 * (placed → preparing → ready → served); paying links the order to a sale
 * (status completed). Paying an order always charges the STORED order lines —
 * the board total and the receipt total can never diverge, and partner prices
 * (what the customer already paid) are preserved exactly.
 */
export const orders = mysqlTable(
  "orders",
  {
    id: serial("id").primaryKey(),
    orderNo: varchar("order_no", { length: 20 }).notNull().unique(),
    status: mysqlEnum("status", [
      "placed",
      "preparing",
      "ready",
      "served",
      "completed",
      "cancelled",
    ])
      .notNull()
      .default("placed"),
    /** Table number, customer name or pickup tag — kitchen needs to know. */
    label: varchar("label", { length: 64 }).notNull(),
    notes: varchar("notes", { length: 500 }),
    /** Null for partner-ingested orders (no staff member took them). */
    staffId: bigint("staff_id", { mode: "number", unsigned: true }).references(
      () => users.id,
    ),
    /** Set when the order is paid — one order, at most one sale. */
    saleId: bigint("sale_id", { mode: "number", unsigned: true }).references(
      () => sales.id,
    ),
    totalKobo: int("total_kobo").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    /** Cancel metadata — set together (manager+ only). */
    cancelledAt: timestamp("cancelled_at"),
    cancelledById: bigint("cancelled_by_id", {
      mode: "number",
      unsigned: true,
    }).references(() => users.id),
    cancelReason: varchar("cancel_reason", { length: 255 }),
    // --------------------------------------------------- delivery partner
    /** Where this order came from. "pos" = taken on a till. */
    source: mysqlEnum("source", ["pos", "glovo", "chowdeck"])
      .notNull()
      .default("pos"),
    /** Partner's own order id — unique per source, makes webhooks idempotent. */
    externalId: varchar("external_id", { length: 64 }),
    partnerConnectionId: bigint("partner_connection_id", {
      mode: "number",
      unsigned: true,
    }).references(() => partnerConnections.id),
    customerName: varchar("customer_name", { length: 120 }),
    customerPhone: varchar("customer_phone", { length: 40 }),
    deliveryAddress: varchar("delivery_address", { length: 255 }),
    /** Claimed by the first board screen that printed the kitchen ticket. */
    kitchenPrintedAt: timestamp("kitchen_printed_at"),
  },
  (table) => [
    // NULL external_id rows (counter orders) never collide in MySQL uniques.
    uniqueIndex("orders_source_external_unique").on(table.source, table.externalId),
  ],
);

export const orderItems = mysqlTable("order_items", {
  id: serial("id").primaryKey(),
  orderId: bigint("order_id", { mode: "number", unsigned: true })
    .notNull()
    .references(() => orders.id),
  /** Kept for analytics; nullable so deleting a menu item keeps history. */
  itemId: bigint("item_id", { mode: "number", unsigned: true }).references(
    () => menuItems.id,
  ),
  itemName: varchar("item_name", { length: 120 }).notNull(),
  unitPriceKobo: int("unit_price_kobo").notNull(),
  /** JSON snapshot: [{group, option, priceDeltaKobo}] */
  modifiersJson: varchar("modifiers_json", { length: 2000 }),
  quantity: int("quantity").notNull(),
  lineTotalKobo: int("line_total_kobo").notNull(),
});

export const ordersRelations = relations(orders, ({ one, many }) => ({
  staff: one(users, { fields: [orders.staffId], references: [users.id] }),
  sale: one(sales, { fields: [orders.saleId], references: [sales.id] }),
  partnerConnection: one(partnerConnections, {
    fields: [orders.partnerConnectionId],
    references: [partnerConnections.id],
  }),
  items: many(orderItems),
}));

export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, { fields: [orderItems.orderId], references: [orders.id] }),
  item: one(menuItems, {
    fields: [orderItems.itemId],
    references: [menuItems.id],
  }),
}));

export type Order = typeof orders.$inferSelect;
export type OrderItem = typeof orderItems.$inferSelect;

// ---------------------------------------------------------------------------
// Attendance — one open shift per staff member (enforced in a transaction
// that locks the user row; MySQL has no partial unique indexes).
// ---------------------------------------------------------------------------

export const attendanceRecords = mysqlTable("attendance_records", {
  id: serial("id").primaryKey(),
  userId: bigint("user_id", { mode: "number", unsigned: true })
    .notNull()
    .references(() => users.id),
  clockInAt: timestamp("clock_in_at").notNull(),
  clockOutAt: timestamp("clock_out_at"),
  clockInNote: varchar("clock_in_note", { length: 255 }),
  clockOutNote: varchar("clock_out_note", { length: 255 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const attendanceRecordsRelations = relations(attendanceRecords, ({ one }) => ({
  user: one(users, { fields: [attendanceRecords.userId], references: [users.id] }),
}));

export type AttendanceRecord = typeof attendanceRecords.$inferSelect;

// ---- Step 17: expenses & cash drawer ----
export const expenses = mysqlTable("expenses", {
  id: serial("id").primaryKey(),
  category: mysqlEnum("category", ["supplies", "utilities", "wages", "rent", "transport", "equipment", "other"]).notNull(),
  amountKobo: int("amount_kobo").notNull(),
  note: varchar("note", { length: 500 }).notNull(),
  method: mysqlEnum("method", ["cash", "bank_pos", "transfer"]).notNull(),
  staffId: bigint("staff_id", { mode: "number", unsigned: true }).notNull().references(() => users.id),
  expenseAt: timestamp("expense_at").notNull().defaultNow(),
  voidedAt: timestamp("voided_at"),
  voidedById: bigint("voided_by_id", { mode: "number", unsigned: true }).references(() => users.id),
  voidReason: varchar("void_reason", { length: 255 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const drawerCounts = mysqlTable("drawer_counts", {
  id: serial("id").primaryKey(),
  countedKobo: int("counted_kobo").notNull(),
  expectedKobo: int("expected_kobo").notNull(),
  note: varchar("note", { length: 255 }),
  countedById: bigint("counted_by_id", { mode: "number", unsigned: true }).notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const expensesRelations = relations(expenses, ({ one }) => ({
  staff: one(users, { fields: [expenses.staffId], references: [users.id] }),
}));
export const drawerCountsRelations = relations(drawerCounts, ({ one }) => ({
  countedBy: one(users, { fields: [drawerCounts.countedById], references: [users.id] }),
}));

// ---- Step 20: audit log ----
export const auditEvents = mysqlTable("audit_events", {
  id: serial("id").primaryKey(),
  /** Null for system actors (e.g. partner webhooks). */
  actorId: bigint("actor_id", { mode: "number", unsigned: true }).references(() => users.id),
  /** Denormalized snapshot so the feed reads without a join. */
  actorName: varchar("actor_name", { length: 120 }),
  /** Dot-namespaced action, e.g. "sale.complete", "expense.void". */
  action: varchar("action", { length: 64 }).notNull(),
  entityType: varchar("entity_type", { length: 40 }).notNull(),
  entityId: bigint("entity_id", { mode: "number", unsigned: true }),
  /** Human-readable summary, e.g. "Receipt RB-000123 · ₦4,000 · cash". */
  detail: varchar("detail", { length: 500 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const auditEventsRelations = relations(auditEvents, ({ one }) => ({
  actor: one(users, { fields: [auditEvents.actorId], references: [users.id] }),
}));

/** Key-value store for restaurant-wide configuration (profile, receipt layout). */
export const settings = mysqlTable("settings", {
  key: varchar("key", { length: 64 }).primaryKey(),
  value: varchar("value", { length: 500 }).notNull(),
  updatedById: bigint("updated_by_id", { mode: "number", unsigned: true }).references(() => users.id),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
});

export const settingsRelations = relations(settings, ({ one }) => ({
  updatedBy: one(users, { fields: [settings.updatedById], references: [users.id] }),
}));
