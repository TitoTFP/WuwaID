import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useLogin } from "../lib/auth";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const login = useLogin();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const next = params.get("next") ?? "/drafts";

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(password);
      nav(next, { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container-narrow max-w-3xl">
      <section className="grid border-y border-white/15 bg-bg-1/40 md:grid-cols-[minmax(0,1fr)_minmax(18rem,0.8fr)]">
        <div className="p-5 sm:p-8">
          <div className="font-mono text-xs text-accent-gold">Restricted workbench</div>
          <h1 className="mt-2 min-w-0 [overflow-wrap:anywhere] font-serif text-3xl text-slate-100 sm:text-4xl">Editor login</h1>
          <p className="mt-3 max-w-md text-base leading-relaxed text-slate-400">
            Editors can approve or reject draft edits. Anonymous contributors do not need to log in.
          </p>
        </div>
        <form onSubmit={onSubmit} className="space-y-4 border-t border-white/10 bg-bg-2/40 p-5 md:border-l md:border-t-0 sm:p-8" aria-busy={busy}>
          <label className="block space-y-2 text-xs font-medium text-slate-300" htmlFor="editor-password">
            <span>Editor password</span>
            <input
              id="editor-password"
              type="password"
              autoFocus
              autoComplete="current-password"
              className="input"
              placeholder="Enter password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
              aria-invalid={!!error || undefined}
              aria-describedby="login-error"
            />
          </label>
          <div
            id="login-error"
            role={error ? "alert" : undefined}
            aria-live="polite"
            className={[
              "min-h-11 border border-transparent p-2 text-sm",
              error ? "border-rose-400/40 bg-rose-500/5 text-rose-300" : "",
            ].join(" ")}
          >
            {error ?? <span aria-hidden="true">&nbsp;</span>}
          </div>
          <button type="submit" className="btn btn-active w-full justify-center" disabled={busy || !password}>
            {busy ? "Logging in…" : "Log in"}
          </button>
        </form>
      </section>
    </div>
  );
}
