import { useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  Printer,
  RotateCcw,
  Search,
  X,
} from "lucide-react";
import { trpc } from "@/providers/trpc";
import { printerManager } from "@/lib/printing/printer";
import { formatNaira } from "@contracts/money";
import { PAYMENT_METHOD_LABEL, type PaymentMethod } from "@contracts/payments";
import { usePerms } from "@/lib/perms";
import { ReceiptPaper } from "./pos/ReceiptView";
import type { CompletedSaleResult } from "./pos/PaymentModal";

type StatusFilter = "all" | "completed" | "returned";
type RangeKey = "today" | "yesterday" | "7d" | "all";

function rangeBounds(key: RangeKey): { from?: string; to?: string } {
  const now = new Date();
  const startOfDay = (d: Date) => {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  };
  if (key === "today") return { from: startOfDay(now).toISOString() };
  if (key === "yesterday") {
    const y = new Date(now);
    y.setDate(y.getDate() - 1);
    return { from: startOfDay(y).toISOString(), to: startOfDay(now).toISOString() };
  }
  if (key === "7d") {
    const w = new Date(now);
    w.setDate(w.getDate() - 7);
    return { from: w.toISOString() };
  }
  return {};
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : d.toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
}

const chipCls = (active: boolean) =>
  `shrink-0 rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-[0.15em] transition-colors ${
    active
      ? "border-royal-accent bg-royal-accent text-royal-bg"
      : "border-royal-line text-royal-dim hover:border-royal-accent/60 hover:text-royal-cream"
  }`;

export default function SalesPage() {
  const { has, hasAny } = usePerms();
  // See every staff member's sales (filter + cashier column): sales.manage or salesAll.view
  const canSeeAll = hasAny([["sales", "manage"], ["salesAll", "view"]]);
  const canReturn = has("sales", "manage");

  const [range, setRange] = useState<RangeKey>("today");
  const [receipt, setReceipt] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [method, setMethod] = useState<PaymentMethod | "">("");
  const [staffId, setStaffId] = useState<number | undefined>(undefined);
  const [page, setPage] = useState(0);
  const [detailId, setDetailId] = useState<number | null>(null);

  const bounds = useMemo(() => rangeBounds(range), [range]);
  const query = trpc.sales.salesHistory.useQuery({
    ...bounds,
    receipt: receipt.trim() || undefined,
    status,
    method: method || undefined,
    staffId: canSeeAll ? staffId : undefined,
    page,
    pageSize: 25,
  });
  const staffQuery = trpc.staff.names.useQuery(undefined, { enabled: canSeeAll });

  const totalPages = query.data ? Math.max(1, Math.ceil(query.data.total / 25)) : 1;

  function resetPage() {
    setPage(0);
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Filters */}
      <div className="space-y-3 border-b border-royal-line px-4 pb-4 pt-4 sm:px-6">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-52 flex-1">
            <Search
              className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-royal-dim"
              strokeWidth={1.75}
            />
            <input
              value={receipt}
              onChange={(e) => {
                setReceipt(e.target.value);
                resetPage();
              }}
              placeholder="Search receipt number…"
              className="w-full border border-royal-line bg-transparent py-2.5 pl-10 pr-4 text-sm text-royal-cream placeholder:text-royal-dim/50 focus:border-royal-accent focus:outline-none"
            />
          </div>
          {canSeeAll && (
            <select
              value={staffId ?? ""}
              onChange={(e) => {
                setStaffId(e.target.value ? Number(e.target.value) : undefined);
                resetPage();
              }}
              className="border border-royal-line bg-royal-bg px-3 py-2.5 text-sm text-royal-cream focus:border-royal-accent focus:outline-none"
            >
              <option value="">All staff</option>
              {(staffQuery.data ?? []).map((s: { id: number; name: string }) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="royal-scroll flex items-center gap-2 overflow-x-auto pb-1">
          {(
            [
              ["today", "Today"],
              ["yesterday", "Yesterday"],
              ["7d", "Last 7 days"],
              ["all", "All time"],
            ] as Array<[RangeKey, string]>
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={chipCls(range === key)}
              onClick={() => {
                setRange(key);
                resetPage();
              }}
            >
              {label}
            </button>
          ))}
          <span className="mx-1 h-5 w-px shrink-0 bg-royal-line" />
          {(
            [
              ["all", "All"],
              ["completed", "Completed"],
              ["returned", "Returned"],
            ] as Array<[StatusFilter, string]>
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={chipCls(status === key)}
              onClick={() => {
                setStatus(key);
                resetPage();
              }}
            >
              {label}
            </button>
          ))}
          <span className="mx-1 h-5 w-px shrink-0 bg-royal-line" />
          {(
            [
              ["", "Any payment"],
              ["cash", "Cash"],
              ["bank_pos", "Bank POS"],
              ["transfer", "Transfer"],
            ] as Array<[PaymentMethod | "", string]>
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={chipCls(method === key)}
              onClick={() => {
                setMethod(key);
                resetPage();
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="royal-scroll min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
        {query.isLoading && (
          <p className="py-16 text-center text-sm text-royal-dim">Loading sales…</p>
        )}
        {query.isError && (
          <p className="py-16 text-center text-sm text-rose-400">
            Could not load sales — {query.error.message}
          </p>
        )}
        {query.data && query.data.rows.length === 0 && (
          <p className="py-16 text-center text-sm text-royal-dim">
            No sales match these filters.
          </p>
        )}
        {query.data && query.data.rows.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-royal-line text-left text-[10px] font-semibold uppercase tracking-[0.2em] text-royal-dim">
                <th className="pb-3 pr-3">Receipt</th>
                <th className="pb-3 pr-3">When</th>
                {canSeeAll && <th className="hidden pb-3 pr-3 md:table-cell">Cashier</th>}
                <th className="hidden pb-3 pr-3 sm:table-cell">Items</th>
                <th className="hidden pb-3 pr-3 lg:table-cell">Payments</th>
                <th className="pb-3 pr-3 text-right">Total</th>
                <th className="pb-3 text-right">Status</th>
              </tr>
            </thead>
            <tbody>
              {query.data.rows.map((row) => (
                <tr
                  key={row.id}
                  onClick={() => setDetailId(row.id)}
                  className="cursor-pointer border-b border-royal-line/50 transition-colors hover:bg-royal-faint/20"
                >
                  <td className="py-3 pr-3 font-mono text-xs text-royal-accent">
                    {row.receiptNo}
                  </td>
                  <td className="py-3 pr-3 text-royal-cream">{fmtDate(row.soldAt)}</td>
                  {canSeeAll && (
                    <td className="hidden py-3 pr-3 text-royal-dim md:table-cell">
                      {row.staffName ?? "—"}
                    </td>
                  )}
                  <td className="hidden py-3 pr-3 text-royal-dim sm:table-cell">
                    {row.itemCount}
                  </td>
                  <td className="hidden py-3 pr-3 lg:table-cell">
                    <span className="flex flex-wrap gap-1">
                      {row.payments.map((p, i) => (
                        <span
                          key={i}
                          className="rounded-full border border-royal-line px-2 py-0.5 text-[10px] uppercase tracking-wide text-royal-dim"
                        >
                          {PAYMENT_METHOD_LABEL[p.method as PaymentMethod]}
                        </span>
                      ))}
                      {row.creditKobo > 0 && (
                        <span className="rounded-full border border-amber-400/40 px-2 py-0.5 text-[10px] uppercase tracking-wide text-amber-400">
                          Credit {formatNaira(row.creditKobo)}
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="py-3 pr-3 text-right font-semibold text-royal-cream">
                    {formatNaira(row.totalKobo)}
                  </td>
                  <td className="py-3 text-right">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                        row.status === "returned"
                          ? "bg-rose-500/15 text-rose-400"
                          : "bg-emerald-500/15 text-emerald-400"
                      }`}
                    >
                      {row.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {query.data && query.data.total > 0 && (
        <div className="flex items-center justify-between border-t border-royal-line px-4 py-3 sm:px-6">
          <p className="text-xs text-royal-dim">
            Page {page + 1} of {totalPages} · {query.data.total} sale
            {query.data.total === 1 ? "" : "s"}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
              className="flex h-8 w-8 items-center justify-center border border-royal-line text-royal-cream transition-colors hover:border-royal-accent disabled:opacity-30"
              aria-label="Previous page"
            >
              <ChevronLeft className="h-4 w-4" strokeWidth={1.75} />
            </button>
            <button
              type="button"
              disabled={page + 1 >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="flex h-8 w-8 items-center justify-center border border-royal-line text-royal-cream transition-colors hover:border-royal-accent disabled:opacity-30"
              aria-label="Next page"
            >
              <ChevronRight className="h-4 w-4" strokeWidth={1.75} />
            </button>
          </div>
        </div>
      )}

      {detailId !== null && (
        <SaleDetailModal
          saleId={detailId}
          canReturn={canReturn}
          onClose={() => setDetailId(null)}
          onReturned={() => {
            void query.refetch();
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail modal — full receipt, reprint, return
// ---------------------------------------------------------------------------

function SaleDetailModal({
  saleId,
  canReturn,
  onClose,
  onReturned,
}: {
  saleId: number;
  canReturn: boolean;
  onClose: () => void;
  onReturned: () => void;
}) {
  const detail = trpc.sales.saleDetail.useQuery({ saleId });
  const returnMutation = trpc.sales.returnSale.useMutation();
  const utils = trpc.useUtils();

  const [printing, setPrinting] = useState(false);
  const [printError, setPrintError] = useState<string | null>(null);
  const [returnOpen, setReturnOpen] = useState(false);
  const [reason, setReason] = useState("");

  const sale = detail.data;
  const receiptData: CompletedSaleResult | null = sale
    ? {
        saleId: sale.saleId,
        receiptNo: sale.receiptNo,
        cashierName: sale.cashierName,
        soldAt: sale.soldAt,
        lines: sale.lines,
        subtotalKobo: sale.subtotalKobo,
        discountKobo: sale.discountKobo,
        totalKobo: sale.totalKobo,
        customerName: sale.customerName,
        creditKobo: sale.creditKobo,
        payments: sale.payments,
        changeKobo: sale.changeKobo,
      }
    : null;

  async function handlePrint() {
    if (!receiptData) return;
    setPrinting(true);
    setPrintError(null);
    try {
      await printerManager.printReceipt(receiptData);
    } catch (err) {
      setPrintError(err instanceof Error ? err.message : "Printing failed");
    } finally {
      setPrinting(false);
    }
  }

  async function handleReturn() {
    if (reason.trim().length < 3) return;
    try {
      await returnMutation.mutateAsync({ saleId, reason: reason.trim() });
      await utils.sales.saleDetail.invalidate({ saleId });
      setReturnOpen(false);
      setReason("");
      onReturned();
    } catch {
      // error shown via returnMutation.error
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative flex max-h-[92vh] w-full max-w-sm flex-col border border-royal-line bg-royal-bgsoft">
        <div className="flex items-center justify-between border-b border-royal-line px-5 py-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-royal-accent">
              Sale detail
            </p>
            {sale && (
              <p className="mt-0.5 text-sm text-royal-cream">
                {sale.receiptNo} · {formatNaira(sale.totalKobo)}
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
          {detail.isLoading && (
            <p className="py-12 text-center text-sm text-royal-dim">Loading…</p>
          )}
          {detail.isError && (
            <p className="py-12 text-center text-sm text-rose-400">
              {detail.error.message}
            </p>
          )}
          {sale && (
            <>
              {sale.status === "returned" && (
                <div className="mb-4 border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
                  <p className="font-semibold uppercase tracking-[0.15em]">Returned</p>
                  <p className="mt-1">
                    {sale.returnedAt ? fmtDate(sale.returnedAt) : ""}
                    {sale.returnedByName ? ` · by ${sale.returnedByName}` : ""}
                  </p>
                  {sale.returnReason && <p className="mt-1">“{sale.returnReason}”</p>}
                </div>
              )}
              <div className="mx-auto max-w-[280px] shadow-[0_8px_40px_rgba(0,0,0,0.5)]">
                {receiptData && <ReceiptPaper sale={receiptData} />}
              </div>
            </>
          )}
        </div>

        {sale && (
          <div className="border-t border-royal-line px-5 py-4">
            {printError && (
              <p className="mb-3 border-l-2 border-rose-500/70 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
                {printError} — you can try again.
              </p>
            )}
            {returnMutation.error && (
              <p className="mb-3 border-l-2 border-rose-500/70 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
                {returnMutation.error.message}
              </p>
            )}

            {returnOpen ? (
              <div>
                <label className="block">
                  <span className="text-[9px] uppercase tracking-[0.2em] text-royal-dim/70">
                    Reason for the return (required)
                  </span>
                  <input
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="e.g. Customer returned the meal"
                    className="w-full border-b border-royal-line bg-transparent py-2 text-sm text-royal-cream placeholder:text-royal-dim/50 focus:border-royal-accent focus:outline-none"
                  />
                </label>
                <div className="mt-3 flex gap-3">
                  <button
                    type="button"
                    disabled={reason.trim().length < 3 || returnMutation.isPending}
                    onClick={() => void handleReturn()}
                    className="flex flex-1 items-center justify-center gap-2 rounded-full border border-rose-500 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-rose-400 transition-colors hover:bg-rose-500 hover:text-white disabled:opacity-40"
                  >
                    {returnMutation.isPending && (
                      <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
                    )}
                    Confirm return
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setReturnOpen(false);
                      setReason("");
                    }}
                    className="flex-1 rounded-full border border-royal-line py-3 text-xs font-semibold uppercase tracking-[0.18em] text-royal-cream transition-colors hover:border-royal-accent"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex gap-3">
                <button
                  type="button"
                  disabled={printing}
                  onClick={() => void handlePrint()}
                  className="flex flex-1 items-center justify-center gap-2 rounded-full border border-royal-accent py-3 text-xs font-semibold uppercase tracking-[0.18em] text-royal-accent transition-colors hover:bg-royal-accent hover:text-royal-bg disabled:opacity-50"
                >
                  {printing ? (
                    <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
                  ) : (
                    <Printer className="h-4 w-4" strokeWidth={1.75} />
                  )}
                  {printing ? "Printing…" : "Reprint"}
                </button>
                {canReturn && sale.status === "completed" && (
                  <button
                    type="button"
                    onClick={() => setReturnOpen(true)}
                    className="flex flex-1 items-center justify-center gap-2 rounded-full border border-rose-500/60 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-rose-400 transition-colors hover:bg-rose-500 hover:text-white"
                  >
                    <RotateCcw className="h-4 w-4" strokeWidth={1.75} />
                    Return
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
