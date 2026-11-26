import { useState, type FormEvent } from "react";
import { NavLink } from "react-router";
import {
  ArrowRight,
  Landmark,
  Loader2,
  ScrollText,
  UserCog,
} from "lucide-react";
import { trpc } from "@/providers/trpc";
import { DEFAULT_SETTINGS, type BusinessSettings } from "@contracts/settings";

const inputCls =
  "mt-2 w-full border-b border-royal-line bg-transparent py-2.5 text-sm text-royal-cream placeholder:text-royal-dim/50 transition-colors focus:border-royal-accent focus:outline-none";
const labelCls =
  "text-[10px] font-semibold uppercase tracking-[0.25em] text-royal-dim";
const sectionTitle =
  "text-[10px] font-semibold uppercase tracking-[0.3em] text-royal-accent";

/** Live mini-preview of how the receipt header/footer will look. */
function ReceiptPreview({
  name,
  address,
  phone,
  footer,
  showAddress,
}: {
  name: string;
  address: string;
  phone: string;
  footer: string;
  showAddress: boolean;
}) {
  return (
    <div
      data-testid="receipt-preview"
      className="bg-[#fdfbf7] px-4 py-5 font-mono text-[11px] leading-relaxed text-neutral-900"
    >
      <div className="text-center">
        <p className="text-[14px] font-bold tracking-wide">{name || "…"}</p>
        {showAddress && address && (
          <p className="mt-0.5 text-[10px] text-neutral-500">{address}</p>
        )}
        {phone && <p className="text-[10px] text-neutral-500">{phone}</p>}
        <p className="mt-1 text-[10px] text-neutral-500">
          26 Nov 2026, 10:30 AM
        </p>
        <p className="mt-1 text-[11px] font-semibold">Receipt RB-000001</p>
        <p className="text-[10px] text-neutral-500">Served by Cashier</p>
      </div>
      <div className="my-2 border-t border-dashed border-neutral-400" />
      <div className="flex justify-between">
        <span>1× Jollof Rice</span>
        <span className="font-semibold">₦2,500</span>
      </div>
      <div className="my-2 border-t border-dashed border-neutral-400" />
      <div className="flex justify-between text-[12px] font-bold">
        <span>TOTAL</span>
        <span>₦2,500</span>
      </div>
      <div className="my-2 border-t border-dashed border-neutral-400" />
      <p className="text-center text-[10px] text-neutral-500">{footer || "…"}</p>
    </div>
  );
}

const SHORTCUTS = [
  {
    testid: "shortcut-staff",
    to: "/staff",
    icon: UserCog,
    title: "Staff & roles",
    body: "Add staff, set roles and reset PINs.",
  },
  {
    testid: "shortcut-terminals",
    to: "/money",
    icon: Landmark,
    title: "Bank POS terminals",
    body: "Register and manage card terminals on the Money page.",
  },
  {
    testid: "shortcut-activity",
    to: "/activity",
    icon: ScrollText,
    title: "Activity log",
    body: "See every sensitive action — who did what, and when.",
  },
];

export default function SettingsPage() {
  const settingsQuery = trpc.settings.get.useQuery();

  if (!settingsQuery.data) {
    return (
      <div className="mx-auto max-w-4xl">
        <p className={sectionTitle}>Settings · Restaurant</p>
        <p className="mt-6 flex items-center gap-2 text-sm text-royal-dim">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading settings…
        </p>
      </div>
    );
  }
  return <SettingsForm initial={settingsQuery.data} />;
}

function SettingsForm({ initial }: { initial: BusinessSettings }) {
  const utils = trpc.useUtils();
  const updateMutation = trpc.settings.update.useMutation({
    onSuccess: (data) => {
      utils.settings.get.setData(undefined, data);
      setNotice({ kind: "ok", text: "Settings saved. New receipts will use them right away." });
    },
    onError: (err) => setNotice({ kind: "err", text: err.message }),
  });

  const [name, setName] = useState(initial.businessName || DEFAULT_SETTINGS.businessName);
  const [address, setAddress] = useState(initial.businessAddress);
  const [phone, setPhone] = useState(initial.businessPhone);
  const [footer, setFooter] = useState(initial.receiptFooter || DEFAULT_SETTINGS.receiptFooter);
  const [showAddress, setShowAddress] = useState(initial.receiptShowAddress);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setNotice(null);
    updateMutation.mutate({
      businessName: name,
      businessAddress: address,
      businessPhone: phone,
      receiptFooter: footer,
      receiptShowAddress: showAddress,
    });
  }
  return (
    <div className="mx-auto max-w-4xl">
      <p className={sectionTitle}>Settings · Restaurant</p>
      <p className="mt-2 text-sm text-royal-dim">
        Your restaurant profile and how receipts look. These details print on
        every customer receipt.
      </p>

      <form onSubmit={handleSubmit} className="mt-8 grid gap-8 lg:grid-cols-2">
        {/* left: form */}
        <div className="space-y-8">
          <div className="border border-royal-line p-6">
            <p className={sectionTitle}>Restaurant profile</p>
            <label className="mt-6 block">
              <span className={labelCls}>Business name</span>
              <input
                data-testid="settings-business-name"
                className={inputCls}
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={120}
                required
              />
            </label>
            <label className="mt-6 block">
              <span className={labelCls}>Address</span>
              <input
                data-testid="settings-address"
                className={inputCls}
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="12 Admiralty Way, Lekki"
                maxLength={200}
              />
            </label>
            <label className="mt-6 block">
              <span className={labelCls}>Phone</span>
              <input
                data-testid="settings-phone"
                className={inputCls}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="0803 000 0000"
                maxLength={40}
              />
            </label>
          </div>

          <div className="border border-royal-line p-6">
            <p className={sectionTitle}>Receipt layout</p>
            <label className="mt-6 block">
              <span className={labelCls}>Receipt footer message</span>
              <input
                data-testid="settings-footer"
                className={inputCls}
                value={footer}
                onChange={(e) => setFooter(e.target.value)}
                maxLength={120}
              />
            </label>
            <label className="mt-6 flex cursor-pointer items-center gap-3">
              <input
                data-testid="settings-show-address"
                type="checkbox"
                className="h-4 w-4 accent-[#9333EA]"
                checked={showAddress}
                onChange={(e) => setShowAddress(e.target.checked)}
              />
              <span className="text-sm text-royal-cream">
                Show address on receipts
              </span>
            </label>

            {notice && (
              <p
                data-testid="settings-notice"
                className={`mt-6 text-sm ${notice.kind === "ok" ? "text-emerald-400" : "text-red-400"}`}
              >
                {notice.text}
              </p>
            )}
            <button
              data-testid="settings-save"
              type="submit"
              disabled={updateMutation.isPending}
              className="mt-6 flex items-center gap-2 bg-royal-primary px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-royal-accent disabled:opacity-50"
            >
              {updateMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Save settings
            </button>
          </div>
        </div>

        {/* right: live preview */}
        <div>
          <p className={sectionTitle}>Receipt preview</p>
          <div className="mt-4 border border-royal-line">
            <ReceiptPreview
              name={name}
              address={address}
              phone={phone}
              footer={footer}
              showAddress={showAddress}
            />
          </div>
          <p className="mt-3 text-xs text-royal-dim">
            This is exactly how the receipt header and footer will print —
            on paper and on the direct thermal printer.
          </p>
        </div>
      </form>

      {/* management shortcuts */}
      <p className={`${sectionTitle} mt-12`}>More to manage</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        {SHORTCUTS.map((s) => (
          <NavLink
            key={s.testid}
            data-testid={s.testid}
            to={s.to}
            className="group border border-royal-line p-5 transition-colors hover:border-royal-accent"
          >
            <s.icon className="h-5 w-5 text-royal-accent" />
            <p className="mt-3 flex items-center gap-2 text-sm font-semibold text-royal-cream">
              {s.title}
              <ArrowRight className="h-3.5 w-3.5 text-royal-dim transition-transform group-hover:translate-x-0.5" />
            </p>
            <p className="mt-1 text-xs text-royal-dim">{s.body}</p>
          </NavLink>
        ))}
      </div>
    </div>
  );
}
