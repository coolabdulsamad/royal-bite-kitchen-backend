import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import {
  Bike,
  ChefHat,
  CircleDollarSign,
  Clock3,
  Plug,
  Plus,
  Printer,
  RefreshCw,
  X,
} from "lucide-react";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/lib/auth";
import { printerManager, usePrinter } from "@/lib/printing/printer";
import { formatNaira } from "@contracts/money";
import {
  ACTIVE_ORDER_STATUSES,
  NEXT_ORDER_STATUS,
  ORDER_ELAPSED_LATE_MIN,
  ORDER_ELAPSED_WARN_MIN,
  ORDER_STATUS_LABEL,
  type OrderStatus,
} from "@contracts/orders";
import { ORDER_SOURCE_LABEL } from "@contracts/partners";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../api/router";
import { NewOrderModal } from "./orders/NewOrderModal";
import { PartnersModal } from "./orders/PartnersModal";

type BoardOrder = inferRouterOutputs<AppRouter>["orders"]["list"][number];

type Filter = "active" | "all" | "delivery" | OrderStatus;

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: "active", label: "Kitchen board" },
  { key: "delivery", label: "Delivery" },
  { key: "placed", label: "Placed" },
  { key: "preparing", label: "Preparing" },
  { key: "ready", label: "Ready" },
  { key: "served", label: "Served" },
  { key: "completed", label: "Done" },
  { key: "cancelled", label: "Cancelled" },
  { key: "all", label: "All" },
];

/** Two-tone kitchen beep for newly arrived delivery orders (WebAudio). */
function beepNewOrder() {
  try {
    const Ctx = window.AudioContext;
    const ctx = new Ctx();
    const play = (freq: number, start: number, dur: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      osc.type = "square";
      gain.gain.setValueAtTime(0.08, ctx.currentTime + start);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + start);
      osc.stop(ctx.currentTime + start + dur);
    };
    play(880, 0, 0.15);
    play(1174, 0.18, 0.25);
    setTimeout(() => ctx.close(), 800);
  } catch {
    /* audio blocked until a user gesture — silent skip */
  }
}

const BOARD_COLUMNS: OrderStatus[] = ["placed", "preparing", "ready", "served"];

function elapsedMinutes(createdAt: string, now: number): number {
  return Math.max(0, Math.floor((now - new Date(createdAt).getTime()) / 60000));
}

function formatElapsed(min: number): string {
  if (min < 60) return `${min}m`;
  return `${Math.floor(min / 60)}h ${min % 60}m`;
}

export default function OrdersPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { settings: printerSettings, direct } = usePrinter();
  const isManager = user?.role === "manager" || user?.role === "admin" || user?.role === "superadmin";

  const [filter, setFilter] = useState<Filter>("active");
  const [newOpen, setNewOpen] = useState(false);
  const [partnersOpen, setPartnersOpen] = useState(false);
  const [cancelling, setCancelling] = useState<BoardOrder | null>(null);
  const [printHint, setPrintHint] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // Elapsed timers tick without waiting for the next poll.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const query = trpc.orders.list.useQuery(
    filter === "delivery"
      ? { status: "active", source: "delivery" }
      : { status: filter },
    { refetchInterval: 15_000 },
  );
  const utils = trpc.useUtils();
  const advance = trpc.orders.advance.useMutation({
    onSuccess: () => utils.orders.list.invalidate(),
  });
  const cancel = trpc.orders.cancel.useMutation({
    onSuccess: () => {
      utils.orders.list.invalidate();
      setCancelling(null);
    },
  });
  const claimPrinted = trpc.orders.markTicketsPrinted.useMutation();

  const orders = useMemo(() => query.data ?? [], [query.data]);

  // ── New delivery orders: beep + auto-print the kitchen ticket ──
  // The claim mutation makes exactly one board screen print each ticket, even
  // with the till and the kitchen display polling at the same time.
  const seenRef = useRef<Set<number> | null>(null);
  useEffect(() => {
    if (!query.data) return;
    const partnerActive = query.data.filter(
      (o) =>
        o.source !== "pos" &&
        (ACTIVE_ORDER_STATUSES as readonly string[]).includes(o.status),
    );
    if (seenRef.current === null) {
      // First load: everything already on the board is "seen" — no beep storm.
      seenRef.current = new Set(partnerActive.map((o) => o.id));
      return;
    }
    const seen = seenRef.current;
    const fresh = partnerActive.filter((o) => !seen.has(o.id));
    if (fresh.length === 0) return;
    for (const o of fresh) seen.add(o.id);
    beepNewOrder();
    const unprinted = fresh.filter((o) => o.kitchenPrintedAt === null);
    if (
      unprinted.length > 0 &&
      printerSettings.autoPrint &&
      direct !== null &&
      !claimPrinted.isPending
    ) {
      claimPrinted.mutate(
        { orderIds: unprinted.map((o) => o.id) },
        {
          onSuccess: (r) => {
            for (const id of r.claimed) {
              const order = unprinted.find((o) => o.id === id);
              if (order) void printTicket(order, true);
            }
            if (r.claimed.length > 0) utils.orders.list.invalidate();
          },
        },
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.data]);

  function payOrder(order: BoardOrder) {
    sessionStorage.setItem(
      "rbk.pos.payOrder",
      JSON.stringify({
        orderId: order.id,
        orderNo: order.orderNo,
        label: order.label,
        lines: order.lines.map((l) => ({
          itemId: l.itemId,
          itemName: l.itemName,
          unitPriceKobo: l.unitPriceKobo,
          quantity: l.quantity,
          modifiers: l.modifiers.map((m) => ({
            group: m.group,
            option: m.option,
            optionId: m.optionId,
            priceDeltaKobo: m.priceDeltaKobo,
          })),
        })),
      }),
    );
    navigate("/pos");
  }

  async function printTicket(order: BoardOrder, silent = false) {
    try {
      const result = await printerManager.printKitchenTicket({
        orderNo: order.orderNo,
        label: order.label,
        notes: order.notes,
        staffName: order.staffName ?? ORDER_SOURCE_LABEL[order.source],
        placedAt: order.createdAt,
        delivery:
          order.source === "pos"
            ? null
            : {
                source: ORDER_SOURCE_LABEL[order.source],
                customerName: order.customerName,
                customerPhone: order.customerPhone,
                deliveryAddress: order.deliveryAddress,
              },
        lines: order.lines.map((l) => ({
          itemName: l.itemName,
          quantity: l.quantity,
          modifiers: l.modifiers.map((m) => ({ group: m.group, option: m.option })),
        })),
      });
      if (silent) return;
      if (result === "skipped") {
        setPrintHint("Connect a thermal printer (printer menu in the header) to print kitchen tickets.");
      } else {
        setPrintHint(null);
      }
    } catch {
      if (!silent) setPrintHint("Printing failed — check the printer and try again.");
    }
  }

  const boardMode = filter === "active";

  return (
    <div className="royal-scroll flex h-full min-h-0 flex-col overflow-y-auto">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3 border-b border-royal-line px-4 py-4 sm:px-6">
        <div>
          <h1 className="font-display text-2xl text-royal-cream">Orders</h1>
          <p className="mt-0.5 text-[10px] uppercase tracking-[0.25em] text-royal-dim">
            Kitchen tickets · refreshes automatically
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {isManager && (
            <button
              type="button"
              onClick={() => setPartnersOpen(true)}
              title="Delivery partner connections (Glovo / Chowdeck)"
              className="flex items-center gap-2 rounded-full border border-royal-line px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.15em] text-royal-dim transition-colors hover:border-royal-accent hover:text-royal-accent"
            >
              <Plug className="h-4 w-4" strokeWidth={1.75} />
              Partners
            </button>
          )}
          <button
            type="button"
            onClick={() => query.refetch()}
            title="Refresh now"
            className="flex h-10 w-10 items-center justify-center border border-royal-line text-royal-dim transition-colors hover:border-royal-accent hover:text-royal-accent"
          >
            <RefreshCw className={`h-4 w-4 ${query.isFetching ? "animate-spin" : ""}`} strokeWidth={1.75} />
          </button>
          <button
            type="button"
            onClick={() => setNewOpen(true)}
            className="flex items-center gap-2 rounded-full border border-royal-accent bg-royal-accent px-5 py-2.5 text-xs font-semibold uppercase tracking-[0.15em] text-royal-bg transition-colors hover:bg-royal-accent/85"
          >
            <Plus className="h-4 w-4" strokeWidth={2} />
            New order
          </button>
        </div>
      </div>

      {/* Filter chips */}
      <div className="royal-scroll flex gap-2 overflow-x-auto border-b border-royal-line px-4 py-3 sm:px-6">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={`shrink-0 rounded-full border px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.15em] transition-colors ${
              filter === f.key
                ? "border-royal-accent bg-royal-accent text-royal-bg"
                : "border-royal-line text-royal-dim hover:border-royal-accent/60 hover:text-royal-cream"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {printHint && (
        <p className="mx-4 mt-3 flex items-start justify-between gap-3 border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-xs text-amber-300 sm:mx-6">
          <span>{printHint}</span>
          <button type="button" onClick={() => setPrintHint(null)} aria-label="Dismiss">
            <X className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </p>
      )}
      {(advance.error || cancel.error) && (
        <p className="mx-4 mt-3 border border-rose-400/40 bg-rose-400/10 px-3 py-2 text-xs text-rose-300 sm:mx-6">
          {advance.error?.message ?? cancel.error?.message}
        </p>
      )}

      {/* Body */}
      <div className="min-h-0 flex-1 px-4 py-4 sm:px-6">
        {query.isLoading && (
          <p className="py-16 text-center text-sm text-royal-dim">Loading orders…</p>
        )}
        {query.error && (
          <p className="py-16 text-center text-sm text-rose-400">{query.error.message}</p>
        )}
        {query.data && orders.length === 0 && (
          <div className="py-16 text-center">
            <ChefHat className="mx-auto h-10 w-10 text-royal-dim/40" strokeWidth={1.25} />
            <p className="mt-4 text-sm text-royal-dim">
              {boardMode
                ? "No active orders — the kitchen is clear."
                : "No orders match this filter."}
            </p>
          </div>
        )}

        {query.data && boardMode && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            {BOARD_COLUMNS.map((col) => {
              const tickets = orders.filter((o) => o.status === col);
              return (
                <section key={col} className="flex min-h-0 flex-col">
                  <p className="mb-3 flex items-baseline justify-between border-b border-royal-line pb-2">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.3em] text-royal-dim">
                      {ORDER_STATUS_LABEL[col]}
                    </span>
                    <span className="text-xs text-royal-dim/70">{tickets.length}</span>
                  </p>
                  <div className="space-y-3">
                    {tickets.map((o) => (
                      <TicketCard
                        key={o.id}
                        order={o}
                        now={now}
                        isManager={isManager}
                        printerReady={direct !== null}
                        pending={advance.isPending || cancel.isPending}
                        onAdvance={(to) => advance.mutate({ orderId: o.id, to })}
                        onPay={() => payOrder(o)}
                        onPrint={() => printTicket(o)}
                        onCancel={() => setCancelling(o)}
                      />
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        )}

        {query.data && !boardMode && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {orders.map((o) => (
              <TicketCard
                key={o.id}
                order={o}
                now={now}
                isManager={isManager}
                printerReady={direct !== null}
                pending={advance.isPending || cancel.isPending}
                onAdvance={(to) => advance.mutate({ orderId: o.id, to })}
                onPay={() => payOrder(o)}
                onPrint={() => printTicket(o)}
                onCancel={() => setCancelling(o)}
              />
            ))}
          </div>
        )}
      </div>

      {newOpen && (
        <NewOrderModal
          autoPrintTicket={printerSettings.autoPrint && direct !== null}
          onClose={() => setNewOpen(false)}
          onCreated={() => {
            setNewOpen(false);
            utils.orders.list.invalidate();
            setFilter("active");
          }}
        />
      )}

      {partnersOpen && <PartnersModal onClose={() => setPartnersOpen(false)} />}

      {cancelling && (
        <CancelModal
          order={cancelling}
          pending={cancel.isPending}
          error={cancel.error?.message ?? null}
          onConfirm={(reason) =>
            cancel.mutate({ orderId: cancelling.id, reason })
          }
          onClose={() => {
            cancel.reset();
            setCancelling(null);
          }}
        />
      )}
    </div>
  );
}

function TicketCard({
  order,
  now,
  isManager,
  printerReady,
  pending,
  onAdvance,
  onPay,
  onPrint,
  onCancel,
}: {
  order: BoardOrder;
  now: number;
  isManager: boolean;
  printerReady: boolean;
  pending: boolean;
  onAdvance: (to: "preparing" | "ready" | "served") => void;
  onPay: () => void;
  onPrint: () => void;
  onCancel: () => void;
}) {
  const active = (ACTIVE_ORDER_STATUSES as readonly string[]).includes(order.status);
  /** Bill settled, kitchen possibly still working — no second charge. */
  const paid = order.saleId !== null;
  const min = elapsedMinutes(order.createdAt, now);
  const elapsedTone =
    min >= ORDER_ELAPSED_LATE_MIN
      ? "border-rose-400/50 text-rose-300"
      : min >= ORDER_ELAPSED_WARN_MIN
        ? "border-amber-400/50 text-amber-300"
        : "border-royal-line text-royal-dim";
  const next = NEXT_ORDER_STATUS[order.status];

  return (
    <article
      className={`border bg-royal-surface/60 p-4 ${
        active && min >= ORDER_ELAPSED_LATE_MIN
          ? "border-rose-400/50"
          : "border-royal-line"
      }`}
    >
      {/* Top row: order no + source badge + elapsed / status */}
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-semibold text-royal-cream">
          {order.orderNo}
          {order.source !== "pos" && (
            <span
              className={`border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] ${
                order.source === "glovo"
                  ? "border-amber-400/50 text-amber-300"
                  : "border-teal-400/50 text-teal-300"
              }`}
            >
              {ORDER_SOURCE_LABEL[order.source]}
            </span>
          )}
          {paid && active && (
            <span
              data-testid="order-paid-badge"
              title={
                order.receiptNo
                  ? `Paid · receipt ${order.receiptNo} — stays here until served`
                  : "Paid — stays here until served"
              }
              className="border border-emerald-400/50 bg-emerald-400/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-emerald-300"
            >
              Paid
            </span>
          )}
        </p>
        {active ? (
          <span
            className={`flex items-center gap-1 border px-2 py-0.5 text-[10px] font-semibold ${elapsedTone}`}
          >
            <Clock3 className="h-3 w-3" strokeWidth={2} />
            {formatElapsed(min)}
          </span>
        ) : (
          <span
            className={`border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${
              order.status === "completed"
                ? "border-emerald-400/50 text-emerald-300"
                : "border-rose-400/50 text-rose-300"
            }`}
          >
            {ORDER_STATUS_LABEL[order.status]}
            {order.status === "completed" && order.receiptNo
              ? ` · ${order.receiptNo}`
              : ""}
          </span>
        )}
      </div>

      {/* Table / customer */}
      <p className="mt-1 font-display text-xl leading-tight text-royal-cream">
        {order.label}
      </p>

      {/* Delivery details for partner orders */}
      {order.source !== "pos" && (
        <div className="mt-2 space-y-0.5 border border-royal-line/70 bg-royal-surface/40 px-2 py-1.5 text-xs text-royal-dim">
          <p className="flex items-center gap-1.5">
            <Bike className="h-3 w-3 shrink-0" strokeWidth={1.75} />
            <span>
              {ORDER_SOURCE_LABEL[order.source]} delivery
              {order.externalId ? ` · ${order.externalId}` : ""}
            </span>
          </p>
          {order.customerPhone && <p className="pl-[18px]">{order.customerPhone}</p>}
          {order.deliveryAddress && (
            <p className="pl-[18px]">{order.deliveryAddress}</p>
          )}
        </div>
      )}

      {order.notes && (
        <p className="mt-2 border border-amber-400/40 bg-amber-400/10 px-2 py-1 text-xs text-amber-300">
          {order.notes}
        </p>
      )}
      {order.status === "cancelled" && order.cancelReason && (
        <p className="mt-2 border border-rose-400/30 bg-rose-400/10 px-2 py-1 text-xs text-rose-300">
          {order.cancelReason}
        </p>
      )}

      {/* Lines */}
      <ul className="mt-3 space-y-1.5 border-t border-royal-line/60 pt-3">
        {order.lines.map((l, i) => (
          <li key={i}>
            <p className="flex items-baseline justify-between gap-2 text-sm text-royal-cream">
              <span>
                <span className="font-semibold">{l.quantity}×</span> {l.itemName}
              </span>
              <span className="shrink-0 text-xs text-royal-dim">
                {formatNaira(l.lineTotalKobo)}
              </span>
            </p>
            {l.modifiers.map((m, j) => (
              <p key={j} className="pl-5 text-xs text-royal-dim">
                · {m.option}
              </p>
            ))}
          </li>
        ))}
      </ul>

      <p className="mt-3 flex items-baseline justify-between border-t border-royal-line/60 pt-2 text-xs text-royal-dim">
        <span>
          {order.staffName ?? ORDER_SOURCE_LABEL[order.source]} ·{" "}
          {new Date(order.createdAt).toLocaleTimeString("en-NG", {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
        <span className="text-sm font-semibold text-royal-cream">
          {formatNaira(order.totalKobo)}
        </span>
      </p>

      {/* Actions */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {next && (
          <button
            type="button"
            disabled={pending}
            onClick={() => onAdvance(next.to)}
            className="flex-1 rounded-full border border-royal-accent bg-royal-accent px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-royal-bg transition-colors hover:bg-royal-accent/85 disabled:opacity-40"
          >
            {next.action}
          </button>
        )}
        {active && !paid && (
          <button
            type="button"
            onClick={onPay}
            title="Take payment in the POS"
            className="flex items-center gap-1.5 rounded-full border border-emerald-400/60 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-emerald-300 transition-colors hover:bg-emerald-400/10"
          >
            <CircleDollarSign className="h-3.5 w-3.5" strokeWidth={1.75} />
            Pay
          </button>
        )}
        <button
          type="button"
          onClick={onPrint}
          title={printerReady ? "Print kitchen ticket" : "Connect a printer to print tickets"}
          className="flex h-8 w-8 items-center justify-center border border-royal-line text-royal-dim transition-colors hover:border-royal-accent hover:text-royal-accent"
        >
          <Printer className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
        {isManager && !paid && order.status !== "completed" && order.status !== "cancelled" && (
          <button
            type="button"
            onClick={onCancel}
            title="Cancel order"
            className="flex h-8 w-8 items-center justify-center border border-royal-line text-royal-dim transition-colors hover:border-rose-400 hover:text-rose-400"
          >
            <X className="h-4 w-4" strokeWidth={1.75} />
          </button>
        )}
      </div>
    </article>
  );
}

function CancelModal({
  order,
  pending,
  error,
  onConfirm,
  onClose,
}: {
  order: BoardOrder;
  pending: boolean;
  error: string | null;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative w-full max-w-md border border-royal-line bg-royal-bg p-6">
        <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-rose-400">
          Cancel order
        </p>
        <p className="mt-2 font-display text-xl text-royal-cream">
          {order.orderNo} — {order.label}
        </p>
        <p className="mt-1 text-xs text-royal-dim">
          The kitchen stops working on this ticket. This can't be undone.
        </p>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          placeholder="Reason (e.g. customer left, entered by mistake)"
          className="mt-4 w-full border border-royal-line bg-transparent px-3 py-2 text-sm text-royal-cream placeholder:text-royal-dim/50 focus:border-royal-accent focus:outline-none"
        />
        {error && <p className="mt-2 text-xs text-rose-400">{error}</p>}
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-full border border-royal-line py-2.5 text-xs font-semibold uppercase tracking-[0.15em] text-royal-dim transition-colors hover:text-royal-cream"
          >
            Keep order
          </button>
          <button
            type="button"
            disabled={pending || reason.trim().length < 3}
            onClick={() => onConfirm(reason.trim())}
            className="flex-1 rounded-full border border-rose-400 bg-rose-400 py-2.5 text-xs font-semibold uppercase tracking-[0.15em] text-royal-bg transition-colors hover:bg-rose-400/85 disabled:opacity-40"
          >
            {pending ? "Cancelling…" : "Cancel order"}
          </button>
        </div>
      </div>
    </div>
  );
}
