/**
 * ESC/POS receipt encoder — builds the raw byte stream understood by
 * virtually every thermal printer (Xprinter, EPOS, Goojprt, Epson, Star,
 * Sunmi built-ins, …). Pure functions, no I/O: transports deliver the bytes.
 */
import { formatNaira } from "@contracts/money";
import { PAYMENT_METHOD_LABEL, type PaymentMethod } from "@contracts/payments";

/** What the encoder needs from a completed sale — matches CompletedSaleResult. */
export interface ReceiptData {
  receiptNo: string;
  cashierName: string;
  soldAt: string; // ISO
  lines: Array<{
    itemName: string;
    quantity: number;
    modifiers: Array<{ group: string; option: string; priceDeltaKobo: number }>;
    lineTotalKobo: number;
  }>;
  subtotalKobo: number;
  discountKobo: number;
  totalKobo: number;
  /** Attached customer (regulars / credit tabs). */
  customerName?: string | null;
  /** Amount left on the customer's credit tab by this sale. */
  creditKobo?: number;
  payments: Array<{
    method: PaymentMethod;
    amountKobo: number;
    reference: string | null;
    /** Registered terminal name for bank_pos payments, when picked. */
    terminalName?: string | null;
  }>;
  changeKobo: number;
}

export interface EscPosOptions {
  /** Character columns: 48 ≈ 80mm paper (font A), 32 ≈ 58mm paper. */
  width?: 32 | 48;
  /** Replace ₦ with "NGN " for printers that garble UTF-8. */
  asciiMoney?: boolean;
  /** Send paper-cut command at the end. Default true. */
  cut?: boolean;
  /** Blank lines fed before cutting. Default 4. */
  feedLines?: number;
  storeName?: string;
  footerLine?: string;
  /** Extra centered lines under the store name (e.g. address, phone). */
  headerLines?: string[];
}

// ── ESC/POS command bytes ──────────────────────────────────────────────────
const ESC = 0x1b;
const GS = 0x1d;
const CMD_INIT = [ESC, 0x40]; // ESC @ — initialize
const alignCmd = (n: 0 | 1 | 2) => [ESC, 0x61, n]; // ESC a n
const boldCmd = (on: boolean) => [ESC, 0x45, on ? 1 : 0]; // ESC E n
const sizeCmd = (doubleW: boolean, doubleH: boolean) => [
  GS,
  0x21,
  (doubleW ? 0x10 : 0) | (doubleH ? 0x01 : 0), // GS ! n
];
const CUT_PARTIAL = [GS, 0x56, 0x42, 0x00]; // GS V — feed & partial cut

function formatReceiptDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-NG", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

function wrapText(text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (current === "") {
      current = word;
    } else if (current.length + 1 + word.length <= maxWidth) {
      current += " " + word;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current !== "") lines.push(current);
  return lines.length > 0 ? lines : [""];
}

/** Builder: accumulate text lines and raw command bytes, flatten at the end. */
class EscPosBuilder {
  private parts: Array<string | number[]> = [];

  raw(...bytes: number[]): this {
    this.parts.push(bytes);
    return this;
  }
  text(str: string): this {
    this.parts.push(str);
    return this;
  }
  line(str = ""): this {
    this.parts.push(str + "\n");
    return this;
  }
  center(str: string, width: number): this {
    for (const chunk of wrapText(str, width)) {
      const pad = Math.max(0, Math.floor((width - chunk.length) / 2));
      this.line(" ".repeat(pad) + chunk);
    }
    return this;
  }
  /** Left/right pair; wraps the left side, amount stays on the first row. */
  leftRight(left: string, right: string, width: number): this {
    const leftMax = width - right.length - 1;
    if (leftMax < 8) {
      // pathological narrow width — stack them
      this.line(left);
      this.line(" ".repeat(Math.max(0, width - right.length)) + right);
      return this;
    }
    const chunks = wrapText(left, leftMax);
    this.line(chunks[0] + " ".repeat(width - chunks[0].length - right.length) + right);
    for (let i = 1; i < chunks.length; i++) this.line(chunks[i]);
    return this;
  }
  separator(width: number): this {
    return this.line("-".repeat(width));
  }
  build(): Uint8Array {
    const encoder = new TextEncoder();
    const chunks: Uint8Array[] = this.parts.map((p) =>
      typeof p === "string" ? encoder.encode(p) : new Uint8Array(p),
    );
    const total = chunks.reduce((sum, c) => sum + c.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      out.set(c, offset);
      offset += c.length;
    }
    return out;
  }
}

/** Build the complete ESC/POS byte stream for a sale receipt. */
export function receiptToEscPos(
  sale: ReceiptData,
  options: EscPosOptions = {},
): Uint8Array {
  const width = options.width ?? 48;
  const cut = options.cut ?? true;
  const feedLines = options.feedLines ?? 4;
  const storeName = options.storeName ?? "Royal Bite Kitchen";
  const footerLine = options.footerLine ?? "Thank you for dining with us";
  const money = (kobo: number) =>
    options.asciiMoney
      ? `NGN ${(kobo / 100).toLocaleString("en-NG", { maximumFractionDigits: 0 })}`
      : formatNaira(kobo);

  const b = new EscPosBuilder();
  b.raw(...CMD_INIT).raw(...alignCmd(1));

  // Header
  b.raw(...sizeCmd(true, true)).raw(...boldCmd(true));
  b.center(storeName.toUpperCase(), width / 2); // double-width chars take 2 cols
  b.raw(...sizeCmd(false, false)).raw(...boldCmd(false));
  for (const line of options.headerLines ?? []) {
    b.center(line, width);
  }
  b.center(formatReceiptDate(sale.soldAt), width);
  b.raw(...boldCmd(true)).center(`Receipt ${sale.receiptNo}`, width).raw(...boldCmd(false));
  b.center(`Served by ${sale.cashierName}`, width);
  if (sale.customerName) {
    b.raw(...boldCmd(true)).center(`Customer: ${sale.customerName}`, width).raw(...boldCmd(false));
  }
  b.raw(...alignCmd(0)).separator(width);

  // Items
  for (const line of sale.lines) {
    b.leftRight(`${line.quantity}x ${line.itemName}`, money(line.lineTotalKobo), width);
    for (const m of line.modifiers) {
      const suffix = m.priceDeltaKobo > 0 ? ` (+${money(m.priceDeltaKobo)})` : "";
      const text = `  . ${m.group}: ${m.option}${suffix}`;
      for (const chunk of wrapText(text, width)) b.line(chunk);
    }
  }
  b.separator(width);

  // Totals
  b.leftRight("Subtotal", money(sale.subtotalKobo), width);
  if (sale.discountKobo > 0) b.leftRight("Discount", `-${money(sale.discountKobo)}`, width);
  b.raw(...boldCmd(true)).raw(...sizeCmd(true, false));
  b.leftRight("TOTAL", money(sale.totalKobo), width / 2);
  b.raw(...sizeCmd(false, false)).raw(...boldCmd(false));
  b.separator(width);

  // Payments
  for (const p of sale.payments) {
    const label =
      PAYMENT_METHOD_LABEL[p.method] +
      (p.terminalName ? ` · ${p.terminalName}` : "") +
      (p.reference ? ` (${p.reference})` : "");
    b.leftRight(label, money(p.amountKobo), width);
  }
  if ((sale.creditKobo ?? 0) > 0) {
    b.raw(...boldCmd(true)).leftRight("ON CREDIT", money(sale.creditKobo ?? 0), width).raw(...boldCmd(false));
  }
  if (sale.changeKobo > 0) {
    b.raw(...boldCmd(true)).leftRight("Change", money(sale.changeKobo), width).raw(...boldCmd(false));
  }
  b.separator(width);

  // Footer
  b.raw(...alignCmd(1)).center(footerLine, width);
  for (let i = 0; i < feedLines; i++) b.line();
  if (cut) b.raw(...CUT_PARTIAL);

  return b.build();
}

/** What the encoder needs for a kitchen ticket — no money, just the work. */
export interface KitchenTicketData {
  orderNo: string;
  /** Table / customer tag — printed biggest, it's what the kitchen shouts. */
  label: string;
  notes: string | null;
  staffName: string;
  /** ISO datetime the order was placed */
  placedAt: string;
  /** Delivery-partner block — printed bold so the rider details stand out. */
  delivery?: {
    source: string;
    customerName: string | null;
    customerPhone: string | null;
    deliveryAddress: string | null;
  } | null;
  lines: Array<{
    itemName: string;
    quantity: number;
    modifiers: Array<{ group: string; option: string }>;
  }>;
}

/**
 * Kitchen ticket — big order number and table, bold quantities, no prices.
 * Printed when an order is placed (and re-printable from the orders board).
 */
export function kitchenTicketToEscPos(
  ticket: KitchenTicketData,
  options: EscPosOptions = {},
): Uint8Array {
  const width = options.width ?? 48;
  const cut = options.cut ?? true;
  const feedLines = options.feedLines ?? 4;

  const b = new EscPosBuilder();
  b.raw(...CMD_INIT).raw(...alignCmd(1));
  b.center("ROYAL BITE KITCHEN", width);
  b.raw(...boldCmd(true)).center("KITCHEN TICKET", width).raw(...boldCmd(false));
  b.raw(...sizeCmd(true, true)).raw(...boldCmd(true));
  b.center(ticket.orderNo, width / 2);
  b.center(ticket.label, width / 2);
  b.raw(...sizeCmd(false, false)).raw(...boldCmd(false));
  b.center(formatReceiptDate(ticket.placedAt), width);
  b.center(`Taken by ${ticket.staffName}`, width);
  if (ticket.delivery) {
    b.raw(...alignCmd(0)).separator(width);
    b.raw(...boldCmd(true));
    b.center(`${ticket.delivery.source.toUpperCase()} DELIVERY`, width);
    b.raw(...boldCmd(false));
    b.raw(...alignCmd(1));
    if (ticket.delivery.customerPhone) {
      b.center(ticket.delivery.customerPhone, width);
    }
    if (ticket.delivery.deliveryAddress) {
      b.raw(...alignCmd(0));
      for (const chunk of wrapText(`To: ${ticket.delivery.deliveryAddress}`, width)) {
        b.line(chunk);
      }
    }
  }
  b.raw(...alignCmd(0)).separator(width);

  for (const line of ticket.lines) {
    b.raw(...boldCmd(true));
    for (const chunk of wrapText(`${line.quantity}x ${line.itemName}`, width)) {
      b.line(chunk);
    }
    b.raw(...boldCmd(false));
    for (const m of line.modifiers) {
      for (const chunk of wrapText(`  . ${m.group}: ${m.option}`, width)) {
        b.line(chunk);
      }
    }
  }

  if (ticket.notes) {
    b.separator(width);
    b.raw(...boldCmd(true));
    for (const chunk of wrapText(`NOTE: ${ticket.notes}`, width)) b.line(chunk);
    b.raw(...boldCmd(false));
  }
  b.separator(width);
  for (let i = 0; i < feedLines; i++) b.line();
  if (cut) b.raw(...CUT_PARTIAL);
  return b.build();
}

/** A small self-test ticket so users can verify a newly connected printer. */
export function testTicketEscPos(options: EscPosOptions = {}): Uint8Array {
  const width = options.width ?? 48;
  const cut = options.cut ?? true;
  const feedLines = options.feedLines ?? 4;

  const b = new EscPosBuilder();
  b.raw(...CMD_INIT).raw(...alignCmd(1));
  b.raw(...sizeCmd(true, true)).raw(...boldCmd(true));
  b.center("ROYAL BITE KITCHEN", width / 2);
  b.raw(...sizeCmd(false, false)).raw(...boldCmd(false));
  b.center("Printer test", width);
  b.center(formatReceiptDate(new Date().toISOString()), width);
  b.raw(...alignCmd(0)).separator(width);
  b.leftRight("Normal text", "OK", width);
  b.raw(...boldCmd(true)).leftRight("Bold text", "OK", width).raw(...boldCmd(false));
  b.leftRight("Money", options.asciiMoney ? "NGN 1,234" : formatNaira(123400), width);
  b.leftRight("1234567890", "1234567890", width);
  b.separator(width);
  b.raw(...alignCmd(1)).center("If you can read this,", width);
  b.center("the printer is ready.", width);
  for (let i = 0; i < feedLines; i++) b.line();
  if (cut) b.raw(...CUT_PARTIAL);
  return b.build();
}
