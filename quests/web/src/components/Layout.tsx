import { Link, NavLink, Outlet, useNavigate, useSearchParams } from "react-router-dom";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import LangSwitcher from "./LangSwitcher";
import { api } from "../lib/api";
import { useMe } from "../lib/auth";
import { getAuthorLabel } from "../lib/session";

export default function Layout() {
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const nav = useNavigate();

  useEffect(() => setQ(params.get("q") ?? ""), [params]);

  const meQ = useMe();
  const role = meQ.data?.role ?? "anon";
  const authorLabel = getAuthorLabel();
  const draftsQ = useQuery({
    queryKey: ["drafts", "header", role === "editor" ? "editor" : authorLabel],
    queryFn: () => api.listDrafts(role === "editor" ? null : authorLabel),
    enabled: !!meQ.data,
    staleTime: 15_000,
  });
  const pendingCount = (draftsQ.data ?? []).filter((d) => d.status === "pending").length;

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = q.trim();
    if (!trimmed) return;
    const lang = params.get("lang") ?? "en";
    setParams({ q: trimmed, lang });
    nav(`/search?q=${encodeURIComponent(trimmed)}&lang=${lang}`);
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-30 border-b border-white/5 bg-bg-0/80 backdrop-blur-md">
        <div className="container-narrow flex items-center gap-3 py-3">
          <Link to="/" className="flex items-center gap-2 group">
            <span className="grid h-8 w-8 place-items-center rounded-md bg-bg-2 font-serif text-lg text-accent-gold ring-1 ring-white/5 group-hover:ring-accent-gold/40">
              W
            </span>
            <span className="hidden sm:inline text-sm font-semibold tracking-wide text-slate-200">
              wuwaid-quests
            </span>
          </Link>

          <nav className="hidden md:flex items-center gap-1 text-sm">
            <NavLink to="/" end className={({ isActive }) => `btn ${isActive ? "btn-active" : ""}`}>
              Home
            </NavLink>
            <NavLink to="/side-quests" className={({ isActive }) => `btn ${isActive ? "btn-active" : ""}`}>
              Side Quests
            </NavLink>
            <NavLink to="/categories" className={({ isActive }) => `btn ${isActive ? "btn-active" : ""}`}>
              Grouped Texts
            </NavLink>
          </nav>

          <form onSubmit={onSubmit} className="flex-1 max-w-xl">
            <div className="relative">
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search dialogue…"
                className="input pl-9"
              />
              <svg
                className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"
                viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              >
                <circle cx="11" cy="11" r="7" />
                <path d="M21 21l-4.3-4.3" />
              </svg>
            </div>
          </form>

          <NavLink
            to="/drafts"
            className={({ isActive }) =>
              `btn relative ${isActive ? "btn-active" : ""}`
            }
            title="Drafts"
            aria-label={`Drafts (${pendingCount} pending)`}
          >
            <span>Drafts</span>
            {pendingCount > 0 && (
              <span className="ml-1 inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-accent-gold/30 px-1.5 text-[10px] font-semibold text-accent-gold">
                {pendingCount > 99 ? "99+" : pendingCount}
              </span>
            )}
          </NavLink>

          <LangSwitcher />
        </div>
      </header>

      <main className="flex-1 py-6">
        <Outlet />
      </main>

      <footer className="border-t border-white/5 py-6 text-center text-xs text-slate-500">
        Data sourced from{" "}
        <a className="link" href="https://github.com/TitoTFP/WuwaID" target="_blank" rel="noreferrer">
          WuwaID/export_text_grouped.py
        </a>{" "}
        · 504 quests · 71,469 lines · 4 languages
      </footer>
    </div>
  );
}
