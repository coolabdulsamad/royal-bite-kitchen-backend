import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { Loader2, Server } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/lib/auth";
import { homePathFor } from "@/lib/nav";
import { usePermissionMap } from "@/lib/perms";
import { getServerUrl, isNativeApp, saveServerUrl } from "@/lib/apiAuth";

export default function Login() {
  const navigate = useNavigate();
  const { status, login } = useAuth();
  const sessionMap = usePermissionMap();
  const [staffId, setStaffId] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const nativeApp = isNativeApp();
  const [serverUrl, setServerUrl] = useState(getServerUrl());
  const [serverOpen, setServerOpen] = useState(nativeApp && !getServerUrl());

  const loginMutation = trpc.auth.login.useMutation();

  // Already signed in → straight to this role's home page.
  useEffect(() => {
    if (status === "authed") navigate(homePathFor(sessionMap), { replace: true });
  }, [status, navigate, sessionMap]);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (nativeApp) {
      const clean = serverUrl.trim();
      if (!clean) {
        setError("Enter the server address first (the link where the app is published).");
        setServerOpen(true);
        return;
      }
      saveServerUrl(/^https?:\/\//i.test(clean) ? clean : `https://${clean}`);
    }
    loginMutation.mutate(
      { identifier: staffId, secret: pin },
      {
        onSuccess: (data) => {
          login(data.token, data.user);
          navigate(homePathFor(data.user.permissions), { replace: true });
        },
        onError: (err) => setError(err.message),
      },
    );
  }

  return (
    <main className="grid min-h-screen bg-royal-bg font-sans text-royal-cream lg:grid-cols-2">
      {/* Brand panel */}
      <div className="relative flex flex-col items-center justify-center overflow-hidden border-b border-royal-line bg-royal-bgsoft px-8 py-14 lg:border-b-0 lg:border-r">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute left-1/2 top-1/3 h-80 w-80 -translate-x-1/2 -translate-y-1/2 rounded-full bg-royal-primary/15 blur-3xl" />
        </div>
        <div className="relative flex flex-col items-center text-center">
          <img
            src="/logo.jpeg"
            alt="Royal Bite Kitchen logo"
            className="h-24 w-24 rounded-md object-cover shadow-2xl shadow-royal-primary/20"
          />
          <h1 className="mt-8 font-display text-4xl tracking-wide sm:text-5xl">
            ROYAL BITE
          </h1>
          <p className="mt-2 font-display text-2xl tracking-wide text-royal-accent">
            KITCHEN
          </p>
          <div className="mt-6 h-px w-16 bg-royal-line" />
          <p className="mt-6 text-[11px] uppercase tracking-[0.4em] text-royal-dim">
            Restaurant POS &amp; Management
          </p>
        </div>
      </div>

      {/* Sign-in panel */}
      <div className="flex items-center justify-center px-6 py-14">
        <form onSubmit={handleSubmit} className="w-full max-w-sm">
          <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-royal-accent">
            Staff sign in
          </p>
          <h2 className="mt-3 font-display text-3xl">Welcome back</h2>

          <label className="mt-10 block">
            <span className="text-[10px] font-semibold uppercase tracking-[0.25em] text-royal-dim">
              Staff ID or username
            </span>
            <input
              type="text"
              value={staffId}
              onChange={(event) => setStaffId(event.target.value)}
              autoComplete="username"
              placeholder="e.g. RB-101"
              required
              className="mt-2 w-full border-b border-royal-line bg-transparent py-2.5 text-base text-royal-cream placeholder:text-royal-dim/50 transition-colors duration-150 focus:border-royal-accent focus:outline-none"
            />
          </label>

          <label className="mt-8 block">
            <span className="text-[10px] font-semibold uppercase tracking-[0.25em] text-royal-dim">
              PIN / password
            </span>
            <input
              type="password"
              value={pin}
              onChange={(event) => setPin(event.target.value)}
              autoComplete="current-password"
              placeholder="••••••"
              required
              className="mt-2 w-full border-b border-royal-line bg-transparent py-2.5 text-base text-royal-cream placeholder:text-royal-dim/50 transition-colors duration-150 focus:border-royal-accent focus:outline-none"
            />
          </label>

          {nativeApp && (
            <div className="mt-8">
              <button
                type="button"
                onClick={() => setServerOpen((o) => !o)}
                className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.25em] text-royal-dim transition-colors hover:text-royal-accent"
              >
                <Server className="h-3.5 w-3.5" strokeWidth={1.75} />
                Server {serverUrl ? `· ${serverUrl.replace(/^https?:\/\//, "")}` : "(not set)"}
              </button>
              {serverOpen && (
                <label className="mt-3 block">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.25em] text-royal-dim">
                    Server address
                  </span>
                  <input
                    type="text"
                    value={serverUrl}
                    onChange={(event) => {
                      setServerUrl(event.target.value);
                      saveServerUrl(
                        /^https?:\/\//i.test(event.target.value.trim())
                          ? event.target.value.trim()
                          : `https://${event.target.value.trim()}`,
                      );
                    }}
                    placeholder="https://your-published-app-link"
                    className="mt-2 w-full border-b border-royal-line bg-transparent py-2.5 text-base text-royal-cream placeholder:text-royal-dim/50 transition-colors duration-150 focus:border-royal-accent focus:outline-none"
                  />
                  <span className="mt-1 block text-[10px] text-royal-dim/70">
                    The link where Royal Bite is published — enter it once, it stays on this device.
                  </span>
                </label>
              )}
            </div>
          )}

          {error && (
            <p className="mt-6 border-l-2 border-rose-500/70 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loginMutation.isPending}
            className="mt-10 flex h-12 w-full items-center justify-center gap-2 rounded-full border border-royal-accent text-sm font-semibold uppercase tracking-[0.2em] text-royal-accent transition-colors duration-150 hover:bg-royal-accent hover:text-royal-bg disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loginMutation.isPending && (
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
            )}
            {loginMutation.isPending ? "Signing in…" : "Enter"}
          </button>

          <p className="mt-6 text-center text-[11px] leading-5 text-royal-dim/80">
            Staff accounts are created by a manager or admin.
            <br />
            Forgotten your PIN? Ask an admin to reset it from the Staff page.
          </p>
        </form>
      </div>
    </main>
  );
}
