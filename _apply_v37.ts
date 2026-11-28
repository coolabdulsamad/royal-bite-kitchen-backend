// THROWAWAY (v37): apply migration 0019 — users.salary_kobo/salary_note,
// account_transactions.kind + 'payroll', payroll_runs + payroll_items.
// Run once: npx tsx db/_apply_v37.ts
import { readFileSync } from "node:fs";
import mysql from "mysql2/promise";
import "dotenv/config";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL missing");

const sql = readFileSync("db/migrations/0019_rapid_payroll.sql", "utf8")
  .split("--> statement-breakpoint")
  .map((s) => s.trim())
  .filter(Boolean);

const conn = await mysql.createConnection({ uri: url, multipleStatements: false });

for (const stmt of sql) {
  try {
    await conn.query(stmt);
    console.log("OK:", stmt.slice(0, 70).replace(/\n/g, " "));
  } catch (e: any) {
    if (String(e.message).includes("already exists") || String(e.message).includes("Duplicate column"))
      console.log("SKIP (exists):", stmt.slice(0, 50));
    else throw e;
  }
}

const [cols] = await conn.query("SHOW COLUMNS FROM users LIKE 'salary_kobo'");
console.log("users.salary_kobo:", (cols as any[]).length ? "present" : "MISSING");
const [runs] = await conn.query("SHOW TABLES LIKE 'payroll_runs'");
const [items] = await conn.query("SHOW TABLES LIKE 'payroll_items'");
console.log("payroll_runs:", (runs as any[]).length ? "present" : "MISSING");
console.log("payroll_items:", (items as any[]).length ? "present" : "MISSING");
const [kindCol] = await conn.query("SHOW COLUMNS FROM account_transactions LIKE 'kind'");
console.log("kind enum:", (kindCol as any[])[0]?.Type);

await conn.end();
console.log("DONE v37 migration");
