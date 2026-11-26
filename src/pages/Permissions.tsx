import { useMemo, useState } from "react";
import { Check, Loader2, Lock, RotateCcw, ShieldCheck } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { ROLE_LABEL, type StaffRole } from "@contracts/roles";
import type { DomainKey, PermLevel, PermissionDomain } from "@contracts/permissions";

type PendingValue = PermLevel | "default";
type PendingMap = Map<string, PendingValue>;

const cellKey = (role: StaffRole, domain: DomainKey) => `${role}:${domain}`;

const LEVEL_META: Record<PermLevel, { short: string; label: string; cls: string }> = {
  none: { short: "—", label: "Blocked", cls: "text-royal-dim" },
  view: { short: "V", label: "View", cls: "text-amber-300" },
  manage: { short: "M", label: "Manage", cls: "text-emerald-300" },
};

function levelsFor(domain: PermissionDomain): PermLevel[] {
  return [
    "none",
    ...(domain.hasView ? (["view"] as const) : []),
    ...(domain.hasManage ? (["manage"] as const) : []),
  ];
}

function LevelPill({ level }: { level: PermLevel }) {
  const meta = LEVEL_META[level];
  return (
    <span className={`text-[10px] font-semibold uppercase tracking-[0.2em] ${meta.cls}`}>
      {meta.label}
    </span>
  );
}

export default function PermissionsPage() {
  const utils = trpc.useUtils();
  const matrix = trpc.permissions.matrix.useQuery();
  const [pending, setPending] = useState<PendingMap>(new Map());
  const [notice, setNotice] = useState<string | null>(null);

  const save = trpc.permissions.setMatrix.useMutation({
    onSuccess: (data) => {
      setNotice(`Saved ${data.applied} change${data.applied === 1 ? "" : "s"} — staff get the new access within ~30 seconds.`);
      setPending(new Map());
      utils.permissions.matrix.invalidate();
      utils.auth.me.invalidate();
    },
    onError: (err) => setNotice(err.message),
  });

  const data = matrix.data;
  const editableRoles = useMemo(() => new Set(data?.editableRoles ?? []), [data]);
  const editableDomains = useMemo(() => new Set(data?.editableDomains ?? []), [data]);
  const overrideKeys = useMemo(
    () => new Set((data?.overrides ?? []).map((o) => cellKey(o.role, o.domain))),
    [data],
  );

  function queueChange(role: StaffRole, domain: DomainKey, level: PendingValue) {
    setPending((prev) => {
      const next = new Map(prev);
      next.set(cellKey(role, domain), level);
      return next;
    });
    setNotice(null);
  }

  if (matrix.isLoading) {
    return (
      <div className="flex items-center gap-3 py-20 text-royal-dim">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm">Loading permission matrix…</span>
      </div>
    );
  }
  if (!data) {
    return (
      <p className="py-20 text-sm text-red-300">
        Could not load the permission matrix — {matrix.error?.message ?? "unknown error"}.
      </p>
    );
  }

  const roleCols = data.roles;
  const pendingCount = pending.size;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.3em] text-royal-accent">
            <ShieldCheck className="h-3.5 w-3.5" strokeWidth={2} />
            Access control
          </p>
          <h2 className="mt-2 font-display text-3xl text-royal-cream">Permission matrix</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-royal-dim">
            Decide what each role can see and do. <span className="text-amber-300">View</span> opens
            the page read-only; <span className="text-emerald-300">Manage</span> allows creating,
            editing and voiding. Amber dots mark cells you have customised away from the factory
            default. The Super Admin row and this page's own permission are fixed, so the matrix
            can never lock the admins out.
          </p>
        </div>
        {pendingCount > 0 && (
          <div className="flex items-center gap-3 border border-royal-line bg-royal-panel px-4 py-3" data-testid="perm-pending-bar">
            <span className="text-xs text-royal-dim">
              {pendingCount} unsaved change{pendingCount === 1 ? "" : "s"}
            </span>
            <button
              type="button"
              data-testid="perm-discard"
              onClick={() => setPending(new Map())}
              className="border border-royal-line px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-royal-dim transition-colors hover:text-royal-cream"
            >
              Discard
            </button>
            <button
              type="button"
              data-testid="perm-save"
              disabled={save.isPending}
              onClick={() =>
                save.mutate({
                  changes: [...pending.entries()].map(([key, level]) => {
                    const [role, domain] = key.split(":") as [StaffRole, DomainKey];
                    return { role, domain, level };
                  }),
                })
              }
              className="flex items-center gap-2 bg-royal-accent px-4 py-1.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-royal-bg transition-opacity disabled:opacity-50"
            >
              {save.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
              )}
              Apply changes
            </button>
          </div>
        )}
      </div>

      {notice && (
        <p className="border border-royal-line bg-royal-panel px-4 py-3 text-sm text-royal-cream" data-testid="perm-notice">
          {notice}
        </p>
      )}

      {/* Matrix table */}
      <div className="overflow-x-auto border border-royal-line" data-testid="perm-matrix">
        <table className="w-full min-w-[1100px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-royal-line bg-royal-bgsoft">
              <th className="sticky left-0 z-10 bg-royal-bgsoft px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-[0.25em] text-royal-dim">
                Area of the app
              </th>
              {roleCols.map(({ role }) => (
                <th
                  key={role}
                  className="px-3 py-3 text-center text-[10px] font-semibold uppercase tracking-[0.2em] text-royal-dim"
                >
                  <span className="inline-flex items-center gap-1.5">
                    {ROLE_LABEL[role]}
                    {(!editableRoles.has(role) || role === "superadmin") && (
                      <Lock className="h-3 w-3 text-royal-dim/60" strokeWidth={2} />
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-royal-line/60">
            {data.domains.map((domain) => {
              const rowEditable = editableDomains.has(domain.key);
              return (
                <tr key={domain.key} className="transition-colors hover:bg-royal-faint/20">
                  <td className="sticky left-0 z-10 bg-royal-bg px-4 py-3">
                    <p className="text-sm font-semibold text-royal-cream">{domain.label}</p>
                    <p className="mt-0.5 max-w-[260px] text-xs leading-4 text-royal-dim/80">
                      {domain.description}
                      {!rowEditable && (
                        <span className="ml-1 inline-flex items-center gap-1 text-royal-dim/60">
                          <Lock className="inline h-2.5 w-2.5" /> fixed
                        </span>
                      )}
                    </p>
                  </td>
                  {roleCols.map(({ role, defaults, effective }) => {
                    const key = cellKey(role, domain.key);
                    const pendingVal = pending.get(key);
                    const effLevel = (effective[domain.key] ?? "none") as PermLevel;
                    const defLevel = (defaults[domain.key] ?? "none") as PermLevel;
                    const shown: PermLevel =
                      pendingVal === undefined
                        ? effLevel
                        : pendingVal === "default"
                          ? defLevel
                          : pendingVal;
                    const customised = effective[domain.key] !== defaults[domain.key];
                    const editable =
                      rowEditable && editableRoles.has(role) && role !== "superadmin";

                    return (
                      <td key={role} className="px-3 py-3 text-center" data-testid={`perm-cell-${role}-${domain.key}`}>
                        {editable ? (
                          <div className="inline-flex flex-col items-center gap-1.5">
                            <div className="inline-flex border border-royal-line">
                              {levelsFor(domain).map((lv) => (
                                <button
                                  key={lv}
                                  type="button"
                                  title={LEVEL_META[lv].label}
                                  data-testid={`perm-opt-${role}-${domain.key}-${lv}`}
                                  onClick={() => queueChange(role, domain.key, lv)}
                                  className={`px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.15em] transition-colors ${
                                    shown === lv
                                      ? lv === "none"
                                        ? "bg-royal-line/60 text-royal-cream"
                                        : lv === "view"
                                          ? "bg-amber-400/20 text-amber-300"
                                          : "bg-emerald-400/20 text-emerald-300"
                                      : "text-royal-dim/60 hover:text-royal-cream"
                                  }`}
                                >
                                  {LEVEL_META[lv].short}
                                </button>
                              ))}
                            </div>
                            <span className="flex h-4 items-center gap-1.5">
                              {customised && (
                                <span
                                  className="inline-block h-1.5 w-1.5 rounded-full bg-amber-400"
                                  title={`Customised — factory default is ${LEVEL_META[defLevel].label}`}
                                  data-testid={`perm-custom-${role}-${domain.key}`}
                                />
                              )}
                              {overrideKeys.has(key) && (
                                <button
                                  type="button"
                                  title="Reset to factory default"
                                  data-testid={`perm-reset-${role}-${domain.key}`}
                                  onClick={() => queueChange(role, domain.key, "default")}
                                  className="text-royal-dim/60 transition-colors hover:text-royal-accent"
                                >
                                  <RotateCcw className="h-3 w-3" strokeWidth={2} />
                                </button>
                              )}
                              {pendingVal !== undefined && (
                                <span className="text-[9px] uppercase tracking-[0.15em] text-royal-accent">
                                  unsaved
                                </span>
                              )}
                            </span>
                          </div>
                        ) : (
                          <LevelPill level={effLevel} />
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-6 text-xs text-royal-dim">
        <span className="flex items-center gap-2">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-400" /> Customised away
          from factory default
        </span>
        <span>
          <span className="text-royal-dim">—</span> blocked ·{" "}
          <span className="text-amber-300">V</span> view ·{" "}
          <span className="text-emerald-300">M</span> manage
        </span>
        <span className="flex items-center gap-1.5">
          <Lock className="h-3 w-3" /> Locked rows/columns can never be edited
        </span>
      </div>
    </div>
  );
}
