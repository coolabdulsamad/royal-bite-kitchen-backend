import { useState, type FormEvent } from "react";
import {
  Banknote,
  CheckCircle2,
  CreditCard,
  Loader2,
  Pencil,
  Plus,
  Power,
  PowerOff,
  Receipt,
  Scale,
  Wallet,
  XCircle,
} from "lucide-react";
import { trpc } from "@/providers/trpc";
import { formatNaira } from "@contracts/money";
import { usePerms } from "@/lib/perms";

const inputCls =
  "mt-2 w-full border-b border-royal-line bg-transparent py-2.5 text-sm text-royal-cream placeholder:text-royal-dim/50 transition-colors focus:border-royal-accent focus:outline-none";
const labelCls =
  "text-[10px] font-semibold uppercase tracking-[0.25em] text-royal-dim";

const EXPENSE_CATEGORIES = [
  "supplies",
  "utilities",
  "wages",
  "rent",
  "transport",
  "equipment",
  "other",
] as const;

// ---------------------------------------------------------------------------
// Cash drawer
// ---------------------------------------------------------------------------

function CashDrawerSection({ canView, canManage }: { canView: boolean; canManage: boolean }) {
  const utils = trpc.useUtils();
  const summary = trpc.money.drawer.summary.useQuery(undefined, {
    refetchInterval: 60_000,
  });
  const counts = trpc.money.drawer.counts.useQuery(
    { limit: 10 },
    { enabled: canView },
  );

  const [counted, setCounted] = useState("");
  const [note, setNote] = useState("");
  const [result, setResult] = useState<{
    countedKobo: number;
    expectedKobo: number;
    diffKobo: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const countMutation = trpc.money.drawer.count.useMutation({
    onSuccess: async (r) => {
      setResult(r);
      setCounted("");
      setNote("");
      setError(null);
      // Cancel-then-invalidate (see refresh() below for why plain
      // invalidate is not enough while the mount batch is in flight).
      await Promise.all([
        utils.money.drawer.summary.cancel(),
        utils.money.drawer.counts.cancel(),
      ]);
      utils.money.drawer.summary.invalidate();
      utils.money.drawer.counts.invalidate();
    },
    onError: (err) => setError(err.message),
  });

  function handleCount(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setResult(null);
    const amount = Number(counted);
    if (!Number.isFinite(amount) || amount < 0) {
      setError("Enter the counted amount in naira.");
      return;
    }
    countMutation.mutate({ counted: amount, note: note || undefined });
  }

  const s = summary.data;

  return (
    <section className="border border-royal-line bg-royal-panel p-6">
      <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.3em] text-royal-accent">
        <Scale className="h-4 w-4" strokeWidth={2} />
        Cash drawer · today
      </p>

      {summary.isLoading ? (
        <div className="mt-4 flex items-center gap-2 text-sm text-royal-dim">
          <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} /> Loading…
        </div>
      ) : (
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="border border-royal-line px-4 py-3">
            <p className={labelCls}>Cash sales</p>
            <p className="mt-1 text-lg font-bold text-royal-cream" data-testid="drawer-sales">
              {formatNaira(s?.cashSalesKobo ?? 0)}
            </p>
          </div>
          <div className="border border-royal-line px-4 py-3">
            <p className={labelCls}>Cash repayments</p>
            <p className="mt-1 text-lg font-bold text-royal-cream" data-testid="drawer-repayments">
              {formatNaira(s?.cashRepaymentsKobo ?? 0)}
            </p>
          </div>
          <div className="border border-royal-line px-4 py-3">
            <p className={labelCls}>Cash expenses</p>
            <p className="mt-1 text-lg font-bold text-red-300" data-testid="drawer-expenses">
              −{formatNaira(s?.cashExpensesKobo ?? 0)}
            </p>
          </div>
          <div className="border border-royal-accent/50 px-4 py-3">
            <p className={labelCls}>Expected in drawer</p>
            <p className="mt-1 text-lg font-bold text-royal-accent" data-testid="drawer-expected">
              {formatNaira(s?.expectedKobo ?? 0)}
            </p>
          </div>
        </div>
      )}

      {canManage && (
      <form onSubmit={handleCount} className="mt-6 grid gap-6 border-t border-royal-line pt-6 sm:grid-cols-[1fr_2fr_auto] sm:items-end">
        <div>
          <label className={labelCls}>Counted cash (₦) *</label>
          <input
            className={inputCls}
            value={counted}
            onChange={(e) => setCounted(e.target.value)}
            placeholder="Physical cash in the drawer"
            inputMode="decimal"
            required
            data-testid="count-input"
          />
        </div>
        <div>
          <label className={labelCls}>Note</label>
          <input
            className={inputCls}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional — e.g. mid-shift handover"
            maxLength={255}
          />
        </div>
        <button
          type="submit"
          disabled={countMutation.isPending}
          className="flex items-center justify-center gap-2 rounded-full bg-royal-accent px-6 py-2.5 text-xs font-semibold uppercase tracking-[0.2em] text-royal-bg transition-opacity disabled:opacity-50"
          data-testid="count-submit"
        >
          {countMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />}
          Count drawer
        </button>
      </form>
      )}

      {error && (
        <p className="mt-4 flex items-center gap-2 text-sm text-red-300">
          <XCircle className="h-4 w-4 shrink-0" strokeWidth={2} /> {error}
        </p>
      )}
      {result && (
        <div
          className={`mt-4 flex items-center gap-2 border px-4 py-3 text-sm ${
            result.diffKobo === 0
              ? "border-royal-accent/40 text-royal-accent"
              : "border-red-400/40 text-red-300"
          }`}
          data-testid="count-result"
        >
          <CheckCircle2 className="h-4 w-4 shrink-0" strokeWidth={2} />
          Counted {formatNaira(result.countedKobo)} against an expected{" "}
          {formatNaira(result.expectedKobo)} —{" "}
          {result.diffKobo === 0
            ? "perfectly balanced."
            : result.diffKobo > 0
              ? `${formatNaira(result.diffKobo)} over.`
              : `${formatNaira(-result.diffKobo)} short.`}
        </div>
      )}

      {canView && (
        <div className="mt-6 border-t border-royal-line pt-6">
          <p className={labelCls}>Recent counts</p>
          {counts.isLoading ? (
            <div className="mt-3 flex items-center gap-2 text-sm text-royal-dim">
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} /> Loading…
            </div>
          ) : (counts.data?.counts ?? []).length === 0 ? (
            <p className="mt-3 text-sm text-royal-dim">No drawer counts recorded yet.</p>
          ) : (
            <div className="mt-3 divide-y divide-royal-line border border-royal-line">
              {(counts.data?.counts ?? []).map((c) => (
                <div
                  key={c.countId}
                  className="flex items-center gap-4 px-5 py-3"
                  data-testid={`count-row-${c.countId}`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-royal-cream">
                      {new Date(c.countedAt).toLocaleString()} · {c.staffName ?? "—"}
                    </p>
                    {c.note && <p className="mt-0.5 truncate text-xs text-royal-dim">{c.note}</p>}
                  </div>
                  <p className="text-xs text-royal-dim">
                    expected {formatNaira(c.expectedKobo)}
                  </p>
                  <p
                    className={`text-sm font-semibold ${
                      c.diffKobo === 0
                        ? "text-royal-accent"
                        : c.diffKobo > 0
                          ? "text-royal-cream"
                          : "text-red-300"
                    }`}
                  >
                    {c.diffKobo === 0
                      ? "balanced"
                      : `${c.diffKobo > 0 ? "+" : "−"}${formatNaira(Math.abs(c.diffKobo))}`}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------------------

function ExpensesSection({ canManage }: { canManage: boolean }) {
  const utils = trpc.useUtils();
  const list = trpc.money.expenses.list.useQuery({ limit: 100 });

  const [showForm, setShowForm] = useState(false);
  const [category, setCategory] = useState<string>("supplies");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<string>("cash");
  const [note, setNote] = useState("");
  const [expenseAt, setExpenseAt] = useState("");
  const [voidingId, setVoidingId] = useState<number | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Cancel-then-invalidate. A plain invalidate() only *joins* an in-flight
  // first fetch instead of starting a fresh one — react-query cancels an
  // in-flight fetch on invalidate only when the query already has data, which
  // is never true while the page's mount batch is still running (remote DB +
  // slow insights query stretch that window to seconds). The mutation then
  // "succeeds" but the list keeps showing mount-time data. Cancelling first
  // drops fetchStatus back to idle so the invalidate starts a genuinely fresh
  // fetch. Per-query cancels don't abort the shared batch HTTP request (tRPC
  // aborts it only once every op in the batch is aborted), so the other
  // in-flight queries are unaffected.
  async function refresh() {
    await Promise.all([
      utils.money.expenses.list.cancel(),
      utils.money.drawer.summary.cancel(),
    ]);
    utils.money.expenses.list.invalidate();
    utils.money.drawer.summary.invalidate();
  }

  const createMutation = trpc.money.expenses.create.useMutation({
    onSuccess: () => {
      refresh();
      setNotice("Expense recorded.");
      setError(null);
      setShowForm(false);
      setAmount("");
      setNote("");
      setExpenseAt("");
    },
    onError: (err) => setError(err.message),
  });
  const voidMutation = trpc.money.expenses.void.useMutation({
    onSuccess: () => {
      refresh();
      setNotice("Expense voided — it no longer counts against the drawer.");
      setVoidingId(null);
      setVoidReason("");
    },
    onError: (err) => setError(err.message),
  });

  function handleCreate(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      setError("Enter an amount in naira.");
      return;
    }
    if (note.trim().length < 3) {
      setError("Add a short note (at least 3 characters).");
      return;
    }
    createMutation.mutate({
      category: category as (typeof EXPENSE_CATEGORIES)[number],
      amount: value,
      note: note.trim(),
      method: method as "cash" | "bank_pos" | "transfer",
      ...(expenseAt ? { expenseAt: new Date(expenseAt) } : {}),
    });
  }

  const expenses = list.data?.expenses ?? [];

  return (
    <section className="border border-royal-line bg-royal-panel p-6">
      <div className="flex items-start justify-between gap-4">
        <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.3em] text-royal-accent">
          <Receipt className="h-4 w-4" strokeWidth={2} />
          Expenses · all staff
        </p>
        {canManage && (
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="flex shrink-0 items-center gap-2 rounded-full border border-royal-accent px-5 py-2.5 text-xs font-semibold uppercase tracking-[0.2em] text-royal-accent transition-colors hover:bg-royal-accent hover:text-royal-bg"
          data-testid="new-expense"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={2} />
          New expense
        </button>
        )}
      </div>

      {notice && (
        <div className="mt-4 flex items-center gap-2 border border-royal-line bg-royal-bg px-4 py-3 text-sm text-royal-cream">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-royal-accent" strokeWidth={2} />
          {notice}
        </div>
      )}
      {error && (
        <p className="mt-4 flex items-center gap-2 text-sm text-red-300">
          <XCircle className="h-4 w-4 shrink-0" strokeWidth={2} /> {error}
        </p>
      )}

      {showForm && canManage && (
        <form onSubmit={handleCreate} className="mt-6 border border-royal-line bg-royal-bg p-6">
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className={labelCls}>Category *</label>
              <select
                className={`${inputCls} cursor-pointer`}
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                data-testid="expense-category"
              >
                {EXPENSE_CATEGORIES.map((c) => (
                  <option key={c} value={c} className="bg-royal-bg">
                    {c[0].toUpperCase() + c.slice(1)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Amount (₦) *</label>
              <input
                className={inputCls}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="e.g. 15000"
                inputMode="decimal"
                required
                data-testid="expense-amount"
              />
            </div>
            <div>
              <label className={labelCls}>Paid via *</label>
              <select
                className={`${inputCls} cursor-pointer`}
                value={method}
                onChange={(e) => setMethod(e.target.value)}
                data-testid="expense-method"
              >
                <option value="cash" className="bg-royal-bg">Cash (drawer)</option>
                <option value="bank_pos" className="bg-royal-bg">Bank POS</option>
                <option value="transfer" className="bg-royal-bg">Transfer</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Note *</label>
              <input
                className={inputCls}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="What was it for?"
                required
                minLength={3}
                maxLength={500}
                data-testid="expense-note"
              />
            </div>
            {canManage && (
              <div>
                <label className={labelCls}>Backdate</label>
                <input
                  type="datetime-local"
                  className={inputCls}
                  value={expenseAt}
                  onChange={(e) => setExpenseAt(e.target.value)}
                  data-testid="expense-backdate"
                />
              </div>
            )}
          </div>
          <div className="mt-6 flex items-center gap-3">
            <button
              type="submit"
              disabled={createMutation.isPending}
              className="flex items-center gap-2 rounded-full bg-royal-accent px-6 py-2.5 text-xs font-semibold uppercase tracking-[0.2em] text-royal-bg transition-opacity disabled:opacity-50"
              data-testid="expense-submit"
            >
              {createMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />}
              Record expense
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="rounded-full border border-royal-line px-6 py-2.5 text-xs font-semibold uppercase tracking-[0.2em] text-royal-dim transition-colors hover:text-royal-cream"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {list.isLoading ? (
        <div className="mt-4 flex items-center gap-2 text-sm text-royal-dim">
          <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} /> Loading…
        </div>
      ) : expenses.length === 0 ? (
        <p className="mt-4 text-sm text-royal-dim">
          No expenses recorded yet. Cash expenses reduce the expected drawer balance.
        </p>
      ) : (
        <div className="mt-4 divide-y divide-royal-line border border-royal-line">
          {expenses.map((e) => (
            <div key={e.expenseId} className="px-5 py-4" data-testid={`expense-row-${e.expenseId}`}>
              <div className="flex items-center gap-4">
                <div className="min-w-0 flex-1">
                  <p className={`truncate text-sm font-semibold ${e.voidedAt ? "text-royal-dim line-through" : "text-royal-cream"}`}>
                    {e.note}
                    <span className="ml-3 border border-royal-line px-2 py-0.5 text-[9px] uppercase tracking-[0.2em] text-royal-dim">
                      {e.category}
                    </span>
                    <span className="ml-2 border border-royal-line px-2 py-0.5 text-[9px] uppercase tracking-[0.2em] text-royal-dim">
                      {e.method.replace("_", " ")}
                    </span>
                    {e.voidedAt && (
                      <span className="ml-2 border border-red-400/40 px-2 py-0.5 text-[9px] uppercase tracking-[0.2em] text-red-300">
                        voided
                      </span>
                    )}
                  </p>
                  <p className="mt-1 truncate text-xs text-royal-dim">
                    {new Date(e.expenseAt).toLocaleString()} · by {e.staffName ?? "—"}
                    {e.voidedAt && ` · voided by ${e.voidedByName ?? "—"}: ${e.voidReason}`}
                  </p>
                </div>
                <p className={`text-sm font-bold ${e.voidedAt ? "text-royal-dim line-through" : "text-royal-accent"}`}>
                  {formatNaira(e.amountKobo)}
                </p>
                {canManage && !e.voidedAt && (
                  <button
                    type="button"
                    onClick={() => {
                      setVoidingId(voidingId === e.expenseId ? null : e.expenseId);
                      setVoidReason("");
                    }}
                    className="rounded-full border border-royal-line px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-royal-dim transition-colors hover:border-red-400 hover:text-red-300"
                    data-testid={`void-expense-${e.expenseId}`}
                  >
                    Void
                  </button>
                )}
              </div>
              {voidingId === e.expenseId && (
                <form
                  className="mt-3 flex items-center gap-3"
                  onSubmit={(ev) => {
                    ev.preventDefault();
                    if (voidReason.trim().length >= 3) {
                      voidMutation.mutate({ expenseId: e.expenseId, reason: voidReason.trim() });
                    }
                  }}
                >
                  <input
                    className={`${inputCls} mt-0 flex-1`}
                    value={voidReason}
                    onChange={(ev2) => setVoidReason(ev2.target.value)}
                    placeholder="Why is this expense being voided? (min 3 chars)"
                    minLength={3}
                    required
                    data-testid="void-reason"
                  />
                  <button
                    type="submit"
                    disabled={voidMutation.isPending}
                    className="flex items-center gap-2 rounded-full border border-red-400 px-5 py-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-red-300 transition-opacity disabled:opacity-50"
                    data-testid="void-confirm"
                  >
                    {voidMutation.isPending && <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />}
                    Confirm void
                  </button>
                </form>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Bank POS terminals (manager only)
// ---------------------------------------------------------------------------

type TerminalForm = {
  name: string;
  provider: string;
  terminalCode: string;
  notes: string;
};
const EMPTY_FORM: TerminalForm = { name: "", provider: "", terminalCode: "", notes: "" };

function TerminalsSection({ canManage }: { canManage: boolean }) {
  const utils = trpc.useUtils();

  const list = trpc.terminals.list.useQuery();
  const stats = trpc.terminals.todayStats.useQuery();

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<TerminalForm>(EMPTY_FORM);
  const [notice, setNotice] = useState<string | null>(null);

  async function refresh() {
    // Cancel-then-invalidate — see the ExpensesSection refresh() comment.
    await Promise.all([
      utils.terminals.list.cancel(),
      utils.terminals.todayStats.cancel(),
    ]);
    utils.terminals.list.invalidate();
    utils.terminals.todayStats.invalidate();
  }

  const createMutation = trpc.terminals.create.useMutation({
    onSuccess: () => {
      refresh();
      setForm(EMPTY_FORM);
      setShowForm(false);
      setNotice("Terminal registered. Cashiers can now pick it at checkout.");
    },
    onError: (err) => setNotice(err.message),
  });
  const updateMutation = trpc.terminals.update.useMutation({
    onSuccess: () => {
      refresh();
      setEditingId(null);
      setForm(EMPTY_FORM);
      setShowForm(false);
    },
    onError: (err) => setNotice(err.message),
  });
  const toggleMutation = trpc.terminals.update.useMutation({
    onSuccess: () => refresh(),
    onError: (err) => setNotice(err.message),
  });

  const busy =
    createMutation.isPending || updateMutation.isPending || toggleMutation.isPending;

  function openCreate() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setNotice(null);
    setShowForm(true);
  }

  function openEdit(t: {
    id: number;
    name: string;
    provider: string | null;
    terminalCode: string | null;
    notes: string | null;
  }) {
    setEditingId(t.id);
    setForm({
      name: t.name,
      provider: t.provider ?? "",
      terminalCode: t.terminalCode ?? "",
      notes: t.notes ?? "",
    });
    setNotice(null);
    setShowForm(true);
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setNotice(null);
    const payload = {
      name: form.name,
      provider: form.provider || undefined,
      terminalCode: form.terminalCode || undefined,
      notes: form.notes || undefined,
    };
    if (editingId !== null) {
      updateMutation.mutate({ id: editingId, ...payload });
    } else {
      createMutation.mutate(payload);
    }
  }

  const terminals = list.data ?? [];
  const todayTotalKobo =
    (stats.data?.terminals ?? []).reduce((sum, t) => sum + t.totalKobo, 0) +
    (stats.data?.unassigned.totalKobo ?? 0);

  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-royal-accent">
            Bank POS terminals
          </p>
          <p className="mt-2 max-w-lg text-sm leading-6 text-royal-dim">
            Register every card machine on the counter. Cashiers pick the
            terminal used on each card payment, so end-of-day settlement
            matches each machine's own report.
          </p>
        </div>
        {canManage && (
        <button
          type="button"
          onClick={() => (showForm ? setShowForm(false) : openCreate())}
          className="flex shrink-0 items-center gap-2 rounded-full border border-royal-accent px-5 py-2.5 text-xs font-semibold uppercase tracking-[0.2em] text-royal-accent transition-colors hover:bg-royal-accent hover:text-royal-bg"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={2} />
          New terminal
        </button>
        )}
      </div>

      {notice && (
        <div className="flex items-center gap-2 border border-royal-line bg-royal-panel px-4 py-3 text-sm text-royal-cream">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-royal-accent" strokeWidth={2} />
          {notice}
        </div>
      )}

      {showForm && canManage && (
        <form onSubmit={handleSubmit} className="border border-royal-line bg-royal-panel p-6">
          <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-royal-accent">
            {editingId !== null ? "Edit terminal" : "Register a terminal"}
          </p>
          <div className="mt-4 grid gap-6 sm:grid-cols-2">
            <div>
              <label className={labelCls}>Terminal name *</label>
              <input
                className={inputCls}
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Counter POS 1"
                required
                minLength={2}
                maxLength={64}
              />
            </div>
            <div>
              <label className={labelCls}>Provider / bank</label>
              <input
                className={inputCls}
                value={form.provider}
                onChange={(e) => setForm((f) => ({ ...f, provider: e.target.value }))}
                placeholder="Moniepoint, OPay, GTB…"
                maxLength={64}
              />
            </div>
            <div>
              <label className={labelCls}>Terminal code / serial</label>
              <input
                className={inputCls}
                value={form.terminalCode}
                onChange={(e) =>
                  setForm((f) => ({ ...f, terminalCode: e.target.value }))
                }
                placeholder="Printed on the machine or its receipt"
                maxLength={64}
              />
            </div>
            <div>
              <label className={labelCls}>Notes</label>
              <input
                className={inputCls}
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder="Optional — e.g. lives at the bar counter"
                maxLength={255}
              />
            </div>
          </div>
          <div className="mt-6 flex items-center gap-3">
            <button
              type="submit"
              disabled={busy}
              className="flex items-center gap-2 rounded-full bg-royal-accent px-6 py-2.5 text-xs font-semibold uppercase tracking-[0.2em] text-royal-bg transition-opacity disabled:opacity-50"
            >
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />}
              {editingId !== null ? "Save changes" : "Register terminal"}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowForm(false);
                setEditingId(null);
                setForm(EMPTY_FORM);
              }}
              className="rounded-full border border-royal-line px-6 py-2.5 text-xs font-semibold uppercase tracking-[0.2em] text-royal-dim transition-colors hover:text-royal-cream"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Today by terminal */}
      <section className="border border-royal-line bg-royal-panel p-6">
        <div className="flex items-center justify-between gap-4">
          <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.3em] text-royal-accent">
            <Banknote className="h-4 w-4" strokeWidth={2} />
            Today's card takings by terminal
          </p>
          <p className="text-sm font-semibold text-royal-cream">
            {formatNaira(todayTotalKobo)}
          </p>
        </div>
        {stats.isLoading ? (
          <div className="mt-4 flex items-center gap-2 text-sm text-royal-dim">
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} /> Loading…
          </div>
        ) : (
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {(stats.data?.terminals ?? []).map((t) => (
              <div
                key={t.id}
                className="border border-royal-line px-4 py-3"
                data-testid={`today-terminal-${t.id}`}
              >
                <p className="truncate text-sm font-semibold text-royal-cream">
                  {t.name}
                  {!t.active && (
                    <span className="ml-2 text-[9px] uppercase tracking-[0.2em] text-royal-dim">
                      disabled
                    </span>
                  )}
                </p>
                <p className="mt-1 text-lg font-bold text-royal-accent">
                  {formatNaira(t.totalKobo)}
                </p>
                <p className="text-[11px] text-royal-dim">
                  {t.payments} payment{t.payments === 1 ? "" : "s"} today
                </p>
              </div>
            ))}
            <div className="border border-dashed border-royal-line px-4 py-3">
              <p className="text-sm font-semibold text-royal-dim">Not assigned to a terminal</p>
              <p className="mt-1 text-lg font-bold text-royal-cream">
                {formatNaira(stats.data?.unassigned.totalKobo ?? 0)}
              </p>
              <p className="text-[11px] text-royal-dim">
                {stats.data?.unassigned.payments ?? 0} payment
                {(stats.data?.unassigned.payments ?? 0) === 1 ? "" : "s"} without a terminal pick
              </p>
            </div>
          </div>
        )}
      </section>

      {/* Registry list */}
      <section>
        <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.3em] text-royal-accent">
          <Wallet className="h-4 w-4" strokeWidth={2} />
          Registered terminals
        </p>
        {list.isLoading ? (
          <div className="mt-4 flex items-center gap-2 text-sm text-royal-dim">
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} /> Loading…
          </div>
        ) : terminals.length === 0 ? (
          <div className="mt-4 border border-dashed border-royal-line px-6 py-10 text-center">
            <CreditCard className="mx-auto h-8 w-8 text-royal-dim" strokeWidth={1.5} />
            <p className="mt-3 text-sm text-royal-dim">
              No terminals yet — register your first card machine so cashiers
              can tag card payments to it.
            </p>
          </div>
        ) : (
          <div className="mt-4 divide-y divide-royal-line border border-royal-line">
            {terminals.map((t) => (
              <div
                key={t.id}
                className="flex items-center gap-4 px-5 py-4"
                data-testid={`terminal-row-${t.id}`}
              >
                <CreditCard
                  className={`h-5 w-5 shrink-0 ${t.active ? "text-royal-accent" : "text-royal-dim"}`}
                  strokeWidth={2}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-royal-cream">
                    {t.name}
                    <span
                      className={`ml-3 border px-2 py-0.5 text-[9px] uppercase tracking-[0.2em] ${
                        t.active
                          ? "border-royal-accent/40 text-royal-accent"
                          : "border-royal-line text-royal-dim"
                      }`}
                    >
                      {t.active ? "Active" : "Disabled"}
                    </span>
                  </p>
                  <p className="mt-1 truncate text-xs text-royal-dim">
                    {[t.provider, t.terminalCode && `S/N ${t.terminalCode}`, t.notes]
                      .filter(Boolean)
                      .join(" · ") || "No extra details"}
                  </p>
                </div>
                {canManage && (
                <button
                  type="button"
                  onClick={() => openEdit(t)}
                  disabled={busy}
                  className="flex items-center gap-1.5 rounded-full border border-royal-line px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-royal-dim transition-colors hover:border-royal-accent hover:text-royal-accent disabled:opacity-50"
                >
                  <Pencil className="h-3 w-3" strokeWidth={2} />
                  Edit
                </button>
                )}
                {canManage && (
                <button
                  type="button"
                  onClick={() =>
                    toggleMutation.mutate({ id: t.id, active: !t.active })
                  }
                  disabled={busy}
                  className={`flex items-center gap-1.5 rounded-full border px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.2em] transition-colors disabled:opacity-50 ${
                    t.active
                      ? "border-royal-line text-royal-dim hover:border-red-400 hover:text-red-300"
                      : "border-royal-line text-royal-dim hover:border-royal-accent hover:text-royal-accent"
                  }`}
                >
                  {t.active ? (
                    <>
                      <PowerOff className="h-3 w-3" strokeWidth={2} />
                      Disable
                    </>
                  ) : (
                    <>
                      <Power className="h-3 w-3" strokeWidth={2} />
                      Enable
                    </>
                  )}
                </button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function MoneyPage() {
  const { has } = usePerms();

  return (
    <div className="space-y-8">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-royal-accent">
          Money
        </p>
        <p className="mt-2 max-w-lg text-sm leading-6 text-royal-dim">
          Count the cash drawer against today's takings and record shop
          expenses. Cash expenses reduce what should be in the drawer.
        </p>
      </div>

      {has("drawer", "view") && (
        <CashDrawerSection canView={has("drawer", "view")} canManage={has("drawer", "manage")} />
      )}
      {has("expenses", "view") && <ExpensesSection canManage={has("expenses", "manage")} />}
      {has("terminals", "view") && <TerminalsSection canManage={has("terminals", "manage")} />}
    </div>
  );
}
