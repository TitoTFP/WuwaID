import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAdminLogin } from "../lib/auth";

export default function AdminLoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const login = useAdminLogin();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const next = params.get("next") ?? "/admin/logs";

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(password);
      nav(next, { replace: true });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "admin login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container-narrow max-w-3xl">
      <section className="grid border-y border-white/15 bg-bg-1/40 md:grid-cols-[minmax(0,1fr)_minmax(18rem,0.8fr)]">
        <div className="p-5 sm:p-8">
          <div className="font-mono text-xs text-accent-signal">Restricted operations</div>
          <h1 className="mt-2 font-serif text-3xl text-slate-100 sm:text-4xl">Admin login</h1>
          <p className="mt-3 max-w-md text-base leading-relaxed text-slate-400">
            Log uploads and active-player data are available only to administrators.
          </p>
        </div>
        <form onSubmit={onSubmit} className="space-y-4 border-t border-white/10 bg-bg-2/40 p-5 md:border-l md:border-t-0 sm:p-8" aria-busy={busy}>
          <label className="block space-y-2 text-xs font-medium text-slate-300" htmlFor="admin-password">
            <span>Admin password</span>
            <input
              id="admin-password"
              type="password"
              autoFocus
              autoComplete="current-password"
              className="input"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={busy}
              aria-invalid={!!error || undefined}
              aria-describedby="admin-login-error"
            />
          </label>
          <div id="admin-login-error" role={error ? "alert" : undefined} aria-live="polite" className={error ? "border border-rose-400/40 bg-rose-500/5 p-2 text-sm text-rose-300" : "min-h-11 p-2 text-sm"}>
            {error ?? <span aria-hidden="true">&nbsp;</span>}
          </div>
          <button type="submit" className="btn btn-active w-full justify-center" disabled={busy || !password}>
            {busy ? "Logging in…" : "Log in as admin"}
          </button>
        </form>
      </section>
    </div>
  );
}
