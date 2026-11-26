import { useEffect, useMemo, useState } from "react";
import {
  Bike,
  Check,
  FileText,
  HandCoins,
  Printer,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { trpc } from "@/providers/trpc";
import { formatNaira } from "@contracts/money";
import {
  SETTLEMENT_STATUS_LABEL,
  formatBps,
  type SettlementStatus,
} from "@contracts/settlements";
import { ORDER_SOURCE_LABEL } from "@contracts/partners";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../api/router";
import { printSettlementInvoice } from "@/lib/printInvoice";
import { usePerms } from "@/lib/perms";

type Overview = inferRouterOutputs<AppRouter>["settlements"]["overview"];
type InvoiceRow = inferRouterOutputs<AppRouter>["settlements"]["invoices"]["rows"][number];
type InvoiceDetail = inferRouterOutputs<AppRouter>["settlements"]["invoiceDetail"];
type UnsettledOrder = inferRouterOutputs<AppRouter>["settlements"]["unsettled"][number];

const isoDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const today = () => isoDay(new Date());
const monthStart = () => {
  const d = new Date();
  d.setDate(1);
  return isoDay(d);
};
const fmtDay = (iso: string) =>
  new Date(iso).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" });
const fmtTime = (iso: string) =>
  `${fmtDay(iso)} · ${new Date(iso).toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit" })}`;

const STATUS_TONE: Record<SettlementStatus, string> = {
  open: "border-amber-400/50 bg-amber-400/10 text-amber-300",
  paid: "border-emerald-400/50 bg-emerald-400/10 text-emerald-300",
  cancelled: "border-rose-400/50 bg-rose-400/10 text-rose-300",
};

function StatusBadge({ status }: { status: SettlementStatus }) {
  return (
    <span
      data-testid={`settlement-status-${status}`}
      className={`inline-block border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${STATUS_TONE[status]}`}
    >
      {SETTLEMENT_STATUS_LABEL[status]}
    </span>
  );
}

export default function SettlementsPage() {
  const utils = trpc.useUtils();
  const { has } = usePerms();
  const canManage = has("settlements", "manage");
  const [tab, setTab] = useState<"unsettled" | "invoices">("unsettled");

  // Overview range (the "received" tiles) — default: this month.
  const [oFrom, setOFrom] = useState(monthStart());
  const [oTo, setOTo] = useState(today());
  const overview = trpc.settlements.overview.useQuery(
    { from: oFrom, to: oTo },
    { refetchInterval: 30_000 },
  );

  const [detailId, setDetailId] = useState<number | null>(null);

  const invalidateAll = () => {
    utils.settlements.overview.invalidate();
    utils.settlements.unsettled.invalidate();
    utils.settlements.invoices.invalidate();
    utils.settlements.invoiceDetail.invalidate();
    utils.orders.list.invalidate();
    utils.money.expenses.list.invalidate();
  };

  return (
    <div className="royal-scroll flex h-full min-h-0 flex-col overflow-y-auto">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3 border-b border-royal-line px-4 py-4 sm:px-6">
        <div>
          <h1 className="font-display text-2xl text-royal-cream">Delivery settlements</h1>
          <p className="mt-0.5 text-[10px] uppercase tracking-[0.25em] text-royal-dim">
            Partner receivables · Glovo &amp; Chowdeck pay in batches
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className="hidden items-center gap-1.5 text-xs text-royal-dim sm:flex">
            <input
              type="date"
              value={oFrom}
              onChange={(e) => setOFrom(e.target.value)}
              className="border border-royal-line bg-transparent px-2 py-1.5 text-xs text-royal-cream [color-scheme:dark]"
            />
            <span>→</span>
            <input
              type="date"
              value={oTo}
              onChange={(e) => setOTo(e.target.value)}
              className="border border-royal-line bg-transparent px-2 py-1.5 text-xs text-royal-cream [color-scheme:dark]"
            />
          </div>
          <button
            type="button"
            onClick={() => overview.refetch()}
            title="Refresh"
            className="flex h-10 w-10 items-center justify-center border border-royal-line text-royal-dim transition-colors hover:border-royal-accent hover:text-royal-accent"
          >
            <RefreshCw className={`h-4 w-4 ${overview.isFetching ? "animate-spin" : ""}`} strokeWidth={1.75} />
          </button>
        </div>
      </div>

      {/* Summary tiles */}
      <div className="grid grid-cols-2 gap-3 px-4 pt-4 sm:px-6 xl:grid-cols-4">
        <Tile
          label="Unsettled orders"
          value={formatNaira(overview.data?.unsettledKobo ?? 0)}
          sub={`${overview.data?.unsettledOrders ?? 0} orders not yet invoiced`}
          tone="amber"
          testid="tile-unsettled"
        />
        <Tile
          label="On open invoices"
          value={formatNaira(overview.data?.openNetKobo ?? 0)}
          sub={`${overview.data?.openInvoices ?? 0} invoices awaiting payment`}
          tone="accent"
          testid="tile-open"
        />
        <Tile
          label="Received (range)"
          value={formatNaira(overview.data?.paidNetKobo ?? 0)}
          sub={`${overview.data?.paidInvoices ?? 0} invoices paid in range`}
          tone="emerald"
          testid="tile-received"
        />
        <Tile
          label="Partner commission (range)"
          value={formatNaira(overview.data?.paidCommissionKobo ?? 0)}
          sub={`of ${formatNaira(overview.data?.paidGrossKobo ?? 0)} gross`}
          tone="rose"
          testid="tile-commission"
        />
      </div>

      {/* Per-partner strip */}
      {overview.data && overview.data.partners.length > 0 && (
        <div className="royal-scroll mt-3 flex gap-2 overflow-x-auto px-4 sm:px-6">
          {overview.data.partners.map((p) => (
            <div
              key={p.connectionId}
              data-testid={`partner-tile-${p.connectionId}`}
              className="min-w-[220px] shrink-0 border border-royal-line bg-royal-surface/60 px-3 py-2.5"
            >
              <p className="flex items-center gap-1.5 text-xs font-semibold text-royal-cream">
                <Bike className="h-3.5 w-3.5 text-royal-accent" strokeWidth={1.75} />
                {p.name}
                <span className="ml-auto text-[10px] text-royal-dim">{formatBps(p.commissionBps)}</span>
              </p>
              <p className="mt-1.5 text-[11px] text-royal-dim">
                Owes <span className="font-semibold text-amber-300">{formatNaira(p.unsettledKobo + p.openNetKobo)}</span>
                {" · "}received <span className="text-emerald-300">{formatNaira(p.paidNetKobo)}</span>
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="mt-4 flex gap-2 border-b border-royal-line px-4 sm:px-6">
        {(
          [
            { key: "unsettled", label: "Unsettled orders" },
            { key: "invoices", label: "Invoices" },
          ] as const
        ).map((t) => (
          <button
            key={t.key}
            type="button"
            data-testid={`tab-${t.key}`}
            onClick={() => setTab(t.key)}
            className={`-mb-px border-b-2 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.15em] transition-colors ${
              tab === t.key
                ? "border-royal-accent text-royal-cream"
                : "border-transparent text-royal-dim hover:text-royal-cream"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 px-4 py-4 sm:px-6">
        {tab === "unsettled" ? (
          <UnsettledTab
            partners={overview.data?.partners ?? []}
            canManage={canManage}
            onChanged={invalidateAll}
            onOpenInvoice={(id) => setDetailId(id)}
          />
        ) : (
          <InvoicesTab
            partners={overview.data?.partners ?? []}
            onOpenInvoice={(id) => setDetailId(id)}
          />
        )}
      </div>

      {detailId !== null && (
        <InvoiceDetailModal
          invoiceId={detailId}
          canManage={canManage}
          onClose={() => setDetailId(null)}
          onChanged={invalidateAll}
        />
      )}
    </div>
  );
}

function Tile({
  label,
  value,
  sub,
  tone,
  testid,
}: {
  label: string;
  value: string;
  sub: string;
  tone: "amber" | "accent" | "emerald" | "rose";
  testid: string;
}) {
  const tones = {
    amber: "text-amber-300",
    accent: "text-royal-accent",
    emerald: "text-emerald-300",
    rose: "text-rose-300",
  };
  return (
    <div data-testid={testid} className="border border-royal-line bg-royal-surface/60 px-4 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-royal-dim">{label}</p>
      <p className={`mt-1 font-display text-xl ${tones[tone]}`}>{value}</p>
      <p className="mt-0.5 text-[11px] text-royal-dim">{sub}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Unsettled register
// ---------------------------------------------------------------------------

function UnsettledTab({
  partners,
  canManage,
  onChanged,
  onOpenInvoice,
}: {
  partners: Overview["partners"];
  canManage: boolean;
  onChanged: () => void;
  onOpenInvoice: (id: number) => void;
}) {
  const [partnerId, setPartnerId] = useState<number | undefined>(undefined);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Map<number, UnsettledOrder>>(new Map());
  const [hint, setHint] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const query = trpc.settlements.unsettled.useQuery(
    {
      partnerConnectionId: partnerId,
      from: from || undefined,
      to: to || undefined,
      search: search.trim() || undefined,
    },
    { refetchInterval: 20_000 },
  );
  const create = trpc.settlements.createInvoice.useMutation({
    onSuccess: (r) => {
      setSelected(new Map());
      setConfirming(false);
      setHint(null);
      onChanged();
      onOpenInvoice(r.invoiceId);
    },
    onError: (e) => {
      setConfirming(false);
      setHint(e.message);
    },
  });

  const rows = useMemo(() => query.data ?? [], [query.data]);
  const selectedRows = [...selected.values()];
  const selectedTotal = selectedRows.reduce((s, o) => s + o.totalKobo, 0);
  const selectedPartner = selectedRows[0]?.partnerConnectionId ?? partnerId;
  const selectedPartnerRow = partners.find((p) => p.connectionId === selectedPartner);

  function toggle(order: UnsettledOrder) {
    setHint(null);
    const next = new Map(selected);
    if (next.has(order.id)) {
      next.delete(order.id);
    } else {
      const first = next.values().next().value as UnsettledOrder | undefined;
      if (first && first.partnerConnectionId !== order.partnerConnectionId) {
        setHint("One invoice per partner — clear the selection or filter by partner first.");
        return;
      }
      next.set(order.id, order);
    }
    setSelected(next);
  }

  function selectAllShown() {
    const first = rows[0];
    if (!first) return;
    if (rows.some((o) => o.partnerConnectionId !== first.partnerConnectionId)) {
      setHint("The list mixes partners — pick a partner in the filter, then select all.");
      return;
    }
    setHint(null);
    setSelected(new Map(rows.map((o) => [o.id, o])));
  }

  return (
    <div>
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          data-testid="unsettled-partner"
          value={partnerId ?? ""}
          onChange={(e) => {
            setPartnerId(e.target.value ? Number(e.target.value) : undefined);
            setSelected(new Map());
            setHint(null);
          }}
          className="border border-royal-line bg-royal-panel px-3 py-2 text-xs text-royal-cream"
        >
          <option value="">All partners</option>
          {partners.map((p) => (
            <option key={p.connectionId} value={p.connectionId}>
              {p.name}
            </option>
          ))}
        </select>
        <input
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          title="From date"
          className="border border-royal-line bg-transparent px-2 py-2 text-xs text-royal-cream [color-scheme:dark]"
        />
        <span className="text-xs text-royal-dim">→</span>
        <input
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          title="To date"
          className="border border-royal-line bg-transparent px-2 py-2 text-xs text-royal-cream [color-scheme:dark]"
        />
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-royal-dim" strokeWidth={1.75} />
          <input
            data-testid="unsettled-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Order no, customer, phone…"
            className="w-56 border border-royal-line bg-transparent py-2 pl-8 pr-3 text-xs text-royal-cream placeholder:text-royal-dim/50 focus:border-royal-accent focus:outline-none"
          />
        </div>
        {canManage && (
        <button
          type="button"
          onClick={selectAllShown}
          className="border border-royal-line px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-royal-dim transition-colors hover:border-royal-accent hover:text-royal-accent"
        >
          Select all shown
        </button>
        )}
      </div>

      {hint && (
        <p className="mt-3 border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-xs text-amber-300">{hint}</p>
      )}
      {create.error && !hint && (
        <p className="mt-3 border border-rose-400/40 bg-rose-400/10 px-3 py-2 text-xs text-rose-300">{create.error.message}</p>
      )}

      {/* Register table */}
      <div className="mt-4 overflow-x-auto border border-royal-line">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead>
            <tr className="border-b border-royal-line text-[10px] uppercase tracking-[0.2em] text-royal-dim">
              {canManage && <th className="w-10 px-3 py-2.5" />}
              <th className="px-3 py-2.5">Order</th>
              <th className="px-3 py-2.5">Partner</th>
              <th className="px-3 py-2.5">Customer</th>
              <th className="px-3 py-2.5">Items</th>
              <th className="px-3 py-2.5 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {query.isLoading && (
              <tr><td colSpan={canManage ? 6 : 5} className="px-3 py-10 text-center text-royal-dim">Loading unsettled orders…</td></tr>
            )}
            {query.data && rows.length === 0 && (
              <tr><td colSpan={canManage ? 6 : 5} className="px-3 py-10 text-center text-royal-dim">Nothing outstanding — every delivered partner order is invoiced or settled.</td></tr>
            )}
            {rows.map((o) => {
              const checked = canManage && selected.has(o.id);
              return (
                <tr
                  key={o.id}
                  data-testid={`unsettled-row-${o.id}`}
                  onClick={canManage ? () => toggle(o) : undefined}
                  className={`border-b border-royal-line/50 transition-colors ${
                    canManage ? "cursor-pointer" : ""
                  } ${checked ? "bg-royal-accent/10" : "hover:bg-royal-faint/30"}`}
                >
                  {canManage && (
                  <td className="px-3 py-2.5">
                    <span
                      className={`flex h-4.5 w-4.5 items-center justify-center border ${
                        checked ? "border-royal-accent bg-royal-accent text-royal-bg" : "border-royal-line"
                      }`}
                    >
                      {checked && <Check className="h-3 w-3" strokeWidth={3} />}
                    </span>
                  </td>
                  )}
                  <td className="px-3 py-2.5">
                    <p className="font-semibold text-royal-cream">{o.orderNo}</p>
                    <p className="text-[11px] text-royal-dim">
                      {fmtTime(o.createdAt)}{o.externalId ? ` · ${o.externalId}` : ""}
                    </p>
                  </td>
                  <td className="px-3 py-2.5 text-xs text-royal-dim">{ORDER_SOURCE_LABEL[o.source]}</td>
                  <td className="px-3 py-2.5">
                    <p className="text-xs text-royal-cream">{o.customerName ?? "—"}</p>
                    <p className="text-[11px] text-royal-dim">{o.customerPhone ?? ""}</p>
                  </td>
                  <td className="px-3 py-2.5 text-xs text-royal-dim">
                    {o.lines.map((l) => `${l.quantity}× ${l.itemName}`).join(", ").slice(0, 60)}
                    {o.lines.map((l) => `${l.quantity}× ${l.itemName}`).join(", ").length > 60 ? "…" : ""}
                  </td>
                  <td className="px-3 py-2.5 text-right font-semibold text-royal-cream">
                    {formatNaira(o.totalKobo)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Sticky action bar */}
      {canManage && selected.size > 0 && (
        <div
          data-testid="invoice-action-bar"
          className="sticky bottom-0 mt-4 flex flex-wrap items-center gap-3 border border-royal-accent/50 bg-royal-panel px-4 py-3 shadow-2xl"
        >
          <p className="text-sm text-royal-cream">
            <span className="font-semibold">{selected.size}</span> order{selected.size > 1 ? "s" : ""} ·{" "}
            <span className="font-semibold">{formatNaira(selectedTotal)}</span>
            {selectedPartnerRow && (
              <span className="text-royal-dim"> · {selectedPartnerRow.name}</span>
            )}
          </p>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSelected(new Map())}
              className="border border-royal-line px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-royal-dim hover:text-royal-cream"
            >
              Clear
            </button>
            <button
              type="button"
              data-testid="generate-invoice"
              onClick={() => setConfirming(true)}
              className="flex items-center gap-2 rounded-full border border-royal-accent bg-royal-accent px-5 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-royal-bg hover:bg-royal-accent/85"
            >
              <FileText className="h-4 w-4" strokeWidth={1.75} />
              Generate invoice
            </button>
          </div>
        </div>
      )}

      {canManage && confirming && selectedPartnerRow && (
        <ConfirmInvoiceModal
          partnerName={selectedPartnerRow.name}
          commissionBps={selectedPartnerRow.commissionBps}
          orders={selectedRows}
          pending={create.isPending}
          onCancel={() => setConfirming(false)}
          onConfirm={(note) =>
            create.mutate({
              partnerConnectionId: selectedPartnerRow.connectionId,
              orderIds: selectedRows.map((o) => o.id),
              note: note || undefined,
            })
          }
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Confirm-invoice modal
// ---------------------------------------------------------------------------

function ConfirmInvoiceModal({
  partnerName,
  commissionBps,
  orders,
  pending,
  onCancel,
  onConfirm,
}: {
  partnerName: string;
  commissionBps: number;
  orders: UnsettledOrder[];
  pending: boolean;
  onCancel: () => void;
  onConfirm: (note: string) => void;
}) {
  const [note, setNote] = useState("");
  const gross = orders.reduce((s, o) => s + o.totalKobo, 0);
  const commission = Math.round((gross * commissionBps) / 10_000);
  const net = gross - commission;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70" onClick={onCancel} />
      <div className="royal-scroll relative max-h-[85vh] w-full max-w-lg overflow-y-auto border border-royal-line bg-royal-bg p-6">
        <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-royal-accent">
          Generate invoice
        </p>
        <p className="mt-2 font-display text-xl text-royal-cream">{partnerName}</p>
        <p className="mt-1 text-xs text-royal-dim">
          {orders.length} order{orders.length > 1 ? "s" : ""} · {fmtDay(orders[0].createdAt)}
          {" — "}
          {fmtDay(orders[orders.length - 1].createdAt)}
        </p>

        <div className="royal-scroll mt-4 max-h-44 space-y-1 overflow-y-auto border border-royal-line/60 p-2">
          {orders.map((o) => (
            <p key={o.id} className="flex items-baseline justify-between gap-2 text-xs">
              <span className="text-royal-cream">{o.orderNo} · {o.customerName ?? "—"}</span>
              <span className="text-royal-dim">{formatNaira(o.totalKobo)}</span>
            </p>
          ))}
        </div>

        <div className="mt-4 space-y-1.5 border-t border-royal-line pt-3 text-sm">
          <p className="flex justify-between text-royal-dim">
            <span>Gross sales</span><span className="text-royal-cream">{formatNaira(gross)}</span>
          </p>
          <p className="flex justify-between text-royal-dim">
            <span>{partnerName} commission ({formatBps(commissionBps)})</span>
            <span className="text-rose-300">−{formatNaira(commission)}</span>
          </p>
          <p className="flex justify-between border-t border-royal-line pt-2 text-base font-semibold text-royal-cream">
            <span>Partner owes</span>
            <span data-testid="invoice-preview-net" className="text-emerald-300">{formatNaira(net)}</span>
          </p>
        </div>

        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Note (optional — e.g. November week 2 payout)"
          className="mt-4 w-full border border-royal-line bg-transparent px-3 py-2 text-sm text-royal-cream placeholder:text-royal-dim/50 focus:border-royal-accent focus:outline-none"
        />

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-full border border-royal-line py-2.5 text-xs font-semibold uppercase tracking-[0.15em] text-royal-dim hover:text-royal-cream"
          >
            Back
          </button>
          <button
            type="button"
            data-testid="confirm-invoice"
            disabled={pending}
            onClick={() => onConfirm(note.trim())}
            className="flex-1 rounded-full border border-royal-accent bg-royal-accent py-2.5 text-xs font-semibold uppercase tracking-[0.15em] text-royal-bg hover:bg-royal-accent/85 disabled:opacity-40"
          >
            {pending ? "Creating…" : "Create invoice"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Invoice register
// ---------------------------------------------------------------------------

function InvoicesTab({
  partners,
  onOpenInvoice,
}: {
  partners: Overview["partners"];
  onOpenInvoice: (id: number) => void;
}) {
  const [status, setStatus] = useState<"all" | SettlementStatus>("all");
  const [partnerId, setPartnerId] = useState<number | undefined>(undefined);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const query = trpc.settlements.invoices.useQuery({
    partnerConnectionId: partnerId,
    status,
    search: search.trim() || undefined,
    page,
    pageSize: 15,
  });
  const totalPages = query.data ? Math.max(1, Math.ceil(query.data.total / query.data.pageSize)) : 1;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1.5">
          {(["all", "open", "paid", "cancelled"] as const).map((s) => (
            <button
              key={s}
              type="button"
              data-testid={`inv-filter-${s}`}
              onClick={() => {
                setStatus(s);
                setPage(1);
              }}
              className={`rounded-full border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] transition-colors ${
                status === s
                  ? "border-royal-accent bg-royal-accent text-royal-bg"
                  : "border-royal-line text-royal-dim hover:text-royal-cream"
              }`}
            >
              {s === "all" ? "All" : SETTLEMENT_STATUS_LABEL[s]}
            </button>
          ))}
        </div>
        <select
          data-testid="inv-partner"
          value={partnerId ?? ""}
          onChange={(e) => {
            setPartnerId(e.target.value ? Number(e.target.value) : undefined);
            setPage(1);
          }}
          className="border border-royal-line bg-royal-panel px-3 py-2 text-xs text-royal-cream"
        >
          <option value="">All partners</option>
          {partners.map((p) => (
            <option key={p.connectionId} value={p.connectionId}>
              {p.name}
            </option>
          ))}
        </select>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-royal-dim" strokeWidth={1.75} />
          <input
            data-testid="inv-search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Invoice no, partner, reference…"
            className="w-60 border border-royal-line bg-transparent py-2 pl-8 pr-3 text-xs text-royal-cream placeholder:text-royal-dim/50 focus:border-royal-accent focus:outline-none"
          />
        </div>
      </div>

      <div className="mt-4 overflow-x-auto border border-royal-line">
        <table className="w-full min-w-[820px] text-left text-sm">
          <thead>
            <tr className="border-b border-royal-line text-[10px] uppercase tracking-[0.2em] text-royal-dim">
              <th className="px-3 py-2.5">Invoice</th>
              <th className="px-3 py-2.5">Partner</th>
              <th className="px-3 py-2.5">Period</th>
              <th className="px-3 py-2.5 text-right">Orders</th>
              <th className="px-3 py-2.5 text-right">Gross</th>
              <th className="px-3 py-2.5 text-right">Commission</th>
              <th className="px-3 py-2.5 text-right">Net</th>
              <th className="px-3 py-2.5">Status</th>
            </tr>
          </thead>
          <tbody>
            {query.isLoading && (
              <tr><td colSpan={8} className="px-3 py-10 text-center text-royal-dim">Loading invoices…</td></tr>
            )}
            {query.data && query.data.rows.length === 0 && (
              <tr><td colSpan={8} className="px-3 py-10 text-center text-royal-dim">No invoices match — generate one from the Unsettled orders tab.</td></tr>
            )}
            {(query.data?.rows ?? []).map((inv) => (
              <InvoiceTableRow key={inv.id} inv={inv} onOpen={() => onOpenInvoice(inv.id)} />
            ))}
          </tbody>
        </table>
      </div>

      {query.data && totalPages > 1 && (
        <div className="mt-3 flex items-center justify-end gap-2 text-xs text-royal-dim">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="border border-royal-line px-3 py-1.5 disabled:opacity-40"
          >
            ← Prev
          </button>
          <span>Page {page} of {totalPages}</span>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="border border-royal-line px-3 py-1.5 disabled:opacity-40"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}

function InvoiceTableRow({ inv, onOpen }: { inv: InvoiceRow; onOpen: () => void }) {
  return (
    <tr
      data-testid={`invoice-row-${inv.id}`}
      onClick={onOpen}
      className="cursor-pointer border-b border-royal-line/50 transition-colors hover:bg-royal-faint/30"
    >
      <td className="px-3 py-2.5">
        <p className="font-semibold text-royal-cream">{inv.invoiceNo}</p>
        <p className="text-[11px] text-royal-dim">{fmtDay(inv.createdAt)} · {inv.createdByName}</p>
      </td>
      <td className="px-3 py-2.5 text-xs text-royal-dim">{inv.partnerName}</td>
      <td className="px-3 py-2.5 text-xs text-royal-dim">
        {fmtDay(inv.periodFrom)} — {fmtDay(inv.periodTo)}
      </td>
      <td className="px-3 py-2.5 text-right text-xs text-royal-dim">{inv.orderCount}</td>
      <td className="px-3 py-2.5 text-right text-royal-cream">{formatNaira(inv.grossKobo)}</td>
      <td className="px-3 py-2.5 text-right text-rose-300">−{formatNaira(inv.commissionKobo)}</td>
      <td className="px-3 py-2.5 text-right font-semibold text-emerald-300">{formatNaira(inv.netKobo)}</td>
      <td className="px-3 py-2.5"><StatusBadge status={inv.status} /></td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Invoice detail modal — full accumulated orders, print, mark paid, cancel
// ---------------------------------------------------------------------------

function InvoiceDetailModal({
  invoiceId,
  canManage,
  onClose,
  onChanged,
}: {
  invoiceId: number;
  canManage: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const query = trpc.settlements.invoiceDetail.useQuery({ invoiceId });
  const [payOpen, setPayOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [method, setMethod] = useState<"cash" | "bank_pos" | "transfer">("transfer");
  const [reference, setReference] = useState("");
  const [reason, setReason] = useState("");

  const markPaid = trpc.settlements.markPaid.useMutation({
    onSuccess: () => {
      setPayOpen(false);
      onChanged();
    },
  });
  const cancelInvoice = trpc.settlements.cancelInvoice.useMutation({
    onSuccess: () => {
      setCancelOpen(false);
      onChanged();
    },
  });

  const inv = query.data;
  const error = markPaid.error?.message ?? cancelInvoice.error?.message ?? null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="royal-scroll relative max-h-[88vh] w-full max-w-2xl overflow-y-auto border border-royal-line bg-royal-bg p-6">
        {query.isLoading && <p className="py-16 text-center text-sm text-royal-dim">Loading invoice…</p>}
        {query.error && <p className="py-16 text-center text-sm text-rose-400">{query.error.message}</p>}

        {inv && (
          <>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-royal-accent">
                  Settlement invoice
                </p>
                <p className="mt-1 font-display text-2xl text-royal-cream" data-testid="invoice-detail-no">
                  {inv.invoiceNo}
                </p>
                <p className="mt-0.5 text-xs text-royal-dim">
                  {inv.partnerName} · {fmtDay(inv.periodFrom)} — {fmtDay(inv.periodTo)} ·{" "}
                  created {fmtDay(inv.createdAt)}{inv.createdByName ? ` by ${inv.createdByName}` : ""}
                </p>
              </div>
              <StatusBadge status={inv.status} />
            </div>

            {inv.note && (
              <p className="mt-3 border border-royal-line/70 bg-royal-surface/40 px-3 py-2 text-xs text-royal-dim">
                {inv.note}
              </p>
            )}
            {inv.status === "paid" && (
              <p className="mt-3 border border-emerald-400/40 bg-emerald-400/10 px-3 py-2 text-xs text-emerald-300">
                Paid {inv.paidAt ? fmtTime(inv.paidAt) : ""}{inv.paidByName ? ` by ${inv.paidByName}` : ""}
                {inv.paymentMethod ? ` · ${inv.paymentMethod}` : ""}
                {inv.paymentReference ? ` · ref ${inv.paymentReference}` : ""}
              </p>
            )}
            {inv.status === "cancelled" && (
              <p className="mt-3 border border-rose-400/40 bg-rose-400/10 px-3 py-2 text-xs text-rose-300">
                Cancelled{inv.cancelReason ? ` — ${inv.cancelReason}` : ""}
              </p>
            )}

            {/* Accumulated orders */}
            <div className="mt-4 space-y-2">
              {inv.orders.map((o) => (
                <div key={o.orderNo} className="border border-royal-line/60 bg-royal-surface/40 px-3 py-2.5">
                  <p className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-sm font-semibold text-royal-cream">
                      {o.orderNo}
                      {o.externalId && <span className="ml-2 text-[11px] font-normal text-royal-dim">{o.externalId}</span>}
                    </span>
                    <span className="text-sm font-semibold text-royal-cream">{formatNaira(o.totalKobo)}</span>
                  </p>
                  <p className="mt-0.5 text-[11px] text-royal-dim">
                    {fmtTime(o.createdAt)} · {o.customerName ?? "—"}
                    {o.customerPhone ? ` · ${o.customerPhone}` : ""}
                  </p>
                  {o.deliveryAddress && (
                    <p className="text-[11px] text-royal-dim">{o.deliveryAddress}</p>
                  )}
                  <p className="mt-1 text-xs text-royal-dim">
                    {o.lines.map((l) => `${l.quantity}× ${l.itemName} (${formatNaira(l.lineTotalKobo)})`).join(", ")}
                  </p>
                </div>
              ))}
            </div>

            {/* Totals */}
            <div className="mt-4 space-y-1.5 border-t border-royal-line pt-3 text-sm">
              <p className="flex justify-between text-royal-dim">
                <span>Gross sales ({inv.orderCount} orders)</span>
                <span className="text-royal-cream">{formatNaira(inv.grossKobo)}</span>
              </p>
              <p className="flex justify-between text-royal-dim">
                <span>{inv.partnerName} commission ({formatBps(inv.commissionBps)})</span>
                <span className="text-rose-300">−{formatNaira(inv.commissionKobo)}</span>
              </p>
              <p className="flex justify-between border-t border-royal-line pt-2 text-lg font-semibold text-royal-cream">
                <span>Net payable</span>
                <span data-testid="invoice-detail-net" className="text-emerald-300">
                  {formatNaira(inv.netKobo)}
                </span>
              </p>
            </div>

            {error && (
              <p className="mt-3 border border-rose-400/40 bg-rose-400/10 px-3 py-2 text-xs text-rose-300">{error}</p>
            )}

            {/* Actions */}
            <div className="mt-5 flex flex-wrap gap-2">
              <button
                type="button"
                data-testid="invoice-print"
                onClick={() => printSettlementInvoice(inv as InvoiceDetail)}
                className="flex items-center gap-2 rounded-full border border-royal-line px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-royal-dim transition-colors hover:border-royal-accent hover:text-royal-accent"
              >
                <Printer className="h-4 w-4" strokeWidth={1.75} />
                Print
              </button>
              {canManage && inv.status === "open" && !payOpen && !cancelOpen && (
                <>
                  <button
                    type="button"
                    data-testid="invoice-mark-paid"
                    onClick={() => setPayOpen(true)}
                    className="ml-auto flex items-center gap-2 rounded-full border border-emerald-400 bg-emerald-400 px-5 py-2.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-royal-bg hover:bg-emerald-400/85"
                  >
                    <HandCoins className="h-4 w-4" strokeWidth={1.75} />
                    Mark as paid
                  </button>
                  <button
                    type="button"
                    onClick={() => setCancelOpen(true)}
                    className="flex items-center gap-2 rounded-full border border-royal-line px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-royal-dim hover:border-rose-400 hover:text-rose-400"
                  >
                    <X className="h-4 w-4" strokeWidth={1.75} />
                    Cancel
                  </button>
                </>
              )}
            </div>

            {canManage && payOpen && inv.status === "open" && (
              <div className="mt-4 border border-emerald-400/40 bg-emerald-400/5 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-300">
                  Record settlement payment
                </p>
                <p className="mt-1 text-xs text-royal-dim">
                  Every order on this invoice is marked paid and posted to sales on its own date
                  {inv.commissionKobo > 0
                    ? `; the ${formatNaira(inv.commissionKobo)} commission is booked as an expense`
                    : ""}.
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <select
                    data-testid="invoice-pay-method"
                    value={method}
                    onChange={(e) => setMethod(e.target.value as typeof method)}
                    className="border border-royal-line bg-royal-panel px-3 py-2 text-xs text-royal-cream"
                  >
                    <option value="transfer">Bank transfer</option>
                    <option value="bank_pos">Bank POS</option>
                    <option value="cash">Cash</option>
                  </select>
                  <input
                    data-testid="invoice-pay-reference"
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                    placeholder="Payment reference (optional)"
                    className="min-w-52 flex-1 border border-royal-line bg-transparent px-3 py-2 text-xs text-royal-cream placeholder:text-royal-dim/50 focus:border-royal-accent focus:outline-none"
                  />
                  <button
                    type="button"
                    data-testid="invoice-pay-confirm"
                    disabled={markPaid.isPending}
                    onClick={() =>
                      markPaid.mutate({
                        invoiceId: inv.id,
                        method,
                        reference: reference.trim() || undefined,
                      })
                    }
                    className="rounded-full border border-emerald-400 bg-emerald-400 px-5 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-royal-bg hover:bg-emerald-400/85 disabled:opacity-40"
                  >
                    {markPaid.isPending ? "Recording…" : `Confirm ${formatNaira(inv.netKobo)} received`}
                  </button>
                  <button
                    type="button"
                    onClick={() => setPayOpen(false)}
                    className="px-3 py-2 text-[11px] uppercase tracking-[0.12em] text-royal-dim hover:text-royal-cream"
                  >
                    Back
                  </button>
                </div>
              </div>
            )}

            {canManage && cancelOpen && inv.status === "open" && (
              <div className="mt-4 border border-rose-400/40 bg-rose-400/5 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-rose-300">
                  Cancel this invoice
                </p>
                <p className="mt-1 text-xs text-royal-dim">
                  The orders return to the unsettled register and can be invoiced again.
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <input
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Reason (required)"
                    className="min-w-52 flex-1 border border-royal-line bg-transparent px-3 py-2 text-xs text-royal-cream placeholder:text-royal-dim/50 focus:border-royal-accent focus:outline-none"
                  />
                  <button
                    type="button"
                    disabled={cancelInvoice.isPending || reason.trim().length < 3}
                    onClick={() => cancelInvoice.mutate({ invoiceId: inv.id, reason: reason.trim() })}
                    className="rounded-full border border-rose-400 bg-rose-400 px-5 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-royal-bg hover:bg-rose-400/85 disabled:opacity-40"
                  >
                    {cancelInvoice.isPending ? "Cancelling…" : "Cancel invoice"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setCancelOpen(false)}
                    className="px-3 py-2 text-[11px] uppercase tracking-[0.12em] text-royal-dim hover:text-royal-cream"
                  >
                    Back
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
