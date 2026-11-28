import type { StaffRole } from "./roles";

export const PAYMENT_METHODS = ["cash", "bank_pos", "transfer"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: "Cash",
  bank_pos: "Bank POS",
  transfer: "Transfer",
};

/**
 * Maximum discount (as % of subtotal) each role may grant on a sale.
 * Fixed-amount discounts are checked against the same limit by converting
 * them to their percentage equivalent. Enforced SERVER-SIDE in sales router.
 */
export const DISCOUNT_LIMIT_PERCENT: Record<StaffRole, number> = {
  sales: 5,
  "ordering-sales": 5,
  accountant: 0, // money roles never sell, so they never discount
  auditor: 0,
  manager: 20,
  admin: 100,
  superadmin: 100,
};
