import { useEffect, useState } from "react";
import {
  Clock,
  Loader2,
  LogIn,
  LogOut,
  TimerOff,
  Timer,
  Users,
} from "lucide-react";
import { trpc } from "@/providers/trpc";
import { formatMinutes } from "@contracts/attendance";
import { usePerms } from "@/lib/perms";

const inputCls =
  "mt-2 w-full border-b border-royal-line bg-transparent py-2.5 text-sm text-royal-cream placeholder:text-royal-dim/50 transition-colors focus:border-royal-accent focus:outline-none";

function fmtTime(iso: string) {
  return new Date(iso).toLocaleString("en-NG", {
    hour: "numeric",
    minute: "2-digit",
  });
}

function fmtDay(iso: string) {
  return new Date(iso).toLocaleString("en-NG", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function sameDay(a: string, b: string) {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

type RangeKey = "today" | "yesterday" | "week";

export default function AttendancePage() {
  const utils = trpc.useUtils();
  const { has } = usePerms();
  const canSeeTeam = has("attendanceTeam", "view");

  const status = trpc.attendance.status.useQuery(undefined, {
    refetchInterval: 30_000,
  });
  const mine = trpc.attendance.mine.useQuery({ limit: 30 });

  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [, setTick] = useState(0);

  // Re-render every 30s so the elapsed timer moves.
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  function refresh() {
    status.refetch();
    mine.refetch();
    if (canSeeTeam) utils.attendance.report.invalidate();
  }

  const clockIn = trpc.attendance.clockIn.useMutation({
    onSuccess: () => {
      setNote("");
      setError(null);
      refresh();
    },
    onError: (err) => setError(err.message),
  });
  const clockOut = trpc.attendance.clockOut.useMutation({
    onSuccess: () => {
      setNote("");
      setError(null);
      refresh();
    },
    onError: (err) => setError(err.message),
  });

  const open = status.data?.open ?? null;
  const busy = clockIn.isPending || clockOut.isPending;
  const elapsedMin = open
    ? Math.max(0, Math.round((Date.now() - +new Date(open.clockInAt)) / 60000))
    : 0;

  return (
    <div className="space-y-8">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-royal-accent">
          Attendance
        </p>
        <p className="mt-2 max-w-lg text-sm leading-6 text-royal-dim">
          Clock in when your shift starts and out when it ends. Times are
          stamped by the server — managers see the whole team below.
        </p>
      </div>

      {error && (
        <p className="border-l-2 border-rose-500/70 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
          {error}
        </p>
      )}

      {/* Clock card */}
      <div className="border border-royal-line bg-royal-panel px-6 py-6 text-center">
        {status.isLoading ? (
          <div className="flex items-center justify-center gap-2 text-sm text-royal-dim">
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} /> Loading…
          </div>
        ) : open ? (
          <>
            <p className="flex items-center justify-center gap-2 text-[10px] font-semibold uppercase tracking-[0.3em] text-emerald-400">
              <Timer className="h-4 w-4" strokeWidth={2} /> Clocked in
            </p>
            <p className="mt-2 font-display text-4xl text-royal-cream" data-testid="elapsed">
              {formatMinutes(elapsedMin)}
            </p>
            <p className="mt-1 text-xs text-royal-dim">
              since {fmtTime(open.clockInAt)} · {fmtDay(open.clockInAt)}
            </p>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Note for clock-out (optional)"
              maxLength={255}
              className={`${inputCls} mx-auto mt-4 max-w-sm text-center`}
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => clockOut.mutate({ note: note.trim() || undefined })}
              className="mt-4 inline-flex items-center gap-2 rounded-full bg-royal-accent px-8 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-royal-bg transition-opacity disabled:opacity-50"
              data-testid="clock-out"
            >
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
              ) : (
                <LogOut className="h-3.5 w-3.5" strokeWidth={2} />
              )}
              Clock out
            </button>
          </>
        ) : (
          <>
            <p className="flex items-center justify-center gap-2 text-[10px] font-semibold uppercase tracking-[0.3em] text-royal-dim">
              <TimerOff className="h-4 w-4" strokeWidth={2} /> Not clocked in
            </p>
            <p className="mt-2 text-sm text-royal-dim">
              Tap below when your shift starts.
            </p>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Note for clock-in (optional)"
              maxLength={255}
              className={`${inputCls} mx-auto mt-4 max-w-sm text-center`}
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => clockIn.mutate({ note: note.trim() || undefined })}
              className="mt-4 inline-flex items-center gap-2 rounded-full bg-royal-accent px-8 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-royal-bg transition-opacity disabled:opacity-50"
              data-testid="clock-in"
            >
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
              ) : (
                <LogIn className="h-3.5 w-3.5" strokeWidth={2} />
              )}
              Clock in
            </button>
          </>
        )}
      </div>

      {/* My recent shifts */}
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-royal-accent">
          My recent shifts
        </p>
        {mine.isLoading ? (
          <div className="mt-3 flex items-center gap-2 text-sm text-royal-dim">
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} /> Loading…
          </div>
        ) : (mine.data ?? []).length === 0 ? (
          <p className="mt-3 text-sm text-royal-dim">No shifts recorded yet.</p>
        ) : (
          <div className="mt-3 divide-y divide-royal-line border border-royal-line">
            {(mine.data ?? []).map((r) => (
              <div
                key={r.id}
                className="flex items-center gap-4 px-5 py-3.5"
                data-testid={`my-shift-${r.id}`}
              >
                <Clock className="h-4 w-4 shrink-0 text-royal-accent" strokeWidth={2} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-royal-cream">
                    {fmtDay(r.clockInAt)} · {fmtTime(r.clockInAt)}
                    {" → "}
                    {r.clockOutAt ? fmtTime(r.clockOutAt) : "…"}
                  </p>
                  {(r.clockInNote || r.clockOutNote) && (
                    <p className="mt-0.5 truncate text-[11px] text-royal-dim">
                      {[r.clockInNote, r.clockOutNote].filter(Boolean).join(" · ")}
                    </p>
                  )}
                </div>
                {r.workedMinutes !== null ? (
                  <span className="shrink-0 text-sm font-semibold text-royal-cream">
                    {formatMinutes(r.workedMinutes)}
                  </span>
                ) : (
                  <span className="shrink-0 rounded-full border border-emerald-400/40 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.15em] text-emerald-400">
                    In progress
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {canSeeTeam && <TeamReport />}
    </div>
  );
}

// ---------------------------------------------------------------------------

function TeamReport() {
  const [range, setRange] = useState<RangeKey>("today");
  const [staffId, setStaffId] = useState<number | null>(null);

  const staff = trpc.staff.names.useQuery();

  const bounds = rangeBounds(range);
  const report = trpc.attendance.report.useQuery({
    from: bounds.from?.toISOString(),
    to: bounds.to?.toISOString(),
    staffId: staffId ?? undefined,
  });

  return (
    <div>
      <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.3em] text-royal-accent">
        <Users className="h-4 w-4" strokeWidth={2} /> Team attendance
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {(
          [
            ["today", "Today"],
            ["yesterday", "Yesterday"],
            ["week", "Last 7 days"],
          ] as [RangeKey, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setRange(key)}
            className={`rounded-full border px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.2em] transition-colors ${
              range === key
                ? "border-royal-accent bg-royal-faint/40 text-royal-cream"
                : "border-royal-line text-royal-dim hover:text-royal-cream"
            }`}
          >
            {label}
          </button>
        ))}
        <select
          value={staffId ?? ""}
          onChange={(e) => setStaffId(e.target.value ? Number(e.target.value) : null)}
          className="rounded-full border border-royal-line bg-royal-bgsoft px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-royal-cream focus:border-royal-accent focus:outline-none"
        >
          <option value="">Everyone</option>
          {(staff.data ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      {report.isLoading ? (
        <div className="mt-3 flex items-center gap-2 text-sm text-royal-dim">
          <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} /> Loading…
        </div>
      ) : (
        <>
          {/* Per-staff totals */}
          {(report.data?.totals ?? []).length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {(report.data?.totals ?? []).map((t) => (
                <div
                  key={t.userId}
                  className="border border-royal-line bg-royal-panel px-4 py-3"
                  data-testid={`total-${t.userId}`}
                >
                  <p className="text-xs font-semibold text-royal-cream">
                    {t.staffName}
                    <span className="ml-2 text-[10px] text-royal-dim">{t.staffCode}</span>
                  </p>
                  <p className="mt-1 text-[11px] text-royal-dim">
                    {t.shifts} shift{t.shifts === 1 ? "" : "s"} ·{" "}
                    <span className="font-semibold text-royal-cream">
                      {formatMinutes(t.totalMinutes)}
                    </span>
                    {t.open > 0 && (
                      <span className="ml-1 text-emerald-400">
                        · {t.open} in progress
                      </span>
                    )}
                  </p>
                </div>
              ))}
            </div>
          )}

          {(report.data?.records ?? []).length === 0 ? (
            <p className="mt-4 text-sm text-royal-dim">No shifts in that range.</p>
          ) : (
            <div className="mt-4 divide-y divide-royal-line border border-royal-line">
              {(report.data?.records ?? []).map((r) => (
                <div
                  key={r.id}
                  className="flex items-center gap-4 px-5 py-3.5"
                  data-testid={`team-shift-${r.id}`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-royal-cream">
                      {r.staffName}
                      <span className="ml-2 text-[10px] font-normal text-royal-dim">
                        {r.staffCode}
                      </span>
                    </p>
                    <p className="mt-0.5 text-xs text-royal-dim">
                      {fmtDay(r.clockInAt)} · {fmtTime(r.clockInAt)}
                      {" → "}
                      {r.clockOutAt
                        ? sameDay(r.clockInAt, r.clockOutAt)
                          ? fmtTime(r.clockOutAt)
                          : `${fmtDay(r.clockOutAt)} ${fmtTime(r.clockOutAt)}`
                        : "…"}
                      {(r.clockInNote || r.clockOutNote) &&
                        ` · ${[r.clockInNote, r.clockOutNote].filter(Boolean).join(" · ")}`}
                    </p>
                  </div>
                  {r.workedMinutes !== null ? (
                    <span className="shrink-0 text-sm font-semibold text-royal-cream">
                      {formatMinutes(r.workedMinutes)}
                    </span>
                  ) : (
                    <span className="shrink-0 rounded-full border border-emerald-400/40 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.15em] text-emerald-400">
                      In progress
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function rangeBounds(range: RangeKey): { from?: Date; to?: Date } {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (range === "today") return { from: startOfToday };
  if (range === "yesterday") {
    const from = new Date(startOfToday);
    from.setDate(from.getDate() - 1);
    return { from, to: startOfToday };
  }
  const from = new Date(startOfToday);
  from.setDate(from.getDate() - 6);
  return { from };
}
