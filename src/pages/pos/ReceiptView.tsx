import { useState } from "react";
import { Loader2, Printer, Plus, X } from "lucide-react";
import { formatNaira } from "@contracts/money";
import { PAYMENT_METHOD_LABEL } from "@contracts/payments";
import { printerManager } from "@/lib/printing/printer";
import { useBusinessSettings } from "@/lib/businessSettings";
import type { CompletedSaleResult } from "./PaymentModal";

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

/** The printable receipt itself — rendered on-screen styled like thermal paper
 *  and picked up by the @media print rules in index.css. */
export function ReceiptPaper({ sale }: { sale: CompletedSaleResult }) {
  const biz = useBusinessSettings();
  return (
    <div id="receipt-paper" className="w-full bg-[#fdfbf7] px-4 py-5 font-mono text-[11px] leading-relaxed text-neutral-900">
      <div className="text-center">
        <p className="text-[15px] font-bold tracking-wide">{biz.businessName}</p>
        {biz.receiptShowAddress && biz.businessAddress && (
          <p className="mt-0.5 text-[10px] text-neutral-500">{biz.businessAddress}</p>
        )}
        {biz.businessPhone && (
          <p className="text-[10px] text-neutral-500">{biz.businessPhone}</p>
        )}
        <p className="mt-0.5 text-[10px] text-neutral-500">
          {formatReceiptDate(sale.soldAt)}
        </p>
        <p className="mt-1 text-[11px] font-semibold">
          Receipt {sale.receiptNo}
        </p>
        {sale.offline && (
          <p className="mt-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-600">
            Offline sale — syncs automatically
          </p>
        )}
        <p className="text-[10px] text-neutral-500">
          Served by {sale.cashierName}
        </p>
        {sale.customerName && (
          <p className="text-[10px] font-semibold text-neutral-700">
            Customer: {sale.customerName}
          </p>
        )}
      </div>

      <div className="my-2 border-t border-dashed border-neutral-400" />

      <div>
        {sale.lines.map((line, i) => (
          <div key={i} className="mb-1.5">
            <div className="flex justify-between gap-2">
              <span className="break-words">
                {line.quantity}× {line.itemName}
              </span>
              <span className="shrink-0 font-semibold">
                {formatNaira(line.lineTotalKobo)}
              </span>
            </div>
            {line.modifiers.map((m, j) => (
              <p key={j} className="pl-3 text-[10px] text-neutral-600">
                · {m.group}: {m.option}
                {m.priceDeltaKobo > 0 &&
                  ` (+${formatNaira(m.priceDeltaKobo)})`}
              </p>
            ))}
          </div>
        ))}
      </div>

      <div className="my-2 border-t border-dashed border-neutral-400" />

      <div className="space-y-0.5">
        <div className="flex justify-between">
          <span>Subtotal</span>
          <span>{formatNaira(sale.subtotalKobo)}</span>
        </div>
        {sale.discountKobo > 0 && (
          <div className="flex justify-between">
            <span>Discount</span>
            <span>-{formatNaira(sale.discountKobo)}</span>
          </div>
        )}
        <div className="flex justify-between text-[13px] font-bold">
          <span>TOTAL</span>
          <span>{formatNaira(sale.totalKobo)}</span>
        </div>
      </div>

      <div className="my-2 border-t border-dashed border-neutral-400" />

      <div className="space-y-0.5">
        {sale.payments.map((p, i) => (
          <div key={i} className="flex justify-between">
            <span>
              {PAYMENT_METHOD_LABEL[p.method]}
              {p.terminalName ? ` · ${p.terminalName}` : ""}
              {p.reference ? ` (${p.reference})` : ""}
            </span>
            <span>{formatNaira(p.amountKobo)}</span>
          </div>
        ))}
        {(sale.creditKobo ?? 0) > 0 && (
          <div className="flex justify-between font-semibold text-amber-700">
            <span>ON CREDIT</span>
            <span>{formatNaira(sale.creditKobo ?? 0)}</span>
          </div>
        )}
        {sale.changeKobo > 0 && (
          <div className="flex justify-between font-semibold">
            <span>Change</span>
            <span>{formatNaira(sale.changeKobo)}</span>
          </div>
        )}
      </div>

      <div className="my-2 border-t border-dashed border-neutral-400" />

      <p className="text-center text-[10px] text-neutral-500">{biz.receiptFooter}</p>
    </div>
  );
}

/** Post-checkout modal: receipt preview + print + start-new-sale. */
export function ReceiptView({
  sale,
  onNewSale,
  onClose,
}: {
  sale: CompletedSaleResult;
  onNewSale: () => void;
  onClose: () => void;
}) {
  const [printing, setPrinting] = useState(false);
  const [printError, setPrintError] = useState<string | null>(null);

  async function handlePrint() {
    setPrinting(true);
    setPrintError(null);
    try {
      await printerManager.printReceipt(sale);
    } catch (err) {
      setPrintError(
        err instanceof Error ? err.message : "Printing failed — check the printer.",
      );
    } finally {
      setPrinting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative flex max-h-[92vh] w-full max-w-sm flex-col border border-royal-line bg-royal-bgsoft">
        <div className="flex items-center justify-between border-b border-royal-line px-5 py-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-royal-accent">
              Sale complete
            </p>
            <p className="mt-0.5 text-sm text-royal-cream">
              {sale.receiptNo} · {formatNaira(sale.totalKobo)}
            </p>
            {sale.offline && (
              <p className="mt-1 text-[10px] uppercase tracking-[0.15em] text-amber-400">
                Saved offline — will sync when you're back online
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-royal-dim transition-colors hover:text-royal-cream"
            aria-label="Close"
          >
            <X className="h-5 w-5" strokeWidth={1.75} />
          </button>
        </div>

        <div className="royal-scroll flex-1 overflow-y-auto p-4">
          <div className="mx-auto max-w-[280px] shadow-[0_8px_40px_rgba(0,0,0,0.5)]">
            <ReceiptPaper sale={sale} />
          </div>
        </div>

        <div className="border-t border-royal-line px-5 py-4">
          {printError && (
            <p className="mb-3 border-l-2 border-rose-500/70 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
              {printError} — you can try again.
            </p>
          )}
          <div className="flex gap-3">
          <button
            type="button"
            disabled={printing}
            onClick={handlePrint}
            className="flex flex-1 items-center justify-center gap-2 rounded-full border border-royal-accent py-3 text-xs font-semibold uppercase tracking-[0.18em] text-royal-accent transition-colors hover:bg-royal-accent hover:text-royal-bg disabled:opacity-50"
          >
            {printing ? (
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
            ) : (
              <Printer className="h-4 w-4" strokeWidth={1.75} />
            )}
            {printing ? "Printing…" : "Print receipt"}
          </button>
          <button
            type="button"
            onClick={onNewSale}
            className="flex flex-1 items-center justify-center gap-2 rounded-full border border-royal-line py-3 text-xs font-semibold uppercase tracking-[0.18em] text-royal-cream transition-colors hover:border-royal-accent hover:text-royal-accent"
          >
            <Plus className="h-4 w-4" strokeWidth={1.75} />
            New sale
          </button>
          </div>
        </div>
      </div>
    </div>
  );
}
