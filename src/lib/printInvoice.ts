import { formatNaira } from "@contracts/money";
import { SETTLEMENT_STATUS_LABEL, formatBps, type SettlementStatus } from "@contracts/settlements";
import { getCachedBusinessSettings } from "@/lib/businessSettings";

/** Shape accepted from settlements.invoiceDetail. */
export interface PrintableInvoice {
  invoiceNo: string;
  partnerName: string;
  provider: string;
  status: SettlementStatus;
  orderCount: number;
  grossKobo: number;
  commissionBps: number;
  commissionKobo: number;
  netKobo: number;
  periodFrom: string;
  periodTo: string;
  note: string | null;
  createdAt: string;
  createdByName: string | null;
  paidAt: string | null;
  paidByName: string | null;
  paymentMethod: string | null;
  paymentReference: string | null;
  orders: Array<{
    orderNo: string;
    externalId: string | null;
    customerName: string | null;
    customerPhone: string | null;
    deliveryAddress: string | null;
    totalKobo: number;
    createdAt: string;
    lines: Array<{ itemName: string; quantity: number; lineTotalKobo: number }>;
  }>;
}

const esc = (s: string | null | undefined) =>
  (s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const day = (iso: string) =>
  new Date(iso).toLocaleDateString("en-NG", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
const dayTime = (iso: string) =>
  `${day(iso)} ${new Date(iso).toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit" })}`;

/**
 * Open a clean, print-ready invoice document in a new window and trigger the
 * print dialog. Popup is user-gesture driven (Print button), so browsers
 * allow it. A4-friendly, ink-light layout.
 */
export function printSettlementInvoice(inv: PrintableInvoice) {
  const biz = getCachedBusinessSettings();
  const rows = inv.orders
    .map(
      (o) => `
      <tr class="order-head">
        <td>
          <strong>${esc(o.orderNo)}</strong>${o.externalId ? ` · ${esc(o.externalId)}` : ""}<br/>
          <span class="muted">${dayTime(o.createdAt)}</span>
        </td>
        <td>
          ${esc(o.customerName) || "—"}<br/>
          <span class="muted">${esc(o.customerPhone) || ""}</span>
        </td>
        <td>${esc(o.deliveryAddress) || "—"}</td>
        <td class="r"><strong>${formatNaira(o.totalKobo)}</strong></td>
      </tr>
      <tr class="order-lines">
        <td colspan="4">
          ${o.lines
            .map((l) => `<span class="line">${l.quantity}× ${esc(l.itemName)} — ${formatNaira(l.lineTotalKobo)}</span>`)
            .join("")}
        </td>
      </tr>`,
    )
    .join("");

  const html = `<!doctype html>
<html><head><meta charset="utf-8"/><title>${esc(inv.invoiceNo)} — ${esc(inv.partnerName)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: "Helvetica Neue", Arial, sans-serif; color: #1a1a1a; margin: 32px; font-size: 12px; }
  h1 { font-size: 20px; margin: 0; letter-spacing: 0.06em; }
  .muted { color: #666; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #1a1a1a; padding-bottom: 12px; }
  .head .biz { text-align: right; }
  .meta { display: flex; gap: 24px; margin: 14px 0; flex-wrap: wrap; }
  .meta div { min-width: 130px; }
  .meta b { display: block; font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em; color: #666; margin-bottom: 2px; }
  table { width: 100%; border-collapse: collapse; margin-top: 10px; }
  th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em; color: #666; border-bottom: 1px solid #999; padding: 6px 8px; }
  td { padding: 6px 8px; vertical-align: top; }
  tr.order-head td { border-top: 1px solid #ddd; padding-top: 10px; }
  tr.order-lines td { padding: 0 8px 10px; }
  .line { display: inline-block; background: #f3f3f3; border-radius: 3px; padding: 2px 8px; margin: 0 6px 4px 0; }
  .r { text-align: right; }
  .totals { margin-top: 16px; margin-left: auto; width: 280px; }
  .totals div { display: flex; justify-content: space-between; padding: 4px 0; }
  .totals .net { border-top: 2px solid #1a1a1a; font-size: 16px; font-weight: 700; margin-top: 4px; padding-top: 8px; }
  .status { display: inline-block; border: 1.5px solid currentColor; border-radius: 4px; padding: 2px 10px; font-weight: 700; text-transform: uppercase; font-size: 11px; letter-spacing: 0.12em; }
  .paid { color: #0a7a3d; } .open { color: #b26a00; } .cancelled { color: #b00020; }
  .foot { margin-top: 28px; padding-top: 10px; border-top: 1px solid #ccc; display: flex; justify-content: space-between; }
  @media print { body { margin: 12mm; } button { display: none; } }
</style></head>
<body>
  <div class="head">
    <div>
      <h1>SETTLEMENT INVOICE</h1>
      <div style="margin-top:4px;font-size:15px;font-weight:700">${esc(inv.invoiceNo)}</div>
      <div class="muted">Issued ${dayTime(inv.createdAt)}${inv.createdByName ? ` by ${esc(inv.createdByName)}` : ""}</div>
    </div>
    <div class="biz">
      <strong>${esc(biz?.businessName) || "Royal Bite Kitchen"}</strong><br/>
      ${biz?.businessAddress ? `${esc(biz.businessAddress)}<br/>` : ""}
      ${biz?.businessPhone ? esc(biz.businessPhone) : ""}
    </div>
  </div>

  <div class="meta">
    <div><b>Bill to</b>${esc(inv.partnerName)}</div>
    <div><b>Period covered</b>${day(inv.periodFrom)} — ${day(inv.periodTo)}</div>
    <div><b>Orders</b>${inv.orderCount}</div>
    <div><b>Status</b><span class="status ${inv.status}">${SETTLEMENT_STATUS_LABEL[inv.status]}</span></div>
    ${inv.paidAt ? `<div><b>Paid</b>${dayTime(inv.paidAt)}${inv.paidByName ? ` · ${esc(inv.paidByName)}` : ""}<br/><span class="muted">${esc(inv.paymentMethod) || ""}${inv.paymentReference ? ` · ref ${esc(inv.paymentReference)}` : ""}</span></div>` : ""}
  </div>
  ${inv.note ? `<p><b>Note:</b> ${esc(inv.note)}</p>` : ""}

  <table>
    <thead><tr><th style="width:24%">Order</th><th style="width:22%">Customer</th><th style="width:38%">Delivery address</th><th class="r">Amount</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>

  <div class="totals">
    <div><span>Gross sales (${inv.orderCount} orders)</span><span>${formatNaira(inv.grossKobo)}</span></div>
    <div><span>${esc(inv.partnerName)} commission (${formatBps(inv.commissionBps)})</span><span>−${formatNaira(inv.commissionKobo)}</span></div>
    <div class="net"><span>Net payable</span><span>${formatNaira(inv.netKobo)}</span></div>
  </div>

  <div class="foot">
    <span class="muted">${esc(inv.invoiceNo)} · ${esc(inv.partnerName)}</span>
    <span class="muted">Generated by ${esc(biz?.businessName) || "Royal Bite Kitchen"} POS</span>
  </div>
  <script>window.onload = () => { window.print(); };</script>
</body></html>`;

  const w = window.open("", "_blank", "width=900,height=1100");
  if (!w) return false;
  w.document.write(html);
  w.document.close();
  return true;
}
