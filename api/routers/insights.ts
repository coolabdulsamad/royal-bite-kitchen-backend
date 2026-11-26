import { z } from "zod";
import { and, eq, gt, sql } from "drizzle-orm";
import { createRouter } from "../middleware";
import { permProcedure } from "../auth/guards";
import { getDb } from "../queries/connection";
import {
  customers,
  drawerCounts,
  menuItems,
  saleItems,
  salePayments,
  sales,
  stockItems,
} from "@db/schema";
import { rangeBounds, salesInRange } from "./reports";
import { formatNaira } from "@contracts/money";

export type InsightTone = "good" | "warn" | "bad" | "info";
export type Insight = {
  id: string;
  tone: InsightTone;
  title: string;
  body: string;
};

const TONE_RANK: Record<InsightTone, number> = { bad: 0, warn: 1, good: 2, info: 3 };

function pct(change: number): string {
  const sign = change > 0 ? "+" : "";
  return `${sign}${change.toFixed(0)}%`;
}

/**
 * Rule-based insight engine: compares the selected period against the
 * previous equal-length period plus live operational signals (stock, credit,
 * drawer counts) and turns them into plain-language cards. Deterministic —
 * every insight is computed from real numbers, never invented.
 */
export const insightsRouter = createRouter({
  generate: permProcedure("reports", "view")
    .input(z.object({ from: z.coerce.date(), to: z.coerce.date() }))
    .query(async ({ input }) => {
      const db = getDb();
      const { fromStart, toEnd } = rangeBounds(input);
      const periodDays = Math.max(
        1,
        Math.round((toEnd.getTime() - fromStart.getTime()) / 86_400_000),
      );
      const prevEnd = new Date(fromStart);
      const prevStart = new Date(fromStart);
      prevStart.setDate(prevStart.getDate() - periodDays);

      // ---- period overviews (current vs previous) ----
      async function overview(a: Date, b: Date) {
        const [s] = await db
          .select({
            revenueKobo: sql<number>`coalesce(sum(${sales.totalKobo}), 0)`,
            salesCount: sql<number>`count(*)`,
            discountKobo: sql<number>`coalesce(sum(${sales.discountKobo}), 0)`,
          })
          .from(sales)
          .where(salesInRange(a, b));
        const [e] = await db
          .select({ expensesKobo: sql<number>`coalesce(sum(${sql`amount_kobo`}), 0)` })
          .from(sql`expenses`)
          .where(
            and(
              sql`voided_at is null`,
              sql`expense_at >= ${a}`,
              sql`expense_at < ${b}`,
            ),
          );
        const [r] = await db
          .select({ n: sql<number>`count(*)` })
          .from(sales)
          .where(
            and(
              sql`${sales.returnedAt} is not null`,
              sql`sold_at >= ${a}`,
              sql`sold_at < ${b}`,
            ),
          );
        return {
          revenueKobo: Number(s?.revenueKobo ?? 0),
          salesCount: Number(s?.salesCount ?? 0),
          discountKobo: Number(s?.discountKobo ?? 0),
          expensesKobo: Number(e?.expensesKobo ?? 0),
          returnsCount: Number(r?.n ?? 0),
        };
      }

      const [cur, prev] = await Promise.all([
        overview(fromStart, toEnd),
        overview(prevStart, prevEnd),
      ]);

      // ---- top items, both periods ----
      async function topItem(a: Date, b: Date) {
        const rows = await db
          .select({
            itemName: saleItems.itemName,
            revenueKobo: sql<number>`coalesce(sum(${saleItems.lineTotalKobo}), 0)`,
            quantity: sql<number>`coalesce(sum(${saleItems.quantity}), 0)`,
          })
          .from(saleItems)
          .innerJoin(sales, eq(sales.id, saleItems.saleId))
          .where(salesInRange(a, b))
          .groupBy(saleItems.itemName)
          .orderBy(sql`sum(${saleItems.lineTotalKobo}) desc`)
          .limit(1);
        return rows[0]
          ? { itemName: rows[0].itemName, revenueKobo: Number(rows[0].revenueKobo), quantity: Number(rows[0].quantity) }
          : null;
      }
      const [curTop, prevTop] = await Promise.all([
        topItem(fromStart, toEnd),
        topItem(prevStart, prevEnd),
      ]);

      // ---- payment mix, both periods ----
      async function cardShare(a: Date, b: Date) {
        const rows = await db
          .select({
            method: salePayments.method,
            totalKobo: sql<number>`coalesce(sum(${salePayments.amountKobo}), 0)`,
          })
          .from(salePayments)
          .innerJoin(sales, eq(sales.id, salePayments.saleId))
          .where(salesInRange(a, b))
          .groupBy(salePayments.method);
        const total = rows.reduce((s2, r2) => s2 + Number(r2.totalKobo), 0);
        const card = rows
          .filter((r2) => r2.method !== "cash")
          .reduce((s2, r2) => s2 + Number(r2.totalKobo), 0);
        return total > 0 ? (card / total) * 100 : null;
      }
      const [curCard, prevCard] = await Promise.all([
        cardShare(fromStart, toEnd),
        cardShare(prevStart, prevEnd),
      ]);

      // ---- peak hour this period ----
      const hourRows = await db
        .select({
          hour: sql<number>`hour(${sales.soldAt})`.as("hour"),
          n: sql<number>`count(*)`,
        })
        .from(sales)
        .where(salesInRange(fromStart, toEnd))
        .groupBy(sql`hour`)
        .orderBy(sql`count(*) desc`)
        .limit(1);
      const peakHour = hourRows[0] ? Number(hourRows[0].hour) : null;

      // ---- low stock ----
      const lowStock = await db
        .select({ name: stockItems.name, unit: stockItems.unit, qty: stockItems.quantityMilli })
        .from(stockItems)
        .where(
          and(
            eq(stockItems.active, true),
            sql`${stockItems.lowStockAtMilli} is not null`,
            sql`${stockItems.quantityMilli} <= ${stockItems.lowStockAtMilli}`,
          ),
        )
        .limit(5);

      // ---- outstanding customer credit ----
      const [credit] = await db
        .select({
          totalKobo: sql<number>`coalesce(sum(${customers.creditBalanceKobo}), 0)`,
          n: sql<number>`count(*)`,
        })
        .from(customers)
        .where(and(eq(customers.active, true), gt(customers.creditBalanceKobo, 0)));

      // ---- drawer mismatches in range ----
      const [drawer] = await db
        .select({
          n: sql<number>`count(*)`,
          netKobo: sql<number>`coalesce(sum(${drawerCounts.countedKobo} - ${drawerCounts.expectedKobo}), 0)`,
        })
        .from(drawerCounts)
        .where(
          and(
            sql`${drawerCounts.countedKobo} <> ${drawerCounts.expectedKobo}`,
            sql`${drawerCounts.createdAt} >= ${fromStart}`,
            sql`${drawerCounts.createdAt} < ${toEnd}`,
          ),
        );

      // ---- menu items with zero sales in the last 30 days ----
      const deadSince = new Date();
      deadSince.setDate(deadSince.getDate() - 30);
      const deadItems = await db
        .select({ name: menuItems.name })
        .from(menuItems)
        .where(
          and(
            eq(menuItems.available, true),
            sql`${menuItems.id} not in (
              select si.item_id from sale_items si
              inner join sales s2 on s2.id = si.sale_id
              where si.item_id is not null and s2.status = 'completed'
                and s2.returned_at is null and s2.sold_at >= ${deadSince}
            )`,
          ),
        )
        .limit(5);

      // ================= rules =================
      const insights: Insight[] = [];

      // 1. revenue trend vs previous period
      if (prev.revenueKobo > 0) {
        const change = ((cur.revenueKobo - prev.revenueKobo) / prev.revenueKobo) * 100;
        const word = periodDays === 1 ? "yesterday" : `the previous ${periodDays} days`;
        if (change >= 5) {
          insights.push({
            id: "revenue-trend",
            tone: "good",
            title: `Revenue is up ${pct(change)}`,
            body: `${formatNaira(cur.revenueKobo)} this period vs ${formatNaira(prev.revenueKobo)} in ${word}. Whatever you changed — keep doing it.`,
          });
        } else if (change <= -10) {
          insights.push({
            id: "revenue-trend",
            tone: "bad",
            title: `Revenue is down ${pct(change)}`,
            body: `${formatNaira(cur.revenueKobo)} this period vs ${formatNaira(prev.revenueKobo)} in ${word}. Check the daily chart for when the drop started.`,
          });
        } else {
          insights.push({
            id: "revenue-trend",
            tone: "info",
            title: "Revenue is holding steady",
            body: `${formatNaira(cur.revenueKobo)} this period, ${pct(change)} vs ${word}.`,
          });
        }
      } else if (cur.revenueKobo > 0) {
        insights.push({
          id: "revenue-trend",
          tone: "info",
          title: "First revenue on record for this comparison",
          body: `${formatNaira(cur.revenueKobo)} this period — no sales in the previous ${periodDays} day${periodDays === 1 ? "" : "s"} to compare against.`,
        });
      }

      // 2. top item
      if (curTop) {
        const share = cur.revenueKobo > 0 ? (curTop.revenueKobo / cur.revenueKobo) * 100 : 0;
        const changed = prevTop && prevTop.itemName !== curTop.itemName;
        insights.push({
          id: "top-item",
          tone: "info",
          title: changed ? `New best seller: ${curTop.itemName}` : `${curTop.itemName} leads the menu`,
          body: `${curTop.quantity} sold for ${formatNaira(curTop.revenueKobo)} — ${share.toFixed(0)}% of the period's revenue.${changed ? ` It took the top spot from ${prevTop!.itemName}.` : ""}`,
        });
      }

      // 3. payment mix shift
      if (curCard !== null && prevCard !== null && Math.abs(curCard - prevCard) >= 5) {
        const up = curCard > prevCard;
        insights.push({
          id: "payment-mix",
          tone: "info",
          title: `Card & transfer payments ${up ? "rising" : "falling"}`,
          body: `${curCard.toFixed(0)}% of takings were cashless this period vs ${prevCard.toFixed(0)}% before.${up ? " Make sure the POS terminals stay charged and online." : " Watch the cash drawer more closely."}`,
        });
      }

      // 4. expense pressure
      if (cur.expensesKobo > 0 && prev.expensesKobo > 0 && cur.expensesKobo > prev.expensesKobo * 1.5) {
        insights.push({
          id: "expense-spike",
          tone: "warn",
          title: "Expenses jumped",
          body: `${formatNaira(cur.expensesKobo)} this period vs ${formatNaira(prev.expensesKobo)} before. Review the expense list for anything unusual.`,
        });
      }
      if (cur.revenueKobo > 0 && cur.expensesKobo / cur.revenueKobo > 0.3) {
        insights.push({
          id: "margin-squeeze",
          tone: "warn",
          title: "Expenses are eating the margin",
          body: `Expenses took ${((cur.expensesKobo / cur.revenueKobo) * 100).toFixed(0)}% of revenue this period. Healthy kitchens usually keep this under 30%.`,
        });
      }

      // 5. low stock
      if (lowStock.length > 0) {
        insights.push({
          id: "low-stock",
          tone: "warn",
          title: `${lowStock.length} item${lowStock.length === 1 ? "" : "s"} low on stock`,
          body: `${lowStock.map((s) => s.name).join(", ")} ${lowStock.length === 1 ? "is" : "are"} at or below the warning level. Restock before the next rush.`,
        });
      }

      // 6. credit exposure
      const creditKobo = Number(credit?.totalKobo ?? 0);
      if (creditKobo > 0) {
        const heavy = cur.revenueKobo > 0 && creditKobo > cur.revenueKobo * 0.5;
        insights.push({
          id: "credit-exposure",
          tone: heavy ? "warn" : "info",
          title: `${formatNaira(creditKobo)} out on credit`,
          body: `${Number(credit?.n ?? 0)} customer${Number(credit?.n ?? 0) === 1 ? "" : "s"} owe a combined ${formatNaira(creditKobo)}.${heavy ? " That's more than half this period's revenue — time to chase repayments." : " A gentle reminder at pickup usually works."}`,
        });
      }

      // 7. drawer mismatches
      const mismatchN = Number(drawer?.n ?? 0);
      if (mismatchN > 0) {
        const net = Number(drawer?.netKobo ?? 0);
        insights.push({
          id: "drawer-mismatch",
          tone: net < 0 ? "bad" : "warn",
          title: `${mismatchN} drawer count${mismatchN === 1 ? "" : "s"} didn't balance`,
          body: `Net ${net < 0 ? "shortage" : "surplus"} of ${formatNaira(Math.abs(net))} in this period's counts.${net < 0 ? " Recount with a manager present and check the expense list." : " Overages usually mean change wasn't recorded."}`,
        });
      }

      // 8. peak hour
      if (peakHour !== null) {
        insights.push({
          id: "peak-hour",
          tone: "info",
          title: `Busiest around ${String(peakHour).padStart(2, "0")}:00`,
          body: `That hour had the most sales this period. Have your fastest cashier and full stock ready before ${String(peakHour).padStart(2, "0")}:00.`,
        });
      }

      // 9. discount watch
      const grossKobo = cur.revenueKobo + cur.discountKobo;
      if (grossKobo > 0 && (cur.discountKobo / grossKobo) * 100 > 5) {
        insights.push({
          id: "discount-watch",
          tone: "warn",
          title: "Discounts are running high",
          body: `${formatNaira(cur.discountKobo)} given in discounts — ${((cur.discountKobo / grossKobo) * 100).toFixed(1)}% of gross sales. Check they're all justified.`,
        });
      }

      // 10. returns watch
      if (cur.salesCount > 0 && cur.returnsCount / cur.salesCount > 0.03) {
        insights.push({
          id: "returns-watch",
          tone: "warn",
          title: "Returns are above normal",
          body: `${cur.returnsCount} of ${cur.salesCount} sales were returned this period. Look at the return reasons in Sales History.`,
        });
      }

      // 11. dead menu items
      if (deadItems.length > 0) {
        insights.push({
          id: "dead-items",
          tone: "info",
          title: `${deadItems.length} menu item${deadItems.length === 1 ? "" : "s"} with no sales in 30 days`,
          body: `${deadItems.map((d) => d.name).join(", ")}. Consider a promo, a better spot on the menu, or retiring ${deadItems.length === 1 ? "it" : "them"}.`,
        });
      }

      // 12. all-clear fallback
      if (insights.length === 0) {
        insights.push({
          id: "all-clear",
          tone: "good",
          title: "Nothing needs attention",
          body: "Sales, stock, drawer and credit all look normal for this period.",
        });
      }

      insights.sort((a, b) => TONE_RANK[a.tone] - TONE_RANK[b.tone]);
      return { insights, generatedAt: new Date().toISOString() };
    }),
});
