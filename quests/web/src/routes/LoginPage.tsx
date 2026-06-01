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
    <div className="container-narrow max-w-md">
      <h1 className="font-serif text-2xl text-slate-100">Editor login</h1>
      <p className="mt-1 text-sm text-slate-500">
        Editors can approve or reject draft edits. Anonymous contributors do not need to log in.
      </p>
      <form onSubmit={onSubmit} className="mt-6 space-y-3">
        <input
          type="password"
          autoFocus
          autoComplete="current-password"
          className="input"
          placeholder="Editor password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={busy}
        />
        {error && <div className="text-sm text-rose-400">{error}</div>}
        <button type="submit" className="btn" disabled={busy || !password}>
          {busy ? "Logging in…" : "Log in"}
        </button>
      </form>
    </div>
  );
}
