/** Stock quantities are stored as integer milli-units (1 unit = 1000) so
 *  fractional amounts like 2.5 kg stay exact. These helpers are the ONLY
 *  conversion points. */

export const STOCK_MOVEMENT_TYPES = ["restock", "usage", "waste", "adjustment"] as const;
export type StockMovementType = (typeof STOCK_MOVEMENT_TYPES)[number];

export const STOCK_MOVEMENT_LABEL: Record<string, string> = {
  restock: "Restock",
  usage: "Usage",
  waste: "Waste",
  adjustment: "Adjustment",
};

export function toMilli(units: number): number {
  return Math.round(units * 1000);
}

export function unitsOf(milli: number): number {
  return milli / 1000;
}

/** 2500 → "2.5" · 10000 → "10" — trailing zeros trimmed. */
export function formatQty(milli: number): string {
  const units = milli / 1000;
  return Number.isInteger(units)
    ? units.toString()
    : units.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}
