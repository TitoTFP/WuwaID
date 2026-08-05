import {
  Link,
  NavLink,
  Outlet,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import LangSwitcher from "./LangSwitcher";
import { api } from "../lib/api";
import { canEdit, useMe } from "../lib/auth";
import { getAuthorLabel } from "../lib/session";
import ImportModal from "./editor/ImportModal";

export default function Layout() {
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const nav = useNavigate();
  const [showImport, setShowImport] = useState(false);

  useEffect(() => setQ(params.get("q") ?? ""), [params]);

  const meQ = useMe();
  const role = meQ.data?.role ?? "anon";
  const authorLabel = getAuthorLabel();
  const draftsQ = useQuery({
    queryKey: ["drafts", "header", canEdit(role) ? "editor" : authorLabel],
    queryFn: () => api.listDrafts(canEdit(role) ? null : authorLabel),
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
    <div className="app-shell min-h-screen flex flex-col">
      <header className="sn-masthead">
        <div className="sn-masthead__inner container-wide">
          <Link to="/" className="sn-brand" aria-label="WuwaID Quests home">
            <span className="sn-brand__mark" aria-hidden="true">W</span>
            <span className="sn-brand__lockup">
              <span className="sn-brand__name">wuwaid</span>
              <span className="sn-brand__meta">resonance atlas</span>
            </span>
          </Link>

          <nav className="sn-browse" aria-label="Browse archive">
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

          <form
            onSubmit={onSubmit}
            className="sn-search"
            role="search"
            aria-label="Search quests and grouped texts"
          >
            <label htmlFor="global-search" className="sr-only">
              Search quests and grouped texts
            </label>
            <input
              id="global-search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search quests and grouped texts…"
              className="input sn-search__input"
            />
            <button type="submit" className="sn-search__submit" aria-label="Search">
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <circle cx="11" cy="11" r="7" />
                <path d="M21 21l-4.3-4.3" />
              </svg>
            </button>
          </form>

          <div className="sn-tools">
            <NavLink
              to="/drafts"
              className={({ isActive }) => `btn ${isActive ? "btn-active" : ""}`}
              aria-label={`Drafts (${pendingCount} pending)`}
            >
              <span>Drafts</span>
              {pendingCount > 0 && (
                <span className="sn-count">
                  {pendingCount > 99 ? "99+" : pendingCount}
                </span>
              )}
            </NavLink>

            {canEdit(role) && (
              <>
                <NavLink to="/versions" className={({ isActive }) => `btn ${isActive ? "btn-active" : ""}`}>
                  Versions
                </NavLink>
                <button
                  type="button"
                  onClick={() => setShowImport(true)}
                  className="btn"
                  title="Import from SQLite"
                >
                  <svg aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  <span>Import</span>
                </button>
              </>
            )}
            {role === "admin" && (
              <NavLink to="/admin/logs" className={({ isActive }) => `btn ${isActive ? "btn-active" : ""}`}>
                Logs
              </NavLink>
            )}

            <LangSwitcher />
          </div>

          <details
            className="sn-menu"
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              event.currentTarget.open = false;
              event.currentTarget.querySelector("summary")?.focus();
            }}
            onClick={(event) => {
              if ((event.target as HTMLElement).closest("a, button")) {
                event.currentTarget.open = false;
              }
            }}
          >
            <summary className="sn-menu__toggle">
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 7h16M4 12h16M4 17h16" />
              </svg>
              <span>Menu</span>
            </summary>
            <div className="sn-menu__panel">
              <nav className="sn-menu__nav" aria-label="Mobile navigation">
                <NavLink to="/" end className={({ isActive }) => `sn-menu__link ${isActive ? "is-active" : ""}`}>
                  Home
                </NavLink>
                <NavLink to="/side-quests" className={({ isActive }) => `sn-menu__link ${isActive ? "is-active" : ""}`}>
                  Side Quests
                </NavLink>
                <NavLink to="/categories" className={({ isActive }) => `sn-menu__link ${isActive ? "is-active" : ""}`}>
                  Grouped Texts
                </NavLink>
                <NavLink
                  to="/drafts"
                  className={({ isActive }) => `sn-menu__link ${isActive ? "is-active" : ""}`}
                  aria-label={`Drafts (${pendingCount} pending)`}
                >
                  <span>Drafts</span>
                  {pendingCount > 0 && (
                    <span className="sn-count">
                      {pendingCount > 99 ? "99+" : pendingCount}
                    </span>
                  )}
                </NavLink>
                {canEdit(role) && (
                  <>
                    <NavLink to="/versions" className={({ isActive }) => `sn-menu__link ${isActive ? "is-active" : ""}`}>
                      Versions
                    </NavLink>
                    <button
                      type="button"
                      onClick={() => setShowImport(true)}
                      className="sn-menu__link"
                    >
                      Import
                    </button>
                  </>
                )}
                {role === "admin" && (
                  <NavLink to="/admin/logs" className={({ isActive }) => `sn-menu__link ${isActive ? "is-active" : ""}`}>
                    Logs
                  </NavLink>
                )}
              </nav>
              <div className="sn-menu__language">
                <span>Language</span>
                <LangSwitcher />
              </div>
            </div>
          </details>
        </div>
      </header>

      <main className="flex-1 py-6">
        <Outlet />
      </main>

      <footer className="sn-footer">
        <span>Data source</span>
        <span aria-hidden="true">·</span>
        <a className="link" href="https://github.com/TitoTFP/WuwaID" target="_blank" rel="noreferrer">
          WuwaID export pipeline
        </a>
      </footer>

      {showImport && (
        <ImportModal onClose={() => setShowImport(false)} />
      )}
    </div>
  );
}
