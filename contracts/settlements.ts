/**
 * Delivery-partner settlement contracts — shared by the server router, the
 * settlements page and the invoice printout.
 *
 * Partner orders are receivables: the partner (Glovo / Chowdeck) collects the
 * customer's money and pays us in batches, minus commission. A settlement
 * invoice accumulates completed partner orders; paying it settles every order
 * on it in one go.
 */

export const SETTLEMENT_STATUSES = ["open", "paid", "cancelled"] as const;
export type SettlementStatus = (typeof SETTLEMENT_STATUSES)[number];

export const SETTLEMENT_STATUS_LABEL: Record<SettlementStatus, string> = {
  open: "Awaiting payment",
  paid: "Paid",
  cancelled: "Cancelled",
};

/** Payment state of a single partner order, derived from its invoice. */
export type OrderSettlementState = "unsettled" | "invoiced" | "settled";

export const ORDER_SETTLEMENT_LABEL: Record<OrderSettlementState, string> = {
  unsettled: "Unsettled",
  invoiced: "Invoiced",
  settled: "Settled",
};

/** Commission ceiling — 50% in basis points. No partner takes more than that. */
export const COMMISSION_BPS_MAX = 5000;

/** Basis points → percent number (2000 → 20). */
export function bpsToPercent(bps: number): number {
  return bps / 100;
}

/** Format basis points as a percent string (2000 → "20%", 1550 → "15.5%"). */
export function formatBps(bps: number): string {
  const pct = bps / 100;
  return `${Number.isInteger(pct) ? pct : pct.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}%`;
}

/** Commission owed on a gross amount, rounded to the nearest kobo. */
export function commissionOf(grossKobo: number, bps: number): number {
  return Math.round((grossKobo * bps) / 10_000);
}
