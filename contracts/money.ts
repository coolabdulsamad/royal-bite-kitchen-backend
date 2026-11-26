// Money helpers — all money in the system is stored as integer kobo
// (₦1 = 100 kobo). These helpers are the ONLY conversion points.

/** Naira (decimal) → kobo (integer). */
export function nairaToKobo(naira: number): number {
  return Math.round(naira * 100);
}

/** Kobo → display string, e.g. 250000 → "₦2,500" (no decimals when whole). */
export function formatNaira(kobo: number): string {
  const naira = kobo / 100;
  const whole = Number.isInteger(naira);
  return (
    "₦" +
    naira.toLocaleString("en-NG", {
      minimumFractionDigits: whole ? 0 : 2,
      maximumFractionDigits: 2,
    })
  );
}

// ---- Expense approval workflow (v29) ----

export const EXPENSE_STATUSES = ["pending", "approved", "rejected"] as const;
export type ExpenseStatus = (typeof EXPENSE_STATUSES)[number];

export const EXPENSE_STATUS_LABEL: Record<ExpenseStatus, string> = {
  pending: "Pending approval",
  approved: "Approved",
  rejected: "Rejected",
};

/** How the expense-approval policy is shaped (stored as settings rows). */
export interface ExpenseApprovalPolicy {
  /** When false, every expense is approved immediately at creation. */
  required: boolean;
  /** Expenses BELOW this amount auto-approve even when required (0 = all need approval). */
  thresholdKobo: number;
}

export const DEFAULT_EXPENSE_APPROVAL_POLICY: ExpenseApprovalPolicy = {
  required: true,
  thresholdKobo: 0,
};
