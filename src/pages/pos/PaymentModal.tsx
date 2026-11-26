import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Loader2, Plus, Trash2, User, X } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { trpc } from "@/providers/trpc";
import { formatNaira, nairaToKobo } from "@contracts/money";
import { PAYMENT_METHOD_LABEL, type PaymentMethod } from "@contracts/payments";
import { roleAtLeast } from "@contracts/roles";

export interface CompletedSaleResult {
  saleId: number;
  receiptNo: string;
  cashierName: string;
  soldAt: string;
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
    terminalName?: string | null;
  }>;
  changeKobo: number;
  /** True for a sale saved locally while offline (pending sync). */
  offline?: boolean;
}

/** What the checkout modal hands to its parent on "Complete sale". */
export interface CheckoutSubmitInput {
  items: Array<{ itemId: number; quantity: number; optionIds: number[] }>;
  discount: { type: "percent" | "fixed"; value: number } | null;
  payments: Array<{
    method: PaymentMethod;
    amount: number;
    reference?: string;
    terminalId?: number;
  }>;
  saleDate?: string;
  /** Attach a customer — required when payments fall short (credit sale). */
  customerId?: number;
}

interface PaymentRow {
  method: PaymentMethod;
  /** naira string as typed */
  amount: string;
  reference: string;
  /** Picked bank POS terminal (bank_pos rows only). */
  terminalId: number | null;
}

const inputCls =
  "w-full border-b border-royal-line bg-transparent py-2 text-sm text-royal-cream placeholder:text-royal-dim/50 transition-colors focus:border-royal-accent focus:outline-none";

interface CustomerRowLite {
  id: number;
  name: string;
  phone: string | null;
  creditBalanceKobo: number;
}

/**
 * Themed customer picker — a native <select> renders an unstyled white OS
 * popup (unreadable on the dark theme, no search), so this is a custom
 * dropdown: button + filterable panel, opens upward (it sits low in the
 * checkout modal).
 */
function CustomerPicker({
  rows,
  value,
  onChange,
}: {
  rows: CustomerRowLite[];
  value: number | null;
  onChange: (id: number | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const selected = rows.find((c) => c.id === value) ?? null;
  const term = search.trim().toLowerCase();
  const filtered = term
    ? rows.filter(
        (c) =>
          c.name.toLowerCase().includes(term) ||
          (c.phone ?? "").toLowerCase().includes(term),
      )
    : rows;

  function pick(id: number | null) {
    onChange(id);
    setOpen(false);
    setSearch("");
  }

  return (
    <div className="relative min-w-0 flex-1" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        data-testid="customer-picker"
        className="flex w-full items-center gap-2 border-b border-royal-line bg-transparent py-2 text-left text-sm transition-colors focus:border-royal-accent focus:outline-none"
      >
        <User className="h-3.5 w-3.5 shrink-0 text-royal-dim" strokeWidth={1.75} />
        {selected ? (
          <span className="min-w-0 flex-1 truncate text-royal-cream">
            {selected.name}
            {selected.phone ? ` · ${selected.phone}` : ""}
            {selected.creditBalanceKobo > 0 && (
              <span className="text-amber-400">
                {" "}
                (owes {formatNaira(selected.creditBalanceKobo)})
              </span>
            )}
          </span>
        ) : (
          <span className="flex-1 text-royal-dim">— walk-in / no customer —</span>
        )}
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-royal-dim transition-transform ${open ? "rotate-180" : ""}`}
          strokeWidth={1.75}
        />
      </button>

      {open && (
        <div
          className="absolute bottom-full left-0 z-50 mb-2 w-full border border-royal-line bg-royal-panel shadow-2xl"
          data-testid="customer-picker-panel"
        >
          <div className="border-b border-royal-line p-2">
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name or phone…"
              data-testid="customer-search"
              className="w-full bg-transparent px-2 py-1.5 text-sm text-royal-cream placeholder:text-royal-dim/50 focus:outline-none"
            />
          </div>
          <div className="royal-scroll max-h-64 overflow-y-auto">
            <button
              type="button"
              onClick={() => pick(null)}
              data-testid="customer-walkin"
              className={`flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm transition-colors hover:bg-royal-faint/40 ${
                value === null ? "text-royal-accent" : "text-royal-dim"
              }`}
            >
              — walk-in / no customer —
              {value === null && <Check className="h-3.5 w-3.5" strokeWidth={2} />}
            </button>
            {filtered.length === 0 ? (
              <p className="px-3 py-4 text-center text-xs text-royal-dim">
                No customer matches “{search}”
              </p>
            ) : (
              filtered.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => pick(c.id)}
                  data-testid={`customer-option-${c.id}`}
                  className={`flex w-full items-center justify-between gap-2 border-t border-royal-line/40 px-3 py-2.5 text-left text-sm transition-colors hover:bg-royal-faint/40 ${
                    value === c.id ? "text-royal-accent" : "text-royal-cream"
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate">
                    {c.name}
                    {c.phone ? (
                      <span className="text-royal-dim"> · {c.phone}</span>
                    ) : null}
                    {c.creditBalanceKobo > 0 && (
                      <span className="text-amber-400">
                        {" "}
                        (owes {formatNaira(c.creditBalanceKobo)})
                      </span>
                    )}
                  </span>
                  {value === c.id && (
                    <Check className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function CheckoutModal({
  totalKobo,
  lines,
  discount,
  onSubmit,
  onCancel,
  onCompleted,
  onProgress,
  offlineMode = false,
}: {
  totalKobo: number;
  lines: Array<{ itemId: number; quantity: number; optionIds: number[] }>;
  discount: { type: "percent" | "fixed"; value: number } | null;
  /** Parent-owned submit: saves online or queues offline. Must throw with a
   *  user-readable message on failure. */
  onSubmit: (input: CheckoutSubmitInput) => Promise<CompletedSaleResult>;
  onCancel: () => void;
  onCompleted: (sale: CompletedSaleResult) => void;
  /** live payment progress for the customer display */
  onProgress?: (progress: {
    paidKobo: number;
    payments: Array<{ label: string; amountKobo: number }>;
    customerName?: string | null;
  }) => void;
  /** Offline sales may carry a manual date for any role (within 72h). */
  offlineMode?: boolean;
}) {
  const { user } = useAuth();
  const [rows, setRows] = useState<PaymentRow[]>([
    { method: "cash", amount: (totalKobo / 100).toString(), reference: "", terminalId: null },
  ]);
  const [saleDate, setSaleDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Registered card terminals for bank_pos rows (offline → no picker, the
  // payment just goes through without one).
  const terminalsQuery = trpc.terminals.list.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });
  const terminals = terminalsQuery.data ?? [];

  // Customers for credit tabs / regulars — online only: balances live on the
  // server, so credit sales can't be queued offline.
  const customersQuery = trpc.customers.list.useQuery(
    { pageSize: 100 },
    { retry: false, refetchOnWindowFocus: false, enabled: !offlineMode },
  );
  const customerRows = customersQuery.data?.rows ?? [];
  const [customerId, setCustomerId] = useState<number | null>(null);
  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const [newCustomerName, setNewCustomerName] = useState("");
  const [newCustomerPhone, setNewCustomerPhone] = useState("");
  const createCustomer = trpc.customers.create.useMutation({
    onSuccess: (data) => {
      setCustomerId(data.id);
      setShowNewCustomer(false);
      setNewCustomerName("");
      setNewCustomerPhone("");
      void customersQuery.refetch();
    },
    onError: (err) => setError(err.message),
  });

  const canBackdate = offlineMode || (user ? roleAtLeast(user.role, "manager") : false);

  const paidKobo = useMemo(
    () =>
      rows.reduce((sum, r) => {
        const n = Number.parseFloat(r.amount);
        return sum + (Number.isFinite(n) && n > 0 ? nairaToKobo(n) : 0);
      }, 0),
    [rows],
  );
  const remainingKobo = totalKobo - paidKobo;
  const changeKobo = Math.max(0, -remainingKobo);

  // Report live payment progress (customer display mirrors this)
  useEffect(() => {
    onProgress?.({
      paidKobo,
      payments: rows
        .map((r) => {
          const n = Number.parseFloat(r.amount);
          return Number.isFinite(n) && n > 0
            ? { label: PAYMENT_METHOD_LABEL[r.method], amountKobo: nairaToKobo(n) }
            : null;
        })
        .filter((p): p is { label: string; amountKobo: number } => p !== null),
      customerName: customerRows.find((c) => c.id === customerId)?.name ?? null,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paidKobo, rows, totalKobo, customerId, customerRows]);

  function setRow(index: number, patch: Partial<PaymentRow>) {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  function addRow() {
    setRows((prev) => [
      ...prev,
      {
        method: "bank_pos",
        amount: remainingKobo > 0 ? (remainingKobo / 100).toString() : "",
        reference: "",
        terminalId: null,
      },
    ]);
  }

  async function submit() {
    setError(null);
    const payments = rows
      .map((r) => ({
        method: r.method,
        amount: Number.parseFloat(r.amount),
        reference: r.reference || undefined,
        terminalId:
          r.method === "bank_pos" && r.terminalId !== null ? r.terminalId : undefined,
      }))
      .filter((p) => Number.isFinite(p.amount) && p.amount > 0);

    setSubmitting(true);
    try {
      const sale = await onSubmit({
        items: lines.map((l) => ({
          itemId: l.itemId,
          quantity: l.quantity,
          optionIds: l.optionIds,
        })),
        discount: discount && discount.value > 0 ? discount : null,
        payments,
        saleDate: saleDate ? new Date(saleDate).toISOString() : undefined,
        customerId: customerId ?? undefined,
      });
      onCompleted(sale);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the sale.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-black/70" onClick={onCancel} />
      <div className="royal-scroll relative flex max-h-[90vh] w-full max-w-md flex-col overflow-y-auto border border-royal-line bg-royal-bgsoft">
        <div className="flex items-center justify-between border-b border-royal-line px-6 py-5">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-royal-accent">
              Payment
            </p>
            <p className="mt-1 font-display text-3xl text-royal-cream">
              {formatNaira(totalKobo)}
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="p-2 text-royal-dim transition-colors hover:text-royal-cream"
            aria-label="Close"
          >
            <X className="h-5 w-5" strokeWidth={1.75} />
          </button>
        </div>

        <div className="px-6 py-5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-royal-dim">
            Split payment
          </p>

          <div className="mt-4 space-y-4">
            {rows.map((row, index) => (
              <div key={index} className="border border-royal-line p-4">
                <div className="flex items-center gap-1.5">
                  {(Object.keys(PAYMENT_METHOD_LABEL) as PaymentMethod[]).map(
                    (method) => (
                      <button
                        key={method}
                        type="button"
                        onClick={() => setRow(index, { method, terminalId: null })}
                        className={`flex-1 border px-2 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] transition-colors ${
                          row.method === method
                            ? "border-royal-accent bg-royal-faint/40 text-royal-cream"
                            : "border-royal-line text-royal-dim hover:text-royal-cream"
                        }`}
                      >
                        {PAYMENT_METHOD_LABEL[method]}
                      </button>
                    ),
                  )}
                  {rows.length > 1 && (
                    <button
                      type="button"
                      title="Remove this part"
                      onClick={() =>
                        setRows((prev) => prev.filter((_, i) => i !== index))
                      }
                      className="p-2 text-royal-dim transition-colors hover:text-rose-400"
                    >
                      <Trash2 className="h-4 w-4" strokeWidth={1.75} />
                    </button>
                  )}
                </div>
                <div className="mt-3 flex items-end gap-3">
                  <label className="flex-1">
                    <span className="text-[9px] uppercase tracking-[0.2em] text-royal-dim/70">
                      Amount (₦)
                    </span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={row.amount}
                      onChange={(e) => setRow(index, { amount: e.target.value })}
                      className={inputCls}
                    />
                  </label>
                  {row.method !== "cash" && (
                    <label className="flex-1">
                      <span className="text-[9px] uppercase tracking-[0.2em] text-royal-dim/70">
                        Reference (optional)
                      </span>
                      <input
                        value={row.reference}
                        onChange={(e) =>
                          setRow(index, { reference: e.target.value })
                        }
                        placeholder={
                          row.method === "bank_pos" ? "Approval code" : "Transfer ref"
                        }
                        className={inputCls}
                      />
                    </label>
                  )}
                </div>
                {row.method === "bank_pos" && terminals.length > 0 && (
                  <label className="mt-3 block">
                    <span className="text-[9px] uppercase tracking-[0.2em] text-royal-dim/70">
                      Terminal
                    </span>
                    <select
                      value={row.terminalId ?? ""}
                      onChange={(e) =>
                        setRow(index, {
                          terminalId: e.target.value ? Number(e.target.value) : null,
                        })
                      }
                      className="w-full border-b border-royal-line bg-royal-bgsoft py-2 text-sm text-royal-cream focus:border-royal-accent focus:outline-none"
                    >
                      <option value="">— pick the terminal used —</option>
                      {terminals.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                          {t.provider ? ` (${t.provider})` : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
            ))}
          </div>

          {rows.length < 3 && (
            <button
              type="button"
              onClick={addRow}
              className="mt-4 flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-royal-accent hover:text-royal-cream"
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={2} />
              Split another way
            </button>
          )}

          {/* Balance line */}
          <div className="mt-6 border-t border-royal-line pt-4 text-sm">
            {remainingKobo > 0 ? (
              <p className="flex justify-between text-royal-dim">
                <span>Remaining</span>
                <span className="text-amber-400">{formatNaira(remainingKobo)}</span>
              </p>
            ) : (
              <p className="flex justify-between text-royal-dim">
                <span>Change to give</span>
                <span className={changeKobo > 0 ? "text-emerald-400" : ""}>
                  {formatNaira(changeKobo)}
                </span>
              </p>
            )}
          </div>

          {/* Customer — optional for regulars; REQUIRED when paying short
              (the rest goes on their credit tab). Online only. */}
          {!offlineMode && (
            <div className="mt-5">
              <span className="text-[9px] uppercase tracking-[0.2em] text-royal-dim/70">
                Customer{" "}
                {remainingKobo > 0
                  ? "— required, the rest goes on their credit"
                  : "(optional)"}
              </span>
              <div className="mt-2 flex items-end gap-2">
                <CustomerPicker
                  rows={customerRows}
                  value={customerId}
                  onChange={setCustomerId}
                />
                <button
                  type="button"
                  onClick={() => setShowNewCustomer((v) => !v)}
                  className="shrink-0 rounded-full border border-royal-line px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-royal-accent transition-colors hover:border-royal-accent"
                >
                  New
                </button>
              </div>
              {showNewCustomer && (
                <div className="mt-3 border border-royal-line p-3">
                  <input
                    value={newCustomerName}
                    onChange={(e) => setNewCustomerName(e.target.value)}
                    placeholder="Customer name *"
                    className={inputCls}
                  />
                  <input
                    value={newCustomerPhone}
                    onChange={(e) => setNewCustomerPhone(e.target.value)}
                    placeholder="Phone (optional)"
                    className={`${inputCls} mt-2`}
                  />
                  <button
                    type="button"
                    disabled={
                      newCustomerName.trim().length < 2 || createCustomer.isPending
                    }
                    onClick={() =>
                      createCustomer.mutate({
                        name: newCustomerName.trim(),
                        phone: newCustomerPhone.trim() || undefined,
                      })
                    }
                    className="mt-3 flex items-center gap-2 rounded-full bg-royal-accent px-5 py-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-royal-bg disabled:opacity-50"
                  >
                    {createCustomer.isPending && (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    )}
                    Add & select
                  </button>
                </div>
              )}
              {remainingKobo > 0 && customerId !== null && (
                <p className="mt-2 border-l-2 border-amber-400/70 bg-amber-400/10 px-3 py-2 text-xs text-amber-300">
                  {formatNaira(remainingKobo)} goes on{" "}
                  {customerRows.find((c) => c.id === customerId)?.name ?? "the customer"}
                  &apos;s credit tab
                </p>
              )}
            </div>
          )}

          {/* Manual sale date — manager+ (or anyone while offline) */}
          {canBackdate && (
            <label className="mt-5 block">
              <span className="text-[9px] uppercase tracking-[0.2em] text-royal-dim/70">
                {offlineMode
                  ? "Sale date (optional — offline sales only, up to 72h back)"
                  : "Sale date (optional — manager override)"}
              </span>
              <input
                type="datetime-local"
                value={saleDate}
                onChange={(e) => setSaleDate(e.target.value)}
                className={`${inputCls} royal-date`}
              />
            </label>
          )}

          {error && (
            <p className="mt-5 border-l-2 border-rose-500/70 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
              {error}
            </p>
          )}

          <button
            type="button"
            disabled={
              submitting ||
              (remainingKobo > 0 && (offlineMode || customerId === null))
            }
            onClick={() => void submit()}
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-full border border-royal-accent py-3.5 text-sm font-semibold uppercase tracking-[0.2em] text-royal-accent transition-colors hover:bg-royal-accent hover:text-royal-bg disabled:cursor-not-allowed disabled:opacity-40"
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {submitting
              ? "Saving sale…"
              : remainingKobo > 0
                ? offlineMode
                  ? `${formatNaira(remainingKobo)} still due`
                  : customerId === null
                    ? `Pick a customer for the ${formatNaira(remainingKobo)} balance`
                    : `Complete · ${formatNaira(remainingKobo)} on credit`
                : "Complete sale"}
          </button>
        </div>
      </div>
    </div>
  );
}
