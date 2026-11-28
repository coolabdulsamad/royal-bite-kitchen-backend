// THROWAWAY (v36): apply migration 0018 + seed the three accounts + backfill
// the money ledger from existing payments / expenses / credit repayments.
// Run once: npx tsx db/_apply_v36.ts
import { readFileSync } from "node:fs";
import mysql from "mysql2/promise";
import "dotenv/config";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL missing");

const sql = readFileSync("db/migrations/0018_certain_carnage.sql", "utf8")
  .split("--> statement-breakpoint")
  .map((s) => s.trim())
  .filter(Boolean);

const conn = await mysql.createConnection({ uri: url, multipleStatements: false });

// 1) Tables (idempotent-ish: ignore "already exists")
for (const stmt of sql) {
  try {
    await conn.query(stmt);
    console.log("OK:", stmt.slice(0, 70).replace(/\n/g, " "));
  } catch (e: any) {
    if (String(e.message).includes("already exists")) console.log("SKIP (exists):", stmt.slice(0, 50));
    else throw e;
  }
}

// 2) Seed the three accounts
for (const [code, name, type] of [
  ["CASH", "Cash on hand", "cash"],
  ["BANK", "Bank account", "bank"],
  ["POS", "POS settlements", "pos"],
] as const) {
  await conn.query(
    "INSERT INTO accounts (code, name, type) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE name = VALUES(name)",
    [code, name, code === "CASH" ? "cash" : code === "BANK" ? "bank" : "pos"],
  );
}
const [accts] = await conn.query("SELECT id, code FROM accounts");
const acctId = Object.fromEntries((accts as any[]).map((a) => [a.code, a.id]));
console.log("accounts:", acctId);

// 3) Backfill — only if the ledger is still empty
const [cnt] = await conn.query("SELECT COUNT(*) AS n FROM account_transactions");
if (Number((cnt as any[])[0].n) > 0) {
  console.log("ledger already has rows — skipping backfill");
  process.exit(0);
}

const methodAcct: Record<string, number> = { cash: acctId.CASH, bank_pos: acctId.POS, transfer: acctId.BANK };
const ins = `INSERT INTO account_transactions
  (account_id, direction, amount_kobo, kind, ref_type, ref_id, note, staff_id, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
let n = 0;

// 3a) Sale payments — money in for every payment on a completed/returned sale
const [pays] = await conn.query(`
  SELECT p.method, p.amount_kobo, s.receipt_no, s.staff_id, s.sold_at, s.status
  FROM sale_payments p JOIN sales s ON s.id = p.sale_id
  WHERE s.status IN ('completed','returned')`);
for (const p of pays as any[]) {
  await conn.query(ins, [methodAcct[p.method], "in", p.amount_kobo, "sale_payment", "sale", p.receipt_no, `Receipt ${p.receipt_no}`, p.staff_id, p.sold_at]);
  n++;
  // Returned sales: the money went back out at return time
  if (p.status === "returned") { /* handled below per-sale for the timestamp */ }
}

// 3b) Return reversals — out rows at returned_at
const [rets] = await conn.query(`
  SELECT p.method, p.amount_kobo, s.receipt_no, s.returned_by_id, s.returned_at
  FROM sale_payments p JOIN sales s ON s.id = p.sale_id
  WHERE s.status = 'returned' AND s.returned_at IS NOT NULL`);
for (const p of rets as any[]) {
  await conn.query(ins, [methodAcct[p.method], "out", p.amount_kobo, "sale_payment", "sale_return", p.receipt_no, `Return of receipt ${p.receipt_no}`, p.returned_by_id, p.returned_at]);
  n++;
}

// 3c) Approved expenses — money out; voided ones get a reversal back in
const [exps] = await conn.query(`SELECT id, category, amount_kobo, note, method, staff_id, expense_at, voided_at, voided_by_id FROM expenses WHERE status = 'approved'`);
for (const e of exps as any[]) {
  await conn.query(ins, [methodAcct[e.method], "out", e.amount_kobo, "expense", "expense", String(e.id), `${e.category} — ${String(e.note).slice(0, 100)}`, e.staff_id, e.expense_at]);
  n++;
  if (e.voided_at) {
    await conn.query(ins, [methodAcct[e.method], "in", e.amount_kobo, "expense", "expense_void", String(e.id), `Void reversal — ${String(e.note).slice(0, 90)}`, e.voided_by_id, e.voided_at]);
    n++;
  }
}

// 3d) Customer credit repayments — money in
const [reps] = await conn.query(`
  SELECT cp.amount_kobo, cp.method, cp.received_by_id, cp.created_at, c.name, c.id AS cid
  FROM customer_payments cp JOIN customers c ON c.id = cp.customer_id`);
for (const r of reps as any[]) {
  await conn.query(ins, [methodAcct[r.method], "in", r.amount_kobo, "credit_repayment", "customer", String(r.cid), `Debt repayment — ${r.name}`, r.received_by_id, r.created_at]);
  n++;
}

console.log(`backfill complete: ${n} ledger rows`);
const [bal] = await conn.query(`
  SELECT a.code, COALESCE(SUM(CASE WHEN t.direction='in' THEN t.amount_kobo ELSE -t.amount_kobo END),0)/100 AS bal
  FROM accounts a LEFT JOIN account_transactions t ON t.account_id = a.id GROUP BY a.code`);
console.log("balances (₦):", bal);
await conn.end();
