// Central money ledger (v36) — EVERY movement of money in the business
// writes rows here, inside the same DB transaction as the business write,
// so the books can never disagree with sales/expenses/transfers.
//
// Accounts (cash on hand / bank / POS settlements) hold no stored balance:
// balance = SUM(in) − SUM(out) over this immutable ledger.

import { eq } from "drizzle-orm";
import { accounts, accountTransactions } from "@db/schema";
import type { getDb } from "./queries/connection";

type Db = ReturnType<typeof getDb>;
/** drizzle transaction handles are query-compatible with the db instance. */
type TxLike = Pick<Db, "select" | "insert">;

export type PaymentMethod = "cash" | "bank_pos" | "transfer";

/** Which account each payment/expense method physically lands in. */
export const METHOD_ACCOUNT_CODE: Record<PaymentMethod, string> = {
  cash: "CASH",
  bank_pos: "POS",
  transfer: "BANK",
};

export interface LedgerRow {
  /** Resolve the account from a payment method (preferred)… */
  method?: PaymentMethod;
  /** …or target an account directly (money in/out, transfers). */
  accountId?: number;
  direction: "in" | "out";
  amountKobo: number;
  kind:
    | "sale_payment"
    | "expense"
    | "transfer"
    | "money_in"
    | "money_out"
    | "adjustment"
    | "credit_repayment"
    | "payroll";
  refType?: string;
  refId?: string;
  note?: string;
  staffId?: number;
  transferGroup?: string;
  counterAccountId?: number;
}

/** code → account row, one small lookup per call (3 rows). */
async function accountMap(tx: TxLike) {
  const rows = await tx
    .select({ id: accounts.id, code: accounts.code })
    .from(accounts)
    .where(eq(accounts.active, true));
  return new Map(rows.map((r) => [r.code, r.id]));
}

/**
 * Append ledger rows. Resolves `method` → account automatically.
 * Silent no-op for zero amounts; throws if an account code is missing
 * (means the accounts seed didn't run — loud failure beats silent drift).
 */
export async function postToLedger(tx: TxLike, entries: LedgerRow[]): Promise<void> {
  const rows = entries.filter((e) => e.amountKobo > 0);
  if (rows.length === 0) return;
  const map = await accountMap(tx);
  await tx.insert(accountTransactions).values(
    rows.map((e) => {
      const accountId =
        e.accountId ?? (e.method ? map.get(METHOD_ACCOUNT_CODE[e.method]) : undefined);
      if (accountId === undefined) {
        throw new Error(
          `Ledger: no active account for ${e.method ?? `account ${e.accountId}`} — run the accounts migration/seed`,
        );
      }
      return {
        accountId,
        direction: e.direction,
        amountKobo: e.amountKobo,
        kind: e.kind,
        refType: e.refType ?? null,
        refId: e.refId ?? null,
        note: e.note ?? null,
        staffId: e.staffId ?? null,
        transferGroup: e.transferGroup ?? null,
        counterAccountId: e.counterAccountId ?? null,
      };
    }),
  );
}

/** Current balance (kobo) of one account, derived from the ledger. */
export async function ledgerBalance(tx: TxLike, accountId: number): Promise<number> {
  const { sql } = await import("drizzle-orm");
  const [row] = await tx
    .select({
      bal: sql<number>`coalesce(sum(case when ${accountTransactions.direction} = 'in' then ${accountTransactions.amountKobo} else -${accountTransactions.amountKobo} end), 0)`.as("bal"),
    })
    .from(accountTransactions)
    .where(eq(accountTransactions.accountId, accountId));
  return Number(row?.bal ?? 0);
}
