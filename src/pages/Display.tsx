import { useEffect, useState } from "react";
import { Check, Maximize2 } from "lucide-react";
import { formatNaira } from "@contracts/money";
import type { CustomerDisplayState } from "@contracts/display";
import { subscribeDisplay } from "@/lib/customerDisplay";

function Header() {
  return (
    <div className="flex items-center gap-4 border-b border-royal-line/60 px-8 py-5">
      <img src="/logo.jpeg" alt="" className="h-11 w-11 rounded-sm object-cover" />
      <div>
        <p className="font-display text-xl leading-none tracking-wide text-royal-cream">
          ROYAL BITE
        </p>
        <p className="mt-1 text-[10px] uppercase tracking-[0.35em] text-royal-dim">
          Kitchen
        </p>
      </div>
    </div>
  );
}

function IdleScreen() {
  const [time, setTime] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-10 text-center">
      <img
        src="/logo.jpeg"
        alt="Royal Bite Kitchen"
        className="h-32 w-32 rounded-2xl object-cover shadow-[0_0_80px_rgba(147,51,234,0.35)]"
      />
      <h1 className="mt-10 font-display text-6xl text-royal-cream">Welcome</h1>
      <p className="mt-4 text-sm uppercase tracking-[0.4em] text-royal-dim">
        Fresh · Fast · Royal
      </p>
      <p className="mt-12 font-display text-3xl text-royal-accent/80">
        {time.toLocaleTimeString("en-NG", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: true,
        })}
      </p>
    </div>
  );
}

function BuildingScreen({
  state,
}: {
  state: Extract<CustomerDisplayState, { kind: "building" }>;
}) {
  const itemCount = state.lines.reduce((sum, l) => sum + l.quantity, 0);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <p className="px-8 pb-3 pt-6 text-[11px] font-semibold uppercase tracking-[0.35em] text-royal-dim">
        Your order
        {state.customerName && (
          <span className="text-royal-accent"> · {state.customerName}</span>
        )}
      </p>
      <div className="royal-scroll min-h-0 flex-1 overflow-y-auto px-8">
        {state.lines.length === 0 ? (
          <p className="py-16 text-center text-lg text-royal-dim">
            Your items will appear here…
          </p>
        ) : (
          <ul className="divide-y divide-royal-line/50">
            {state.lines.map((line, i) => (
              <li key={i} className="flex items-baseline justify-between gap-6 py-4">
                <div className="min-w-0">
                  <p className="text-xl leading-snug text-royal-cream">
                    <span className="mr-2 font-semibold text-royal-accent">
                      {line.quantity}×
                    </span>
                    {line.name}
                  </p>
                  {line.modifiers.map((m, j) => (
                    <p key={j} className="mt-1 text-sm text-royal-dim">
                      · {m}
                    </p>
                  ))}
                </div>
                <p className="shrink-0 text-xl font-semibold text-royal-cream">
                  {formatNaira(line.lineTotalKobo)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="border-t border-royal-line/60 bg-royal-bgsoft/70 px-8 py-6">
        <div className="flex items-baseline justify-between">
          <p className="text-xs uppercase tracking-[0.3em] text-royal-dim">
            {itemCount} item{itemCount === 1 ? "" : "s"}
            {state.discountKobo > 0 &&
              ` · discount −${formatNaira(state.discountKobo)}`}
          </p>
          <p className="text-xs uppercase tracking-[0.3em] text-royal-dim">Total</p>
        </div>
        <p className="mt-2 text-right font-display text-6xl text-royal-cream">
          {formatNaira(state.totalKobo)}
        </p>
      </div>
    </div>
  );
}

function PaymentScreen({
  state,
}: {
  state: Extract<CustomerDisplayState, { kind: "payment" }>;
}) {
  const remainingKobo = Math.max(0, state.totalKobo - state.paidKobo);
  const changeKobo = Math.max(0, state.paidKobo - state.totalKobo);
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-10 text-center">
      {state.customerName && (
        <p
          className="mb-6 rounded-full border border-royal-accent/40 bg-royal-faint/30 px-6 py-2 text-sm uppercase tracking-[0.25em] text-royal-accent"
          data-testid="display-customer"
        >
          Serving {state.customerName}
        </p>
      )}
      <p className="text-[11px] font-semibold uppercase tracking-[0.35em] text-royal-dim">
        Amount due
      </p>
      <p className="mt-3 font-display text-7xl text-royal-cream">
        {formatNaira(state.totalKobo)}
      </p>

      {state.payments.length > 0 && (
        <div className="mt-10 w-full max-w-md space-y-2">
          {state.payments.map((p, i) => (
            <div
              key={i}
              className="flex items-center justify-between border-b border-royal-line/50 pb-2 text-lg"
            >
              <span className="text-royal-dim">{p.label}</span>
              <span className="text-royal-cream">{formatNaira(p.amountKobo)}</span>
            </div>
          ))}
        </div>
      )}

      {state.paidKobo > 0 &&
        (remainingKobo > 0 ? (
          <p className="mt-8 text-2xl text-amber-400">
            Remaining: {formatNaira(remainingKobo)}
          </p>
        ) : (
          changeKobo > 0 && (
            <p className="mt-8 text-2xl text-emerald-400">
              Your change: {formatNaira(changeKobo)}
            </p>
          )
        ))}
    </div>
  );
}

function CompleteScreen({
  state,
}: {
  state: Extract<CustomerDisplayState, { kind: "complete" }>;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-10 text-center">
      <span className="flex h-20 w-20 items-center justify-center rounded-full border-2 border-emerald-400/70 bg-emerald-400/10">
        <Check className="h-10 w-10 text-emerald-400" strokeWidth={2} />
      </span>
      <h1 className="mt-8 font-display text-6xl text-royal-cream">
        Thank you{state.customerName ? `, ${state.customerName}` : ""}!
      </h1>
      <p className="mt-3 text-sm uppercase tracking-[0.35em] text-royal-dim">
        Receipt {state.receiptNo}
      </p>
      {state.changeKobo > 0 && (
        <div className="mt-10">
          <p className="text-[11px] uppercase tracking-[0.35em] text-royal-dim">
            Your change
          </p>
          <p className="mt-2 font-display text-6xl text-emerald-400">
            {formatNaira(state.changeKobo)}
          </p>
        </div>
      )}
      <p className="mt-10 text-lg text-royal-dim">
        Please collect your receipt — enjoy your meal.
      </p>
    </div>
  );
}

export default function DisplayPage() {
  const [state, setState] = useState<CustomerDisplayState>({ kind: "idle" });

  useEffect(() => subscribeDisplay(setState), []);

  function goFullscreen() {
    if (document.fullscreenElement) return;
    document.documentElement.requestFullscreen?.().catch(() => {});
  }

  return (
    <div
      className="flex min-h-screen flex-col bg-royal-bg text-royal-cream"
      style={{
        backgroundImage:
          "radial-gradient(ellipse 80% 60% at 50% -10%, rgba(147,51,234,0.18), transparent), radial-gradient(ellipse 60% 50% at 50% 110%, rgba(147,51,234,0.12), transparent)",
      }}
    >
      <Header />

      <div key={state.kind} className="flex min-h-0 flex-1 flex-col animate-[fadeIn_0.35s_ease-out]">
        {state.kind === "idle" && <IdleScreen />}
        {state.kind === "building" && <BuildingScreen state={state} />}
        {state.kind === "payment" && <PaymentScreen state={state} />}
        {state.kind === "complete" && <CompleteScreen state={state} />}
      </div>

      <button
        type="button"
        onClick={goFullscreen}
        className="fixed right-4 top-[86px] flex items-center gap-2 rounded-full border border-royal-line/60 bg-royal-bgsoft/80 px-4 py-2 text-[10px] uppercase tracking-[0.2em] text-royal-dim backdrop-blur transition-colors hover:text-royal-cream"
      >
        <Maximize2 className="h-3.5 w-3.5" strokeWidth={1.75} />
        Fullscreen
      </button>

      <style>{`@keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }`}</style>
    </div>
  );
}
