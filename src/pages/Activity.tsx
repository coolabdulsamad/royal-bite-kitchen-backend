import { useState } from "react";
import {
  Activity,
  ChevronLeft,
  ChevronRight,
  Loader2,
  ScrollText,
  Search,
} from "lucide-react";
import { trpc } from "@/providers/trpc";

const ACTION_LABEL: Record<string, string> = {
  "sale.complete": "Sale completed",
  "sale.return": "Sale returned",
  "expense.create": "Expense recorded",
  "expense.void": "Expense voided",
  "drawer.count": "Drawer counted",
  "stock.create": "Stock item added",
  "stock.update": "Stock item updated",
  "stock.move": "Stock movement",
  "stock.adjust": "Stock adjustment",
  "customer.create": "Customer added",
  "customer.update": "Customer updated",
  "customer.repay": "Credit repayment",
  "terminal.create": "Terminal registered",
  "terminal.update": "Terminal updated",
  "staff.create": "Staff added",
  "menu.item": "Menu item changed",
  "menu.category": "Menu category changed",
  "partner.create": "Partner connected",
  "partner.update": "Partner updated",
  "settlement.create": "Settlement invoice created",
  "settlement.paid": "Settlement paid",
  "settlement.cancel": "Settlement cancelled",
  "settings.update": "Settings updated",
  "permissions.update": "Permissions changed",
};

const inputCls =
  "mt-2 w-full border-b border-royal-line bg-transparent py-2.5 text-sm text-royal-cream placeholder:text-royal-dim/50 transition-colors focus:border-royal-accent focus:outline-none";
const labelCls =
  "text-[10px] font-semibold uppercase tracking-[0.25em] text-royal-dim";

export default function ActivityPage() {
  const [action, setAction] = useState("");
  const [staffId, setStaffId] = useState("");
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);

  const staff = trpc.staff.names.useQuery();
  const query = trpc.audit.list.useQuery({
    action: action || undefined,
    staffId: staffId ? Number(staffId) : undefined,
    search: search || undefined,
    from: from || undefined,
    to: to || undefined,
    page,
    pageSize: 30,
  });

  const d = query.data;
  const events = d?.events ?? [];
  const totalPages = d ? Math.max(1, Math.ceil(d.total / d.pageSize)) : 1;

  function resetPage() {
    setPage(1);
  }

  return (
    <div className="space-y-8">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-royal-accent">
          Activity · audit trail
        </p>
        <p className="mt-2 max-w-lg text-sm leading-6 text-royal-dim">
          Every sensitive action in the system — who did what, and when.
          Sales, returns, expenses, stock, customers, staff and settings.
        </p>
      </div>

      {/* Filters */}
      <div className="grid gap-6 border border-royal-line bg-royal-panel p-6 sm:grid-cols-2 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <label className={labelCls}>Search</label>
          <div className="relative">
            <Search className="pointer-events-none absolute right-0 top-1/2 h-4 w-4 -translate-y-1/3 text-royal-dim" strokeWidth={2} />
            <input
              className={`${inputCls} pr-6`}
              value={search}
              onChange={(e) => { setSearch(e.target.value); resetPage(); }}
              placeholder="Receipt no, name, note…"
              data-testid="audit-search"
            />
          </div>
        </div>
        <div>
          <label className={labelCls}>Action</label>
          <select
            className={`${inputCls} cursor-pointer`}
            value={action}
            onChange={(e) => { setAction(e.target.value); resetPage(); }}
            data-testid="audit-action"
          >
            <option value="" className="bg-royal-bg">All actions</option>
            {(d?.actions ?? []).map((a) => (
              <option key={a} value={a} className="bg-royal-bg">
                {ACTION_LABEL[a] ?? a}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls}>Staff</label>
          <select
            className={`${inputCls} cursor-pointer`}
            value={staffId}
            onChange={(e) => { setStaffId(e.target.value); resetPage(); }}
            data-testid="audit-staff"
          >
            <option value="" className="bg-royal-bg">Everyone</option>
            {(staff.data ?? []).map((s) => (
              <option key={s.id} value={s.id} className="bg-royal-bg">
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>From</label>
            <input
              type="date"
              className={`${inputCls} royal-date`}
              value={from}
              onChange={(e) => { setFrom(e.target.value); resetPage(); }}
              data-testid="audit-from"
            />
          </div>
          <div>
            <label className={labelCls}>To</label>
            <input
              type="date"
              className={`${inputCls} royal-date`}
              value={to}
              onChange={(e) => { setTo(e.target.value); resetPage(); }}
              data-testid="audit-to"
            />
          </div>
        </div>
      </div>

      {/* Feed */}
      <section>
        <div className="flex items-center justify-between">
          <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.3em] text-royal-accent">
            <ScrollText className="h-4 w-4" strokeWidth={2} />
            {d ? `${d.total} event${d.total === 1 ? "" : "s"}` : "Events"}
          </p>
          {totalPages > 1 && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                className="rounded-full border border-royal-line p-2 text-royal-dim transition-colors hover:text-royal-cream disabled:opacity-40"
                data-testid="audit-prev"
              >
                <ChevronLeft className="h-4 w-4" strokeWidth={2} />
              </button>
              <span className="text-xs text-royal-dim">{page} / {totalPages}</span>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="rounded-full border border-royal-line p-2 text-royal-dim transition-colors hover:text-royal-cream disabled:opacity-40"
                data-testid="audit-next"
              >
                <ChevronRight className="h-4 w-4" strokeWidth={2} />
              </button>
            </div>
          )}
        </div>

        {query.isLoading ? (
          <div className="mt-4 flex items-center gap-2 text-sm text-royal-dim">
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} /> Loading…
          </div>
        ) : events.length === 0 ? (
          <div className="mt-4 border border-dashed border-royal-line px-6 py-10 text-center">
            <Activity className="mx-auto h-8 w-8 text-royal-dim" strokeWidth={1.5} />
            <p className="mt-3 text-sm text-royal-dim">No events match these filters.</p>
          </div>
        ) : (
          <div className="mt-4 divide-y divide-royal-line border border-royal-line" data-testid="audit-feed">
            {events.map((e) => (
              <div key={e.id} className="flex items-center gap-4 px-5 py-3" data-testid={`audit-row-${e.id}`}>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-royal-cream">
                    <span className="font-semibold">{e.actorName}</span>
                    <span className="mx-2 text-royal-dim">·</span>
                    <span className="text-royal-accent">{ACTION_LABEL[e.action] ?? e.action}</span>
                  </p>
                  {e.detail && (
                    <p className="mt-0.5 truncate text-xs text-royal-dim">{e.detail}</p>
                  )}
                </div>
                <p className="shrink-0 text-xs text-royal-dim">
                  {new Date(e.at).toLocaleString()}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
