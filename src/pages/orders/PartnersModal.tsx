import { useState } from "react";
import { Check, Copy, KeyRound, Plus, Power, RefreshCw, X } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { usePerms } from "@/lib/perms";
import { PARTNER_LABEL, type PartnerProvider } from "@contracts/partners";

/**
 * Delivery-partner connections (manager+). Create a connection → the webhook
 * URL + secret token are shown; paste both into the Glovo / Chowdeck
 * dashboard. The token is only ever displayed once, right after create or
 * rotate — it is never returned by the list endpoint.
 */
export function PartnersModal({ onClose }: { onClose: () => void }) {
  const { has } = usePerms();
  const canManage = has("partners", "manage");
  const utils = trpc.useUtils();
  const list = trpc.partners.list.useQuery();
  const [provider, setProvider] = useState<PartnerProvider>("glovo");
  const [name, setName] = useState("");
  const [storeRef, setStoreRef] = useState("");
  /** New-connection commission, as a percent string ("20" = 20%). */
  const [commissionPct, setCommissionPct] = useState("0");
  const [error, setError] = useState<string | null>(null);
  /** Freshly minted token — shown once, then gone forever. */
  const [reveal, setReveal] = useState<{ name: string; token: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const create = trpc.partners.create.useMutation({
    onSuccess: (r) => {
      setReveal({ name: r.name, token: r.token });
      setName("");
      setStoreRef("");
      setCommissionPct("0");
      setError(null);
      utils.partners.list.invalidate();
    },
    onError: (e) => setError(e.message),
  });
  const update = trpc.partners.update.useMutation({
    onSuccess: () => utils.partners.list.invalidate(),
    onError: (e) => setError(e.message),
  });
  const rotate = trpc.partners.rotateToken.useMutation({
    onSuccess: (r, v) => {
      const conn = list.data?.find((c) => c.id === v.id);
      setReveal({ name: conn?.name ?? "Connection", token: r.token });
      setError(null);
    },
    onError: (e) => setError(e.message),
  });

  async function copy(text: string, tag: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(tag);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* clipboard blocked — user copies manually */
    }
  }

  const webhookUrl = (p: PartnerProvider) =>
    `${window.location.origin}/api/webhooks/${p}`;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="royal-scroll relative max-h-[85vh] w-full max-w-2xl overflow-y-auto border border-royal-line bg-royal-bg p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-royal-accent">
              Delivery partners
            </p>
            <p className="mt-1 font-display text-xl text-royal-cream">
              Glovo &amp; Chowdeck connections
            </p>
            <p className="mt-1 text-xs text-royal-dim">
              Orders from connected partners land on the kitchen board
              automatically, priced exactly as the customer paid.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-9 w-9 items-center justify-center border border-royal-line text-royal-dim hover:text-royal-cream"
          >
            <X className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>

        {/* New connection */}
        {canManage && (
        <div className="mt-5 border border-royal-line p-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-royal-dim">
            New connection
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {(["glovo", "chowdeck"] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setProvider(p)}
                className={`rounded-full border px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.15em] transition-colors ${
                  provider === p
                    ? "border-royal-accent bg-royal-accent text-royal-bg"
                    : "border-royal-line text-royal-dim hover:text-royal-cream"
                }`}
              >
                {PARTNER_LABEL[p]}
              </button>
            ))}
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Connection name (e.g. Glovo — Lekki)"
              maxLength={64}
              className="min-w-48 flex-1 border border-royal-line bg-transparent px-3 py-1.5 text-sm text-royal-cream placeholder:text-royal-dim/50 focus:border-royal-accent focus:outline-none"
            />
            <input
              value={storeRef}
              onChange={(e) => setStoreRef(e.target.value)}
              placeholder="Store ref (optional)"
              maxLength={64}
              className="w-36 border border-royal-line bg-transparent px-3 py-1.5 text-sm text-royal-cream placeholder:text-royal-dim/50 focus:border-royal-accent focus:outline-none"
            />
            <label className="flex items-center gap-1.5 border border-royal-line px-3 py-1.5 text-xs text-royal-dim">
              Commission
              <input
                data-testid="partner-commission"
                type="number"
                min={0}
                max={50}
                step={0.5}
                value={commissionPct}
                onChange={(e) => setCommissionPct(e.target.value)}
                className="w-16 bg-transparent text-royal-cream focus:outline-none"
              />
              %
            </label>
            <button
              type="button"
              disabled={create.isPending || name.trim().length < 2}
              onClick={() =>
                create.mutate({
                  provider,
                  name: name.trim(),
                  storeRef: storeRef.trim() || undefined,
                  commissionBps: Math.round((Number(commissionPct) || 0) * 100),
                })
              }
              className="flex items-center gap-1.5 rounded-full border border-royal-accent bg-royal-accent px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.15em] text-royal-bg transition-colors hover:bg-royal-accent/85 disabled:opacity-40"
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={2} />
              Create
            </button>
          </div>
        </div>
        )}

        {/* One-time token reveal */}
        {reveal && (
          <div className="mt-4 border border-emerald-400/50 bg-emerald-400/10 p-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-emerald-300">
              Save this token now — it won't be shown again
            </p>
            <p className="mt-1 text-xs text-emerald-200/80">
              {reveal.name}: paste the webhook URL and this token into the
              partner dashboard (header <code>x-rbk-webhook-token</code>).
            </p>
            <div className="mt-2 flex items-center gap-2">
              <code className="flex-1 select-all break-all border border-emerald-400/30 bg-royal-bg px-3 py-2 text-xs text-emerald-200">
                {reveal.token}
              </code>
              <button
                type="button"
                onClick={() => copy(reveal.token, "token")}
                title="Copy token"
                className="flex h-9 w-9 shrink-0 items-center justify-center border border-emerald-400/50 text-emerald-300 hover:bg-emerald-400/10"
              >
                {copied === "token" ? (
                  <Check className="h-4 w-4" strokeWidth={2} />
                ) : (
                  <Copy className="h-4 w-4" strokeWidth={1.75} />
                )}
              </button>
            </div>
          </div>
        )}

        {error && (
          <p className="mt-4 border border-rose-400/40 bg-rose-400/10 px-3 py-2 text-xs text-rose-300">
            {error}
          </p>
        )}

        {/* Existing connections */}
        <div className="mt-5 space-y-3">
          {list.isLoading && (
            <p className="py-6 text-center text-sm text-royal-dim">Loading…</p>
          )}
          {list.data?.length === 0 && (
            <p className="py-6 text-center text-sm text-royal-dim">
              No connections yet — create one above to start receiving orders.
            </p>
          )}
          {list.data?.map((c) => (
            <div key={c.id} className="border border-royal-line p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${
                    c.provider === "glovo"
                      ? "border-amber-400/50 text-amber-300"
                      : "border-teal-400/50 text-teal-300"
                  }`}
                >
                  {PARTNER_LABEL[c.provider]}
                </span>
                <p className="font-semibold text-royal-cream">{c.name}</p>
                {c.storeRef && (
                  <span className="text-xs text-royal-dim">· {c.storeRef}</span>
                )}
                <span
                  className={`ml-auto text-[10px] font-semibold uppercase tracking-[0.12em] ${
                    c.active ? "text-emerald-300" : "text-rose-300"
                  }`}
                >
                  {c.active ? "Active" : "Disabled"}
                </span>
              </div>
              <p className="mt-1 text-xs text-royal-dim">
                {c.lastOrderAt
                  ? `Last order ${new Date(c.lastOrderAt).toLocaleString("en-NG")}`
                  : "No orders received yet"}
              </p>
              {canManage ? (
                <CommissionEditor
                  connectionId={c.id}
                  commissionBps={c.commissionBps}
                  pending={update.isPending}
                  onSave={(bps) => update.mutate({ id: c.id, commissionBps: bps })}
                />
              ) : (
                <p className="mt-1 text-[11px] text-royal-dim">
                  Commission {(c.commissionBps / 100).toFixed(1)}%
                </p>
              )}
              <div className="mt-2 flex items-center gap-2">
                <code className="flex-1 select-all break-all border border-royal-line bg-royal-surface/60 px-3 py-1.5 text-[11px] text-royal-dim">
                  {webhookUrl(c.provider)}
                </code>
                <button
                  type="button"
                  onClick={() => copy(webhookUrl(c.provider), `url-${c.id}`)}
                  title="Copy webhook URL"
                  className="flex h-8 w-8 shrink-0 items-center justify-center border border-royal-line text-royal-dim hover:border-royal-accent hover:text-royal-accent"
                >
                  {copied === `url-${c.id}` ? (
                    <Check className="h-3.5 w-3.5" strokeWidth={2} />
                  ) : (
                    <Copy className="h-3.5 w-3.5" strokeWidth={1.75} />
                  )}
                </button>
                {canManage && (
                <button
                  type="button"
                  title={c.active ? "Disable connection" : "Enable connection"}
                  disabled={update.isPending}
                  onClick={() => update.mutate({ id: c.id, active: !c.active })}
                  className={`flex h-8 w-8 items-center justify-center border transition-colors ${
                    c.active
                      ? "border-royal-line text-royal-dim hover:border-rose-400 hover:text-rose-400"
                      : "border-royal-line text-royal-dim hover:border-emerald-400 hover:text-emerald-300"
                  }`}
                >
                  <Power className="h-3.5 w-3.5" strokeWidth={1.75} />
                </button>
                )}
                {canManage && (
                <button
                  type="button"
                  title="Rotate token (old token stops working)"
                  disabled={rotate.isPending}
                  onClick={() => rotate.mutate({ id: c.id })}
                  className="flex h-8 w-8 items-center justify-center border border-royal-line text-royal-dim hover:border-royal-accent hover:text-royal-accent"
                >
                  {rotate.isPending ? (
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} />
                  ) : (
                    <KeyRound className="h-3.5 w-3.5" strokeWidth={1.75} />
                  )}
                </button>
                )}
              </div>
            </div>
          ))}
        </div>

        <p className="mt-4 border-t border-royal-line pt-3 text-[11px] leading-relaxed text-royal-dim">
          In the partner dashboard, set the webhook URL above and the header{" "}
          <code>x-rbk-webhook-token</code> to the connection token. Prices in
          the webhook are read as naira. Items whose names match your menu
          (same spelling) are linked automatically; others still arrive with
          the partner's name and price.
        </p>
      </div>
    </div>
  );
}

/**
 * Inline commission-rate editor — the partner's cut in percent, converted to
 * basis points for the API (20% → 2000). Saves on Enter/blur when changed.
 */
function CommissionEditor({
  connectionId,
  commissionBps,
  pending,
  onSave,
}: {
  connectionId: number;
  commissionBps: number;
  pending: boolean;
  onSave: (bps: number) => void;
}) {
  const [value, setValue] = useState(String(commissionBps / 100));
  const dirty = Math.round((Number(value) || 0) * 100) !== commissionBps;

  function save() {
    const pct = Number(value);
    if (!Number.isFinite(pct) || pct < 0 || pct > 50) return;
    const bps = Math.round(pct * 100);
    if (bps !== commissionBps) onSave(bps);
  }

  return (
    <p className="mt-2 flex items-center gap-1.5 text-xs text-royal-dim">
      Partner commission
      <input
        data-testid={`commission-input-${connectionId}`}
        type="number"
        min={0}
        max={50}
        step={0.5}
        value={value}
        disabled={pending}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        className="w-16 border border-royal-line bg-transparent px-1.5 py-0.5 text-center text-royal-cream focus:border-royal-accent focus:outline-none disabled:opacity-40"
      />
      %
      {dirty && <span className="text-royal-accent">· Enter to save</span>}
      <span className="text-royal-dim/60">— deducted before each settlement</span>
    </p>
  );
}
