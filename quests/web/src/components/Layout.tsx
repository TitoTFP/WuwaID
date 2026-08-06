import { Link, Outlet, useNavigate, useSearchParams } from "react-router-dom";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import GlobalSearch from "./GlobalSearch";
import ShellNavigation from "./ShellNavigation";
import { api } from "../lib/api";
import { canEdit, useMe } from "../lib/auth";
import { getAuthorLabel } from "../lib/session";
import ImportModal from "./editor/ImportModal";

export default function Layout() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const [showImport, setShowImport] = useState(false);

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

  function onSubmit(query: string, language: string) {
    nav(
      `/search?q=${encodeURIComponent(query)}&lang=${encodeURIComponent(language)}`,
    );
  }

  return (
    <div className="app-shell min-h-screen flex flex-col">
      <header className="sn-masthead">
        <div className="sn-masthead__inner container-wide">
          <Link to="/" className="sn-brand" aria-label="WuwaID Quests home">
            <span className="sn-brand__mark" aria-hidden="true">W</span>
            <span className="sn-brand__lockup">
              <span className="sn-brand__name">wuwaid</span>
              <span className="sn-brand__meta">quest archive · wuthering waves</span>
            </span>
          </Link>

          <GlobalSearch
            initialQuery={params.get("q") ?? ""}
            language={params.get("lang") ?? "en"}
            onSubmit={onSubmit}
          />

          <ShellNavigation
            role={role}
            pendingCount={pendingCount}
            onImportRequest={() => setShowImport(true)}
          />
        </div>
      </header>

      <main className="sn-main flex-1 py-6">
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
