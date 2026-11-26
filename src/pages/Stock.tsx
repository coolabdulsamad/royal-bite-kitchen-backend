import { useState, type FormEvent } from "react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Loader2,
  Package,
  Pencil,
  Plus,
  Power,
  PowerOff,
  Scale,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { trpc } from "@/providers/trpc";
import { formatNaira } from "@contracts/money";
import { formatQty, STOCK_MOVEMENT_LABEL } from "@contracts/stock";
import { usePerms } from "@/lib/perms";

const inputCls =
  "mt-2 w-full border-b border-royal-line bg-transparent py-2.5 text-sm text-royal-cream placeholder:text-royal-dim/50 transition-colors focus:border-royal-accent focus:outline-none";
const labelCls =
  "text-[10px] font-semibold uppercase tracking-[0.25em] text-royal-dim";

type MoveType = "restock" | "usage" | "waste" | "adjustment";

const MOVE_ICON: Record<MoveType, typeof ArrowDownToLine> = {
  restock: ArrowDownToLine,
  usage: ArrowUpFromLine,
  waste: Trash2,
  adjustment: Scale,
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString("en-NG", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function StockPage() {
  const utils = trpc.useUtils();
  const { has } = usePerms();
  const canManage = has("stock", "manage");

  const [search, setSearch] = useState("");
  const [lowOnly, setLowOnly] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const list = trpc.stock.list.useQuery({
    search: search || undefined,
    lowOnly,
    includeInactive: canManage,
  });

  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    name: "",
    unit: "",
    openingQuantity: "",
    lowStockAt: "",
    costPerUnit: "",
  });
  const [notice, setNotice] = useState<string | null>(null);

  const createMutation = trpc.stock.create.useMutation({
    onSuccess: () => {
      utils.stock.list.invalidate();
      setForm({ name: "", unit: "", openingQuantity: "", lowStockAt: "", costPerUnit: "" });
      setShowCreate(false);
      setNotice("Stock item added — staff can now record movements against it.");
    },
    onError: (err) => setNotice(err.message),
  });

  function handleCreate(event: FormEvent) {
    event.preventDefault();
    setNotice(null);
    createMutation.mutate({
      name: form.name,
      unit: form.unit,
      openingQuantity: form.openingQuantity ? Number.parseFloat(form.openingQuantity) : 0,
      lowStockAt: form.lowStockAt ? Number.parseFloat(form.lowStockAt) : null,
      costPerUnit: form.costPerUnit ? Number.parseFloat(form.costPerUnit) : null,
    });
  }

  const rows = list.data?.rows ?? [];
  const lowCount = list.data?.lowCount ?? 0;

  return (
    <div className="space-y-8">
      {/* Header row */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-royal-accent">
            Stock & inventory
          </p>
          <p className="mt-2 max-w-lg text-sm leading-6 text-royal-dim">
            Ingredients and supplies with a full movement ledger. Anyone can
            record restock, usage and waste — corrections stay with managers.
          </p>
          {lowCount > 0 && (
            <p className="mt-2 text-sm font-semibold text-amber-400">
              {lowCount} item{lowCount === 1 ? "" : "s"} running low
            </p>
          )}
        </div>
        {canManage && (
          <button
            type="button"
            onClick={() => setShowCreate((v) => !v)}
            className="flex shrink-0 items-center gap-2 rounded-full border border-royal-accent px-5 py-2.5 text-xs font-semibold uppercase tracking-[0.2em] text-royal-accent transition-colors hover:bg-royal-accent hover:text-royal-bg"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2} />
            New item
          </button>
        )}
      </div>

      {notice && (
        <div className="border border-royal-line bg-royal-panel px-4 py-3 text-sm text-royal-cream">
          {notice}
        </div>
      )}

      {/* Create form (manager+) */}
      {showCreate && canManage && (
        <form onSubmit={handleCreate} className="border border-royal-line bg-royal-panel p-6">
          <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-royal-accent">
            Add a stock item
          </p>
          <div className="mt-4 grid gap-6 sm:grid-cols-3">
            <div>
              <label className={labelCls}>Name *</label>
              <input
                className={inputCls}
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Rice (50kg bag)"
                required
                minLength={2}
                maxLength={120}
              />
            </div>
            <div>
              <label className={labelCls}>Unit *</label>
              <input
                className={inputCls}
                value={form.unit}
                onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))}
                placeholder="kg / L / pack / pcs"
                required
                maxLength={20}
              />
            </div>
            <div>
              <label className={labelCls}>Opening quantity</label>
              <input
                type="number"
                min="0"
                step="0.001"
                className={inputCls}
                value={form.openingQuantity}
                onChange={(e) => setForm((f) => ({ ...f, openingQuantity: e.target.value }))}
                placeholder="0"
              />
            </div>
            <div>
              <label className={labelCls}>Low-stock alert at</label>
              <input
                type="number"
                min="0"
                step="0.001"
                className={inputCls}
                value={form.lowStockAt}
                onChange={(e) => setForm((f) => ({ ...f, lowStockAt: e.target.value }))}
                placeholder="Optional — e.g. 5"
              />
            </div>
            <div>
              <label className={labelCls}>Cost per unit (₦)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                className={inputCls}
                value={form.costPerUnit}
                onChange={(e) => setForm((f) => ({ ...f, costPerUnit: e.target.value }))}
                placeholder="Optional"
              />
            </div>
          </div>
          <div className="mt-6 flex items-center gap-3">
            <button
              type="submit"
              disabled={createMutation.isPending}
              className="flex items-center gap-2 rounded-full bg-royal-accent px-6 py-2.5 text-xs font-semibold uppercase tracking-[0.2em] text-royal-bg transition-opacity disabled:opacity-50"
            >
              {createMutation.isPending && (
                <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
              )}
              Add item
            </button>
            <button
              type="button"
              onClick={() => setShowCreate(false)}
              className="rounded-full border border-royal-line px-6 py-2.5 text-xs font-semibold uppercase tracking-[0.2em] text-royal-dim transition-colors hover:text-royal-cream"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Search + filter */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-64 flex-1 items-center gap-2 border-b border-royal-line pb-2">
          <Search className="h-4 w-4 shrink-0 text-royal-dim" strokeWidth={2} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search items…"
            className="w-full bg-transparent text-sm text-royal-cream placeholder:text-royal-dim/50 focus:outline-none"
          />
        </div>
        <button
          type="button"
          onClick={() => setLowOnly((v) => !v)}
          className={`rounded-full border px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.2em] transition-colors ${
            lowOnly
              ? "border-amber-400 bg-amber-400/10 text-amber-300"
              : "border-royal-line text-royal-dim hover:text-royal-cream"
          }`}
        >
          Low stock only
        </button>
      </div>

      {/* List */}
      {list.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-royal-dim">
          <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} /> Loading…
        </div>
      ) : rows.length === 0 ? (
        <div className="border border-dashed border-royal-line px-6 py-10 text-center">
          <Package className="mx-auto h-8 w-8 text-royal-dim" strokeWidth={1.5} />
          <p className="mt-3 text-sm text-royal-dim">
            {search || lowOnly
              ? "No items match that filter."
              : "No stock items yet — a manager adds the first one."}
          </p>
        </div>
      ) : (
        <div className="divide-y divide-royal-line border border-royal-line">
          {rows.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setSelectedId(item.id)}
              className="flex w-full items-center gap-4 px-5 py-4 text-left transition-colors hover:bg-royal-faint/20"
              data-testid={`stock-row-${item.id}`}
            >
              <Package
                className={`h-5 w-5 shrink-0 ${item.active ? "text-royal-accent" : "text-royal-dim"}`}
                strokeWidth={2}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-royal-cream">
                  {item.name}
                  {!item.active && (
                    <span className="ml-2 text-[9px] uppercase tracking-[0.2em] text-royal-dim">
                      deactivated
                    </span>
                  )}
                </p>
                <p className="mt-0.5 truncate text-xs text-royal-dim">
                  {item.costPerUnitKobo !== null
                    ? `${formatNaira(item.costPerUnitKobo)} / ${item.unit}`
                    : "No cost set"}
                  {item.lastMovementAt ? ` · last move ${fmtDate(item.lastMovementAt)}` : ""}
                </p>
              </div>
              {item.low ? (
                <span className="shrink-0 rounded-full border border-amber-400/40 px-3 py-1 text-xs font-semibold text-amber-400">
                  Low · {formatQty(item.quantityMilli)} {item.unit}
                </span>
              ) : (
                <span className="shrink-0 text-sm font-semibold text-royal-cream">
                  {formatQty(item.quantityMilli)} {item.unit}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {selectedId !== null && (
        <StockDetailModal
          itemId={selectedId}
          canManage={canManage}
          onClose={() => setSelectedId(null)}
          onChanged={() => utils.stock.list.invalidate()}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function StockDetailModal({
  itemId,
  canManage,
  onClose,
  onChanged,
}: {
  itemId: number;
  canManage: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const list = trpc.stock.list.useQuery({ includeInactive: true });
  const history = trpc.stock.history.useQuery({ itemId });
  const item = list.data?.rows.find((r) => r.id === itemId);

  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({
    name: "",
    unit: "",
    lowStockAt: "",
    costPerUnit: "",
  });

  const [moveType, setMoveType] = useState<MoveType>("restock");
  const [quantity, setQuantity] = useState("");
  const [note, setNote] = useState("");
  const [totalCost, setTotalCost] = useState("");

  function refresh() {
    list.refetch();
    history.refetch();
    onChanged();
  }

  const moveMutation = trpc.stock.move.useMutation({
    onSuccess: () => {
      setQuantity("");
      setNote("");
      setTotalCost("");
      setError(null);
      refresh();
    },
    onError: (err) => setError(err.message),
  });
  const adjustMutation = trpc.stock.adjust.useMutation({
    onSuccess: () => {
      setQuantity("");
      setNote("");
      setError(null);
      refresh();
    },
    onError: (err) => setError(err.message),
  });
  const updateMutation = trpc.stock.update.useMutation({
    onSuccess: () => {
      setEditing(false);
      setError(null);
      refresh();
    },
    onError: (err) => setError(err.message),
  });

  const busy =
    moveMutation.isPending || adjustMutation.isPending || updateMutation.isPending;

  const qtyNum = Number.parseFloat(quantity);
  const qtyValid = Number.isFinite(qtyNum) && qtyNum >= 0;
  const canSubmit =
    !busy &&
    item?.active &&
    qtyValid &&
    (moveType === "adjustment"
      ? note.trim().length >= 3
      : qtyNum > 0);

  function submitMove() {
    setError(null);
    if (moveType === "adjustment") {
      adjustMutation.mutate({
        itemId,
        newQuantity: qtyNum,
        note: note.trim(),
      });
    } else {
      moveMutation.mutate({
        itemId,
        type: moveType,
        quantity: qtyNum,
        note: note.trim() || undefined,
        totalCost:
          moveType === "restock" && totalCost
            ? Number.parseFloat(totalCost)
            : undefined,
      });
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="royal-scroll relative flex max-h-[92vh] w-full max-w-lg flex-col overflow-y-auto border border-royal-line bg-royal-bgsoft">
        <div className="flex items-start justify-between border-b border-royal-line px-6 py-5">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-royal-accent">
              Stock item
            </p>
            {item && (
              <>
                <p className="mt-1 font-display text-2xl text-royal-cream">{item.name}</p>
                <p className="mt-0.5 text-xs text-royal-dim">
                  counted in {item.unit}
                  {!item.active && " · deactivated"}
                </p>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            {canManage && item && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setEditing((v) => !v);
                    setEditForm({
                      name: item.name,
                      unit: item.unit,
                      lowStockAt:
                        item.lowStockAtMilli !== null
                          ? (item.lowStockAtMilli / 1000).toString()
                          : "",
                      costPerUnit:
                        item.costPerUnitKobo !== null
                          ? (item.costPerUnitKobo / 100).toString()
                          : "",
                    });
                  }}
                  className="p-2 text-royal-dim transition-colors hover:text-royal-accent"
                  aria-label="Edit item"
                >
                  <Pencil className="h-4 w-4" strokeWidth={1.75} />
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    updateMutation.mutate({ id: itemId, active: !item.active })
                  }
                  className="p-2 text-royal-dim transition-colors hover:text-royal-accent"
                  aria-label={item.active ? "Deactivate item" : "Reactivate item"}
                >
                  {item.active ? (
                    <PowerOff className="h-4 w-4" strokeWidth={1.75} />
                  ) : (
                    <Power className="h-4 w-4" strokeWidth={1.75} />
                  )}
                </button>
              </>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-2 text-royal-dim transition-colors hover:text-royal-cream"
              aria-label="Close"
            >
              <X className="h-5 w-5" strokeWidth={1.75} />
            </button>
          </div>
        </div>

        {!item ? (
          <div className="flex items-center gap-2 px-6 py-8 text-sm text-royal-dim">
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} /> Loading…
          </div>
        ) : (
          <div className="px-6 py-5">
            {/* Current level */}
            <div className="border border-royal-line bg-royal-panel px-5 py-4 text-center">
              <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-royal-dim">
                On hand
              </p>
              <p
                className={`mt-1 font-display text-4xl ${
                  item.low ? "text-amber-400" : "text-royal-cream"
                }`}
                data-testid="stock-quantity"
              >
                {formatQty(item.quantityMilli)} {item.unit}
              </p>
              {item.lowStockAtMilli !== null && (
                <p className="mt-1 text-[11px] text-royal-dim">
                  alert when at or below {formatQty(item.lowStockAtMilli)} {item.unit}
                </p>
              )}
            </div>

            {error && (
              <p className="mt-4 border-l-2 border-rose-500/70 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
                {error}
              </p>
            )}

            {/* Edit form (manager+) */}
            {editing && canManage && (
              <div className="mt-4 border border-royal-line p-4">
                <label className={labelCls}>Name</label>
                <input
                  className={inputCls}
                  value={editForm.name}
                  onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                />
                <label className={`${labelCls} mt-3 block`}>Unit</label>
                <input
                  className={inputCls}
                  value={editForm.unit}
                  onChange={(e) => setEditForm((f) => ({ ...f, unit: e.target.value }))}
                />
                <label className={`${labelCls} mt-3 block`}>Low-stock alert at</label>
                <input
                  type="number"
                  min="0"
                  step="0.001"
                  className={inputCls}
                  value={editForm.lowStockAt}
                  onChange={(e) => setEditForm((f) => ({ ...f, lowStockAt: e.target.value }))}
                />
                <label className={`${labelCls} mt-3 block`}>Cost per unit (₦)</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className={inputCls}
                  value={editForm.costPerUnit}
                  onChange={(e) => setEditForm((f) => ({ ...f, costPerUnit: e.target.value }))}
                />
                <button
                  type="button"
                  disabled={busy || editForm.name.trim().length < 2}
                  onClick={() =>
                    updateMutation.mutate({
                      id: itemId,
                      name: editForm.name.trim(),
                      unit: editForm.unit.trim(),
                      lowStockAt: editForm.lowStockAt
                        ? Number.parseFloat(editForm.lowStockAt)
                        : null,
                      costPerUnit: editForm.costPerUnit
                        ? Number.parseFloat(editForm.costPerUnit)
                        : null,
                    })
                  }
                  className="mt-4 rounded-full bg-royal-accent px-5 py-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-royal-bg disabled:opacity-50"
                >
                  Save changes
                </button>
              </div>
            )}

            {/* Record a movement */}
            {item.active && canManage && (
              <div className="mt-4 border border-royal-line p-4">
                <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-royal-accent">
                  Record a movement
                </p>
                <div className="mt-3 flex flex-wrap gap-1">
                  {(Object.keys(STOCK_MOVEMENT_LABEL) as MoveType[])
                    .filter((t) => t !== "adjustment" || canManage)
                    .map((t) => {
                      const Icon = MOVE_ICON[t];
                      return (
                        <button
                          key={t}
                          type="button"
                          onClick={() => setMoveType(t)}
                          className={`flex items-center gap-1.5 border px-3 py-2 text-[9px] font-semibold uppercase tracking-[0.1em] transition-colors ${
                            moveType === t
                              ? "border-royal-accent bg-royal-faint/40 text-royal-cream"
                              : "border-royal-line text-royal-dim hover:text-royal-cream"
                          }`}
                        >
                          <Icon className="h-3 w-3" strokeWidth={2} />
                          {STOCK_MOVEMENT_LABEL[t]}
                        </button>
                      );
                    })}
                </div>
                <label className="mt-3 block">
                  <span className="text-[9px] uppercase tracking-[0.2em] text-royal-dim/70">
                    {moveType === "adjustment"
                      ? `Counted quantity (${item.unit})`
                      : `Quantity (${item.unit})`}
                  </span>
                  <input
                    type="number"
                    min="0"
                    step="0.001"
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                    className={inputCls}
                    placeholder="0"
                  />
                </label>
                {moveType === "restock" && (
                  <label className="mt-3 block">
                    <span className="text-[9px] uppercase tracking-[0.2em] text-royal-dim/70">
                      Total cost (₦, optional)
                    </span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={totalCost}
                      onChange={(e) => setTotalCost(e.target.value)}
                      className={inputCls}
                      placeholder="What you paid in total"
                    />
                  </label>
                )}
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={
                    moveType === "adjustment"
                      ? "Why the correction? (required)"
                      : "Note (optional)"
                  }
                  maxLength={255}
                  className={`${inputCls} mt-2`}
                />
                <button
                  type="button"
                  disabled={!canSubmit}
                  onClick={submitMove}
                  className="mt-3 flex w-full items-center justify-center gap-2 rounded-full bg-royal-accent px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-royal-bg disabled:opacity-50"
                >
                  {(moveMutation.isPending || adjustMutation.isPending) && (
                    <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />
                  )}
                  Save {STOCK_MOVEMENT_LABEL[moveType].toLowerCase()}
                </button>
              </div>
            )}

            {/* History */}
            <p className="mt-6 text-[10px] font-semibold uppercase tracking-[0.3em] text-royal-accent">
              Movement history
            </p>
            {history.isLoading ? (
              <div className="mt-3 flex items-center gap-2 text-sm text-royal-dim">
                <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} /> Loading…
              </div>
            ) : (history.data ?? []).length === 0 ? (
              <p className="mt-3 text-sm text-royal-dim">No movements yet.</p>
            ) : (
              <div className="mt-3 divide-y divide-royal-line border border-royal-line">
                {(history.data ?? []).map((m) => (
                  <div key={m.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-royal-cream">
                        {STOCK_MOVEMENT_LABEL[m.type] ?? m.type}
                        {m.totalCostKobo !== null && (
                          <span className="text-royal-dim">
                            {" "}
                            · {formatNaira(m.totalCostKobo)}
                          </span>
                        )}
                      </p>
                      <p className="mt-0.5 truncate text-[11px] text-royal-dim">
                        {fmtDate(m.createdAt)} · by {m.staffName}
                        {m.note ? ` · ${m.note}` : ""}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p
                        className={`text-sm font-semibold ${
                          m.deltaMilli >= 0 ? "text-emerald-400" : "text-amber-400"
                        }`}
                      >
                        {m.deltaMilli >= 0 ? "+" : "−"}
                        {formatQty(Math.abs(m.deltaMilli))} {item.unit}
                      </p>
                      <p className="text-[10px] text-royal-dim">
                        → {formatQty(m.balanceAfterMilli)} {item.unit}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
