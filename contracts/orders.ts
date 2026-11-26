/**
 * Kitchen-order status model — shared by the server router, the orders board
 * and the kitchen ticket printer so every surface agrees on the workflow.
 */
export const ORDER_STATUSES = [
  "placed",
  "preparing",
  "ready",
  "served",
  "completed",
  "cancelled",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  placed: "Placed",
  preparing: "Preparing",
  ready: "Ready",
  served: "Served",
  completed: "Paid",
  cancelled: "Cancelled",
};

/** Orders the kitchen is still working on. */
export const ACTIVE_ORDER_STATUSES: readonly OrderStatus[] = [
  "placed",
  "preparing",
  "ready",
  "served",
];

/** Forward-only workflow — the button label for the next step. */
export const NEXT_ORDER_STATUS: Partial<
  Record<OrderStatus, { to: "preparing" | "ready" | "served"; action: string }>
> = {
  placed: { to: "preparing", action: "Start preparing" },
  preparing: { to: "ready", action: "Mark ready" },
  ready: { to: "served", action: "Mark served" },
};

/** Elapsed-time colour thresholds (minutes) on the orders board. */
export const ORDER_ELAPSED_WARN_MIN = 10;
export const ORDER_ELAPSED_LATE_MIN = 20;
