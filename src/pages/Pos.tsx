import { useEffect, useMemo, useRef, useState } from "react";
import { CloudOff, Minus, MonitorPlay, Plus, Search, ShoppingCart, Trash2, X } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { printerManager, usePrinter } from "@/lib/printing/printer";
import { createDisplayPublisher } from "@/lib/customerDisplay";
import {
  buildOfflineSaleResult,
  isOnline,
  outboxStore,
  useFullMenuWithCache,
  useOnlineStatus,
  type OfflineSalePayload,
} from "@/lib/offline";
import { api } from "@/lib/offline/api";
import { PAYMENT_METHOD_LABEL } from "@contracts/payments";
import { formatNaira, nairaToKobo } from "@contracts/money";
import { DISCOUNT_LIMIT_PERCENT } from "@contracts/payments";
import {
  cartSubtotalKobo,
  discountKoboFor,
  lineTotalKobo,
  lineUnitKobo,
  makeCartKey,
  type CartLine,
  type CartModifier,
  type Discount,
} from "@/lib/cart";
import type { MenuItemWithGroups } from "@/lib/menuTypes";
import { ModifierPicker } from "./pos/ModifierPicker";
import {
  CheckoutModal,
  type CheckoutSubmitInput,
  type CompletedSaleResult,
} from "./pos/PaymentModal";
import { ReceiptView } from "./pos/ReceiptView";

export default function PosPage() {
  const { user } = useAuth();
  const { settings: printerSettings } = usePrinter();
  const menu = useFullMenuWithCache();
  const online = useOnlineStatus();

  const [activeCategory, setActiveCategory] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [discount, setDiscount] = useState<Discount | null>(null);
  const [picking, setPicking] = useState<MenuItemWithGroups | null>(null);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [receipt, setReceipt] = useState<CompletedSaleResult | null>(null);
  const [mobileCartOpen, setMobileCartOpen] = useState(false);
  const [orderHandoff, setOrderHandoff] = useState<{
    orderId: number;
    orderNo: string;
    label: string;
  } | null>(null);
  const [paymentProgress, setPaymentProgress] = useState<{
    paidKobo: number;
    payments: Array<{ label: string; amountKobo: number }>;
    customerName?: string | null;
  } | null>(null);

  // ── Order-payment handoff from the orders board (Pay button) ──
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("rbk.pos.payOrder");
      if (!raw) return;
      sessionStorage.removeItem("rbk.pos.payOrder");
      const payload = JSON.parse(raw) as {
        orderId: number;
        orderNo: string;
        label: string;
        lines: Array<{
          /** null for partner items with no menu match — display only (id 0),
           *  the server charges the order's stored lines anyway. */
          itemId: number | null;
          itemName: string;
          unitPriceKobo: number;
          quantity: number;
          modifiers: CartModifier[];
        }>;
      };
      setCart(
        payload.lines.map((l, i) => ({
          key:
            l.itemId !== null
              ? makeCartKey(l.itemId, l.modifiers.map((m) => m.optionId))
              : `orderline:${payload.orderId}:${i}`,
          itemId: l.itemId ?? 0,
          name: l.itemName,
          unitPriceKobo: l.unitPriceKobo,
          modifiers: l.modifiers,
          quantity: l.quantity,
        })),
      );
      setOrderHandoff({
        orderId: payload.orderId,
        orderNo: payload.orderNo,
        label: payload.label,
      });
    } catch {
      // corrupted handoff — ignore and start a normal sale
    }
  }, []);

  // ── Customer display publisher ──
  const displayRef = useRef<ReturnType<typeof createDisplayPublisher> | null>(null);
  function display() {
    if (!displayRef.current) displayRef.current = createDisplayPublisher();
    return displayRef.current;
  }
  useEffect(() => {
    return () => {
      displayRef.current?.close();
      displayRef.current = null; // StrictMode remount creates a fresh channel
    };
  }, []);

  const subtotalKobo = useMemo(() => cartSubtotalKobo(cart), [cart]);
  const discountKobo = useMemo(
    () => discountKoboFor(discount, subtotalKobo),
    [discount, subtotalKobo],
  );
  const totalKobo = subtotalKobo - discountKobo;
  const itemCount = cart.reduce((sum, l) => sum + l.quantity, 0);

  // ── Customer display: mirror cart / payment / completion ──
  useEffect(() => {
    if (checkoutOpen || receipt) return; // payment & complete states take over
    if (cart.length === 0) {
      display().publish({ kind: "idle" });
      return;
    }
    display().publish({
      kind: "building",
      lines: cart.map((l) => ({
        name: l.name,
        quantity: l.quantity,
        modifiers: l.modifiers.map((m) =>
          m.priceDeltaKobo > 0
            ? `${m.option} +${formatNaira(m.priceDeltaKobo)}`
            : m.option,
        ),
        lineTotalKobo: lineTotalKobo(l),
      })),
      subtotalKobo,
      discountKobo,
      totalKobo,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart, subtotalKobo, discountKobo, totalKobo, checkoutOpen, receipt]);

  useEffect(() => {
    if (!checkoutOpen) return;
    display().publish({
      kind: "payment",
      totalKobo,
      paidKobo: paymentProgress?.paidKobo ?? 0,
      payments: paymentProgress?.payments ?? [],
      customerName: paymentProgress?.customerName ?? null,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkoutOpen, paymentProgress, totalKobo]);

  const categories = menu.data ?? [];
  const visibleCategories = useMemo(() => {
    const term = search.trim().toLowerCase();
    return categories
      .filter((c) => (activeCategory === null ? true : c.id === activeCategory))
      .map((c) => ({
        ...c,
        items: c.items.filter(
          (i) =>
            i.available &&
            (term === "" || i.name.toLowerCase().includes(term)),
        ),
      }))
      .filter((c) => c.items.length > 0);
  }, [categories, activeCategory, search]);

  function addToCart(
    item: MenuItemWithGroups,
    modifiers: CartModifier[],
    quantity: number,
  ) {
    const optionIds = modifiers.map((m) => m.optionId);
    const key = makeCartKey(item.id, optionIds);
    setCart((prev) => {
      const existing = prev.find((l) => l.key === key);
      if (existing) {
        return prev.map((l) =>
          l.key === key
            ? { ...l, quantity: Math.min(99, l.quantity + quantity) }
            : l,
        );
      }
      return [
        ...prev,
        {
          key,
          itemId: item.id,
          name: item.name,
          unitPriceKobo: item.priceKobo,
          modifiers,
          quantity,
        },
      ];
    });
  }

  function tapItem(item: MenuItemWithGroups) {
    if (item.modifierGroups.length > 0) {
      setPicking(item);
    } else {
      addToCart(item, [], 1);
    }
  }

  function setQuantity(key: string, quantity: number) {
    setCart((prev) =>
      quantity <= 0
        ? prev.filter((l) => l.key !== key)
        : prev.map((l) =>
            l.key === key ? { ...l, quantity: Math.min(99, quantity) } : l,
          ),
    );
  }

  function resetSale() {
    setCart([]);
    setDiscount(null);
    setCheckoutOpen(false);
    setMobileCartOpen(false);
    setPaymentProgress(null);
    setOrderHandoff(null);
  }

  /**
   * Online: post to the server. Offline (or if the network drops mid-save):
   * queue in the outbox with an idempotency key and build a local receipt.
   */
  async function submitSale(input: CheckoutSubmitInput): Promise<CompletedSaleResult> {
    const clientRef = crypto.randomUUID();
    const payload: OfflineSalePayload = {
      // Paying an order: the server charges the order's stored lines, so the
      // cart payload is irrelevant — and unmapped partner lines (itemId 0)
      // would fail validation if sent.
      items: orderHandoff ? [] : input.items,
      discount: input.discount,
      payments: input.payments,
      saleDate: input.saleDate,
      clientRef,
      orderId: orderHandoff?.orderId,
      customerId: input.customerId,
    };

    if (isOnline()) {
      try {
        const sale = await api.sales.completeSale.mutate(payload);
        return sale as CompletedSaleResult;
      } catch (err) {
        // Business-rule errors (validation, permissions) must surface, not queue.
        const message = err instanceof Error ? err.message : "";
        const networkish = /fetch|network|timeout|abort|unreachable/i.test(message);
        if (!networkish) throw err;
        // fall through to offline queue
      }
    }

    const localReceiptNo = await outboxStore.enqueue(payload, totalKobo);
    const paymentsKobo = input.payments.map((p) => ({
      method: p.method,
      amountKobo: nairaToKobo(p.amount),
      reference: p.reference ?? null,
    }));
    const paidKobo = paymentsKobo.reduce((s, p) => s + p.amountKobo, 0);
    return buildOfflineSaleResult({
      localReceiptNo,
      cashierName: user?.name ?? "Staff",
      lines: cart.map((l) => ({
        itemName: l.name,
        quantity: l.quantity,
        modifiers: l.modifiers.map((m) => ({
          group: m.group,
          option: m.option,
          priceDeltaKobo: m.priceDeltaKobo,
        })),
        lineTotalKobo: lineTotalKobo(l),
      })),
      subtotalKobo,
      discountKobo,
      totalKobo,
      payments: paymentsKobo,
      changeKobo: Math.max(0, paidKobo - totalKobo),
      soldAt: input.saleDate ?? new Date().toISOString(),
    });
  }

  function handleCompleted(sale: CompletedSaleResult) {
    setCheckoutOpen(false);
    setMobileCartOpen(false);
    setReceipt(sale);
    setPaymentProgress(null);
    display().publish({
      kind: "complete",
      receiptNo: sale.receiptNo,
      totalKobo: sale.totalKobo,
      paidKobo: sale.totalKobo + sale.changeKobo,
      changeKobo: sale.changeKobo,
      payments: sale.payments.map((p) => ({
        label: PAYMENT_METHOD_LABEL[p.method],
        amountKobo: p.amountKobo,
      })),
      customerName: sale.customerName ?? null,
    });
    if (printerSettings.autoPrint) {
      // fire-and-forget — the receipt modal offers a retry if this fails
      printerManager.printReceipt(sale).catch(() => {});
    }
  }

  const cartPanel = (
    <CartPanel
      cart={cart}
      setQuantity={setQuantity}
      subtotalKobo={subtotalKobo}
      discountKobo={discountKobo}
      totalKobo={totalKobo}
      discount={discount}
      setDiscount={setDiscount}
      roleLimit={user ? DISCOUNT_LIMIT_PERCENT[user.role] : 0}
      onClear={resetSale}
      onCharge={() => {
        setMobileCartOpen(false);
        setCheckoutOpen(true);
      }}
    />
  );

  return (
    <div className="flex h-full min-h-0 flex-col lg:flex-row">
      {/* Menu side */}
      <div className="flex min-h-0 flex-1 flex-col">
        {/* Category chips + search */}
        <div className="border-b border-royal-line px-4 pb-3 pt-4 sm:px-6">
          <div className="mb-3 flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-royal-dim" strokeWidth={1.75} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search the menu…"
                className="w-full border border-royal-line bg-transparent py-2.5 pl-10 pr-4 text-sm text-royal-cream placeholder:text-royal-dim/50 focus:border-royal-accent focus:outline-none"
              />
            </div>
            <button
              type="button"
              onClick={() =>
                window.open("/display", "rbk-customer-display", "popup")
              }
              title="Open the customer display (move it to the second screen)"
              className="flex shrink-0 items-center gap-2 border border-royal-line px-3 py-2.5 text-[10px] font-semibold uppercase tracking-[0.15em] text-royal-dim transition-colors hover:border-royal-accent hover:text-royal-accent"
            >
              <MonitorPlay className="h-4 w-4" strokeWidth={1.75} />
              <span className="hidden sm:inline">Customer display</span>
            </button>
          </div>
          <div className="royal-scroll flex gap-2 overflow-x-auto pb-1">
            <CategoryChip
              label="All"
              active={activeCategory === null}
              onClick={() => setActiveCategory(null)}
            />
            {categories.map((c) => (
              <CategoryChip
                key={c.id}
                label={c.name}
                active={activeCategory === c.id}
                onClick={() =>
                  setActiveCategory((cur) => (cur === c.id ? null : c.id))
                }
              />
            ))}
          </div>
        </div>

        {/* Order-payment banner */}
        {orderHandoff && (
          <p className="flex items-center justify-between gap-3 border-b border-emerald-400/40 bg-emerald-400/10 px-4 py-2 text-xs text-emerald-300 sm:px-6">
            <span>
              Paying {orderHandoff.orderNo} — {orderHandoff.label}. Completing
              this sale marks the order paid.
            </span>
            <button
              type="button"
              onClick={() => {
                setOrderHandoff(null);
                // Partner lines (itemId 0) only make sense as an order
                // payment — they can't be re-priced as a normal sale.
                setCart((prev) => prev.filter((l) => l.itemId !== 0));
              }}
              className="shrink-0 underline decoration-dotted underline-offset-4 transition-colors hover:text-emerald-200"
            >
              Detach order
            </button>
          </p>
        )}

        {/* Items grid */}
        <div className="royal-scroll min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
          {menu.loading && (
            <p className="py-16 text-center text-sm text-royal-dim">
              Loading the menu…
            </p>
          )}
          {menu.error && (
            <p className="py-16 text-center text-sm text-rose-400">{menu.error}</p>
          )}
          {menu.data && menu.fromCache && (
            <p className="mb-4 flex items-center gap-2 border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-xs text-amber-300">
              <CloudOff className="h-4 w-4 shrink-0" strokeWidth={1.75} />
              Offline — showing the menu saved on this device. Sales will sync when you're back online.
            </p>
          )}
          {menu.data &&
            (visibleCategories.length === 0 ? (
              <p className="py-16 text-center text-sm text-royal-dim">
                Nothing matches — try another search.
              </p>
            ) : (
              visibleCategories.map((c) => (
                <section key={c.id} className="mb-7 last:mb-0">
                  <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.3em] text-royal-dim">
                    {c.name}
                  </p>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                    {c.items.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => tapItem(item)}
                        className="group min-h-24 border border-royal-line bg-royal-surface/60 p-4 text-left transition-colors hover:border-royal-accent/70 hover:bg-royal-faint/40"
                      >
                        <span className="block text-sm leading-snug text-royal-cream">
                          {item.name}
                        </span>
                        <span className="mt-2 block text-sm font-semibold text-royal-accent">
                          {formatNaira(item.priceKobo)}
                        </span>
                        {item.modifierGroups.length > 0 && (
                          <span className="mt-1 block text-[9px] uppercase tracking-[0.2em] text-royal-dim/70">
                            Options
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                </section>
              ))
            ))}
        </div>
      </div>

      {/* Desktop cart */}
      <aside className="hidden w-[380px] shrink-0 border-l border-royal-line bg-royal-bgsoft/50 lg:flex lg:min-h-0 lg:flex-col">
        {cartPanel}
      </aside>

      {/* Mobile cart bar */}
      <div className="border-t border-royal-line bg-royal-bgsoft px-4 py-3 lg:hidden">
        <button
          type="button"
          onClick={() => setMobileCartOpen(true)}
          className="flex w-full items-center justify-between"
        >
          <span className="flex items-center gap-2 text-sm text-royal-cream">
            <ShoppingCart className="h-4 w-4 text-royal-accent" strokeWidth={1.75} />
            {itemCount} item{itemCount === 1 ? "" : "s"}
          </span>
          <span className="font-display text-xl text-royal-cream">
            {formatNaira(totalKobo)}
          </span>
        </button>
      </div>

      {/* Mobile cart sheet */}
      {mobileCartOpen && (
        <div className="fixed inset-0 z-40 flex items-end lg:hidden">
          <div
            className="absolute inset-0 bg-black/70"
            onClick={() => setMobileCartOpen(false)}
          />
          <div className="relative flex max-h-[85vh] w-full flex-col border-t border-royal-line bg-royal-bg">
            <div className="flex justify-end border-b border-royal-line px-4 py-1">
              <button
                type="button"
                onClick={() => setMobileCartOpen(false)}
                className="p-2 text-royal-dim hover:text-royal-cream"
                aria-label="Close cart"
              >
                <X className="h-5 w-5" strokeWidth={1.75} />
              </button>
            </div>
            <div className="flex min-h-0 flex-1 flex-col">{cartPanel}</div>
          </div>
        </div>
      )}

      {/* Modifier picker */}
      {picking && (
        <ModifierPicker
          item={picking}
          onCancel={() => setPicking(null)}
          onAdd={(modifiers, quantity) => {
            addToCart(picking, modifiers, quantity);
            setPicking(null);
          }}
        />
      )}

      {/* Checkout */}
      {checkoutOpen && (
        <CheckoutModal
          totalKobo={totalKobo}
          lines={cart.map((l) => ({
            itemId: l.itemId,
            quantity: l.quantity,
            optionIds: l.modifiers.map((m) => m.optionId),
          }))}
          discount={discount}
          onSubmit={submitSale}
          onCancel={() => setCheckoutOpen(false)}
          onCompleted={handleCompleted}
          onProgress={setPaymentProgress}
          offlineMode={!online}
        />
      )}

      {/* Receipt */}
      {receipt && (
        <ReceiptView
          sale={receipt}
          onNewSale={() => {
            resetSale();
            setReceipt(null);
          }}
          onClose={() => {
            resetSale();
            setReceipt(null);
          }}
        />
      )}
    </div>
  );
}

function CategoryChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-[0.15em] transition-colors ${
        active
          ? "border-royal-accent bg-royal-accent text-royal-bg"
          : "border-royal-line text-royal-dim hover:border-royal-accent/60 hover:text-royal-cream"
      }`}
    >
      {label}
    </button>
  );
}

function CartPanel({
  cart,
  setQuantity,
  subtotalKobo,
  discountKobo,
  totalKobo,
  discount,
  setDiscount,
  roleLimit,
  onClear,
  onCharge,
}: {
  cart: CartLine[];
  setQuantity: (key: string, quantity: number) => void;
  subtotalKobo: number;
  discountKobo: number;
  totalKobo: number;
  discount: Discount | null;
  setDiscount: (d: Discount | null) => void;
  roleLimit: number;
  onClear: () => void;
  onCharge: () => void;
}) {
  const [discountOpen, setDiscountOpen] = useState(false);

  return (
    <>
      <div className="flex items-center justify-between border-b border-royal-line px-5 py-4">
        <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-royal-accent">
          Current sale
        </p>
        {cart.length > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.15em] text-royal-dim transition-colors hover:text-rose-400"
          >
            <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
            Clear
          </button>
        )}
      </div>

      {/* Lines */}
      <div className="royal-scroll min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {cart.length === 0 ? (
          <p className="py-12 text-center text-sm text-royal-dim">
            Tap menu items to start a sale.
          </p>
        ) : (
          <ul className="space-y-4">
            {cart.map((line) => (
              <li key={line.key} className="border-b border-royal-line/60 pb-4 last:border-0">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm leading-snug text-royal-cream">
                      {line.name}
                    </p>
                    {line.modifiers.map((m, i) => (
                      <p key={i} className="mt-0.5 text-xs text-royal-dim">
                        · {m.option}
                        {m.priceDeltaKobo > 0 &&
                          ` +${formatNaira(m.priceDeltaKobo)}`}
                      </p>
                    ))}
                    <p className="mt-1 text-xs text-royal-dim/70">
                      {formatNaira(lineUnitKobo(line))} each
                    </p>
                  </div>
                  <p className="shrink-0 text-sm font-semibold text-royal-cream">
                    {formatNaira(lineTotalKobo(line))}
                  </p>
                </div>
                <div className="mt-2 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setQuantity(line.key, line.quantity - 1)}
                    className="flex h-8 w-8 items-center justify-center border border-royal-line text-royal-cream transition-colors hover:border-royal-accent"
                    aria-label="Decrease"
                  >
                    <Minus className="h-3.5 w-3.5" strokeWidth={1.75} />
                  </button>
                  <span className="w-6 text-center text-sm text-royal-cream">
                    {line.quantity}
                  </span>
                  <button
                    type="button"
                    onClick={() => setQuantity(line.key, line.quantity + 1)}
                    className="flex h-8 w-8 items-center justify-center border border-royal-line text-royal-cream transition-colors hover:border-royal-accent"
                    aria-label="Increase"
                  >
                    <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setQuantity(line.key, 0)}
                    className="ml-auto p-1.5 text-royal-dim transition-colors hover:text-rose-400"
                    aria-label="Remove line"
                  >
                    <X className="h-4 w-4" strokeWidth={1.75} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Totals + discount + charge */}
      <div className="border-t border-royal-line px-5 py-4">
        <div className="space-y-1.5 text-sm">
          <p className="flex justify-between text-royal-dim">
            <span>Subtotal</span>
            <span className="text-royal-cream">{formatNaira(subtotalKobo)}</span>
          </p>
          <p className="flex items-center justify-between text-royal-dim">
            <button
              type="button"
              onClick={() => setDiscountOpen((o) => !o)}
              className="underline decoration-dotted underline-offset-4 transition-colors hover:text-royal-accent"
            >
              Discount
            </button>
            <span className={discountKobo > 0 ? "text-emerald-400" : ""}>
              {discountKobo > 0 ? `-${formatNaira(discountKobo)}` : "—"}
            </span>
          </p>
        </div>

        {discountOpen && (
          <DiscountEditor
            discount={discount}
            setDiscount={setDiscount}
            roleLimit={roleLimit}
          />
        )}

        <p className="mt-3 flex items-baseline justify-between border-t border-royal-line pt-3">
          <span className="text-[10px] font-semibold uppercase tracking-[0.3em] text-royal-dim">
            Total
          </span>
          <span className="font-display text-3xl text-royal-cream">
            {formatNaira(totalKobo)}
          </span>
        </p>

        <button
          type="button"
          disabled={cart.length === 0}
          onClick={onCharge}
          className="mt-4 w-full rounded-full border border-royal-accent bg-royal-accent py-3.5 text-sm font-semibold uppercase tracking-[0.2em] text-royal-bg transition-colors hover:bg-royal-accent/85 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Charge {totalKobo > 0 ? formatNaira(totalKobo) : ""}
        </button>
      </div>
    </>
  );
}

function DiscountEditor({
  discount,
  setDiscount,
  roleLimit,
}: {
  discount: Discount | null;
  setDiscount: (d: Discount | null) => void;
  roleLimit: number;
}) {
  const type = discount?.type ?? "percent";
  const [rawValue, setRawValue] = useState(
    discount && discount.value > 0 ? String(discount.value) : "",
  );

  function apply(nextType: "percent" | "fixed", raw: string) {
    const value = Number.parseFloat(raw);
    if (!Number.isFinite(value) || value <= 0) {
      setDiscount(null);
      return;
    }
    if (nextType === "percent" && value > roleLimit) return; // over role limit — ignore
    setDiscount({ type: nextType, value });
  }

  return (
    <div className="mt-3 border border-royal-line p-3">
      <div className="flex items-center gap-2">
        {(["percent", "fixed"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => {
              setRawValue("");
              setDiscount(null);
              apply(t, "");
            }}
            className={`flex-1 border px-2 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] transition-colors ${
              type === t
                ? "border-royal-accent bg-royal-faint/40 text-royal-cream"
                : "border-royal-line text-royal-dim hover:text-royal-cream"
            }`}
          >
            {t === "percent" ? "% Percent" : "₦ Fixed"}
          </button>
        ))}
        <input
          type="number"
          min="0"
          max={type === "percent" ? roleLimit : undefined}
          step={type === "percent" ? "1" : "0.01"}
          value={rawValue}
          onChange={(e) => {
            setRawValue(e.target.value);
            apply(type, e.target.value);
          }}
          placeholder={type === "percent" ? `0–${roleLimit}` : "Amount in ₦"}
          className="w-28 border-b border-royal-line bg-transparent py-1.5 text-sm text-royal-cream placeholder:text-royal-dim/50 focus:border-royal-accent focus:outline-none"
        />
      </div>
      <p className="mt-2 text-[10px] uppercase tracking-[0.15em] text-royal-dim/70">
        {type === "percent"
          ? `Your role allows up to ${roleLimit}%`
          : "Checked against your role's limit as % of the bill"}
      </p>
    </div>
  );
}
