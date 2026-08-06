import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { useMe } from "../lib/auth";
import { filenameFromDisposition, formatAdminLogBytes } from "../lib/adminLogs";
import HistoryChart from "../components/editor/HistoryChart";
import type { AdminLogUpload } from "../lib/types";

type Tab = "active" | "uploads" | "history";
type HistoryRange = "1h" | "24h" | "7d" | "30d";

function matches(value: string, query: string) {
  return value.toLowerCase().includes(query.trim().toLowerCase());
}

function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function DataState({
  loading,
  error,
  empty,
  onRetry,
}: {
  loading: boolean;
  error: boolean;
  empty: string;
  onRetry: () => void;
}) {
  if (loading) return <p role="status" aria-live="polite" className="p-5 text-sm text-slate-400">Loading…</p>;
  if (error) {
    return (
      <div role="alert" className="flex flex-wrap items-center justify-between gap-3 border border-rose-400/40 bg-rose-500/5 p-3 text-sm text-rose-300">
        <span>Unable to load this data.</span>
        <button type="button" className="btn text-xs" onClick={onRetry}>Retry</button>
      </div>
    );
  }
  return <p role="status" aria-live="polite" className="p-5 text-center text-sm text-slate-400">{empty}</p>;
}

export default function AdminLogsPage() {
  const meQ = useMe();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>("active");
  const [range, setRange] = useState<HistoryRange>("24h");
  const [search, setSearch] = useState("");
  const [selectedUpload, setSelectedUpload] = useState<AdminLogUpload | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const isAdmin = meQ.data?.role === "admin";

  const activeQ = useQuery({
    queryKey: ["admin-logs", "active"],
    queryFn: api.adminLogsActive,
    enabled: isAdmin,
    refetchInterval: 30_000,
  });
  const playersQ = useQuery({
    queryKey: ["admin-logs", "players"],
    queryFn: api.adminLogPlayers,
    enabled: isAdmin && tab === "active",
    refetchInterval: 30_000,
  });
  const uploadsQ = useQuery({
    queryKey: ["admin-logs", "uploads"],
    queryFn: api.adminLogUploads,
    enabled: isAdmin && (tab === "uploads" || selectedUpload !== null),
    refetchInterval: 30_000,
  });
  const historyQ = useQuery({
    queryKey: ["admin-logs", "history", range],
    queryFn: () => api.adminLogHistory(range),
    enabled: isAdmin && tab === "history",
    refetchInterval: 30_000,
  });
  const filesQ = useQuery({
    queryKey: ["admin-logs", "files", selectedUpload?.id],
    queryFn: () => api.adminLogFiles(selectedUpload!.id),
    enabled: isAdmin && !!selectedUpload,
  });
  const contentQ = useQuery({
    queryKey: ["admin-logs", "file", selectedUpload?.id, selectedFile],
    queryFn: () => api.adminLogFile(selectedUpload!.id, selectedFile!),
    enabled: isAdmin && !!selectedUpload && !!selectedFile,
  });

  const players = useMemo(() => (playersQ.data ?? []).filter((player) =>
    [player.client_id, player.launcher_version, player.install_method, player.event]
      .some((value) => matches(value || "", search)),
  ), [playersQ.data, search]);
  const uploads = useMemo(() => (uploadsQ.data ?? []).filter((upload) =>
    [upload.id, upload.app_version, upload.os].some((value) => matches(value || "", search)),
  ), [uploadsQ.data, search]);

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ["admin-logs"] });
  }

  async function download(upload: AdminLogUpload) {
    setDownloadError(null);
    try {
      const { blob, disposition } = await api.downloadAdminLog(upload.id);
      downloadBlob(blob, filenameFromDisposition(disposition, `logs_${upload.id}.zip`));
    } catch (cause) {
      setDownloadError(cause instanceof Error ? cause.message : "Download failed");
    }
  }

  if (meQ.isLoading) return <div className="container-narrow text-slate-400" role="status" aria-live="polite">Checking admin access…</div>;
  if (meQ.isError) {
    return (
      <div className="container-narrow space-y-3" role="alert">
        <p className="text-sm text-rose-300">Unable to check admin access.</p>
        <button type="button" className="btn" onClick={() => void meQ.refetch()}>Retry</button>
      </div>
    );
  }
  if (!isAdmin) {
    return (
      <div className="container-narrow space-y-4">
        <h1 className="font-serif text-3xl text-slate-100">Admin access required</h1>
        <p className="text-slate-400">Sign in with the separate administrator credential to view log operations.</p>
        <Link className="btn btn-active" to="/admin/login?next=/admin/logs">Admin login</Link>
      </div>
    );
  }

  const active = activeQ.data;
  return (
    <div className="container-wide space-y-6 pb-8">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-white/10 pb-5">
        <div>
          <div className="font-mono text-xs text-accent-signal">Restricted operations</div>
          <h1 className="font-serif text-3xl text-slate-100">Log dashboard</h1>
          <p className="mt-1 text-sm text-slate-400">Active players, uploads, history, and log inspection.</p>
        </div>
        <button type="button" className="btn" onClick={refresh} disabled={activeQ.isFetching || playersQ.isFetching || uploadsQ.isFetching || historyQ.isFetching}>
          {activeQ.isFetching || playersQ.isFetching || uploadsQ.isFetching || historyQ.isFetching ? "Refreshing…" : "Refresh"}
        </button>
      </header>

      <section className="grid gap-3 sm:grid-cols-3" aria-busy={activeQ.isFetching}>
        <div className="border border-white/10 bg-bg-2/40 p-4"><div className="text-xs text-slate-500">Active now</div><div className="mt-1 text-2xl text-slate-100">{activeQ.isError ? "Unavailable" : active?.active ?? "—"}</div></div>
        <div className="border border-white/10 bg-bg-2/40 p-4"><div className="text-xs text-slate-500">Window</div><div className="mt-1 text-2xl text-slate-100">{activeQ.isError ? "Unavailable" : active ? `${active.window_seconds}s` : "—"}</div></div>
        <div className="border border-white/10 bg-bg-2/40 p-4"><div className="text-xs text-slate-500">Seen in 30d</div><div className="mt-1 text-2xl text-slate-100">{activeQ.isError ? "Unavailable" : active?.total_30d ?? "—"}</div></div>
      </section>

      <nav className="flex flex-wrap gap-2" aria-label="Log dashboard sections" role="tablist">
        {["active", "uploads", "history"].map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={tab === name}
            aria-controls={`admin-log-panel-${name}`}
            className={`btn ${tab === name ? "btn-active" : ""}`}
            onClick={() => { setTab(name as Tab); setSearch(""); }}
          >
            {name === "active" ? "Active players" : name === "uploads" ? "Uploads" : "History"}
          </button>
        ))}
      </nav>

      {downloadError && <p role="alert" className="border border-rose-400/40 bg-rose-500/5 p-3 text-sm text-rose-300">{downloadError}</p>}

      {tab !== "history" && (
        <label className="block max-w-md">
          <span className="sr-only">{tab === "active" ? "Filter players" : "Filter uploads"}</span>
          <input className="input w-full" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={tab === "active" ? "Filter players…" : "Filter uploads…"} />
        </label>
      )}

      {tab === "active" && (
        <section id="admin-log-panel-active" role="tabpanel" aria-label="Active players" tabIndex={0} className="overflow-x-auto border border-white/10" aria-busy={playersQ.isFetching}>
          {playersQ.isLoading || playersQ.isError || players.length === 0 ? (
            <DataState loading={playersQ.isLoading} error={playersQ.isError} empty="No active players found." onRetry={() => void playersQ.refetch()} />
          ) : (
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Active players</caption>
              <thead className="bg-bg-2 text-xs text-slate-300"><tr><th scope="col" className="p-3">Client</th><th scope="col" className="p-3">Launcher</th><th scope="col" className="p-3">Install</th><th scope="col" className="p-3">Event</th><th scope="col" className="p-3">Last seen</th></tr></thead>
              <tbody>{players.map((player) => <tr key={player.client_id} className="border-t border-white/10"><td className="p-3 font-mono">{player.client_id}</td><td className="p-3">{player.launcher_version || "—"}</td><td className="p-3">{player.install_method || "—"}</td><td className="p-3">{player.event || "—"}</td><td className="p-3">{formatTime(player.last_seen)}</td></tr>)}</tbody>
            </table>
          )}
        </section>
      )}

      {tab === "uploads" && (
        <section id="admin-log-panel-uploads" role="tabpanel" aria-label="Uploads" tabIndex={0} className="overflow-x-auto border border-white/10" aria-busy={uploadsQ.isFetching}>
          {uploadsQ.isLoading || uploadsQ.isError || uploads.length === 0 ? (
            <DataState loading={uploadsQ.isLoading} error={uploadsQ.isError} empty="No uploads found." onRetry={() => void uploadsQ.refetch()} />
          ) : (
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Log uploads</caption>
              <thead className="bg-bg-2 text-xs text-slate-300"><tr><th scope="col" className="p-3">Upload</th><th scope="col" className="p-3">Version</th><th scope="col" className="p-3">OS</th><th scope="col" className="p-3">Files</th><th scope="col" className="p-3">Size</th><th scope="col" className="p-3">Created</th><th scope="col" className="p-3">Actions</th></tr></thead>
              <tbody>{uploads.map((upload) => <tr key={upload.id} className="border-t border-white/10"><td className="p-3 font-mono">{upload.id}</td><td className="p-3">{upload.app_version}</td><td className="p-3">{upload.os}</td><td className="p-3">{upload.file_count}</td><td className="p-3">{formatAdminLogBytes(upload.total_bytes)}</td><td className="p-3">{formatTime(upload.created_at || upload.timestamp)}</td><td className="p-3"><div className="flex flex-wrap gap-2"><button type="button" className="btn" onClick={() => { setSelectedUpload(upload); setSelectedFile(null); }}>Inspect</button><button type="button" className="btn" onClick={() => download(upload)}>Download</button></div></td></tr>)}</tbody>
            </table>
          )}
        </section>
      )}

      {tab === "history" && (
        <section id="admin-log-panel-history" role="tabpanel" aria-label="History" className="space-y-4 border border-white/10 p-4" aria-busy={historyQ.isFetching}>
          <div className="flex flex-wrap gap-2">{(["1h", "24h", "7d", "30d"] as const).map((value) => <button key={value} type="button" className={`btn ${range === value ? "btn-active" : ""}`} aria-pressed={range === value} onClick={() => setRange(value)}>{value}</button>)}</div>
          {historyQ.isLoading || historyQ.isError || !historyQ.data ? (
            <DataState loading={historyQ.isLoading} error={historyQ.isError} empty="No history data found." onRetry={() => void historyQ.refetch()} />
          ) : (
            <>
              <HistoryChart data={historyQ.data} />
              <div className="overflow-x-auto" tabIndex={0} aria-label="Scroll log history table"><table className="w-full text-left text-sm"><caption className="sr-only">Log history</caption><thead className="text-xs text-slate-300"><tr><th scope="col" className="p-2">Time</th><th scope="col" className="p-2">Total</th><th scope="col" className="p-2">Events</th></tr></thead><tbody>{historyQ.data.points.map((point) => <tr key={point.timestamp} className="border-t border-white/10"><td className="p-2">{formatTime(point.timestamp)}</td><td className="p-2">{point.total}</td><td className="p-2">{Object.entries(point.events).map(([event, count]) => `${event}: ${count}`).join(" · ") || "—"}</td></tr>)}</tbody></table></div>
            </>
          )}
        </section>
      )}

      {selectedUpload && (
        <section className="space-y-4 border border-accent-signal/30 bg-bg-2/40 p-4" aria-labelledby="admin-log-inspect-title">
          <header className="flex items-start justify-between gap-3"><div><h2 id="admin-log-inspect-title" className="font-serif text-xl text-slate-100">Inspect {selectedUpload.id}</h2><p className="text-sm text-slate-400">{selectedUpload.os} · {selectedUpload.app_version} · {selectedUpload.file_count} files</p></div><button type="button" className="btn" onClick={() => { setSelectedUpload(null); setSelectedFile(null); }}>Close</button></header>
          <div className="grid gap-4 lg:grid-cols-[minmax(14rem,0.4fr)_minmax(0,1fr)]"><div><h3 className="mb-2 text-sm text-slate-300">Files</h3><div className="space-y-1">{filesQ.isError && <p role="alert" className="text-sm text-rose-300">Unable to load files.</p>}{(filesQ.data?.files ?? []).map((file) => <button key={file.name} type="button" aria-pressed={selectedFile === file.name} className={`block min-h-11 w-full border p-2 text-left text-sm ${selectedFile === file.name ? "border-accent-signal bg-accent-signal/10" : "border-white/10"}`} onClick={() => setSelectedFile(file.name)}>{file.name} <span className="float-right text-slate-500">{formatAdminLogBytes(file.size)}</span></button>)}{filesQ.isLoading && <p role="status" className="text-sm text-slate-500">Loading files…</p>}{!filesQ.isLoading && !filesQ.isError && (filesQ.data?.files ?? []).length === 0 && <p role="status" className="text-sm text-slate-500">No files in this upload.</p>}</div></div><div><h3 className="mb-2 text-sm text-slate-300">Content</h3>{contentQ.isError && <p role="alert" className="mb-2 text-sm text-rose-300">Unable to load this file.</p>}<pre tabIndex={0} aria-label="Log file content" className="max-h-[32rem] overflow-auto whitespace-pre-wrap border border-white/10 bg-black/20 p-3 text-xs text-slate-300" aria-busy={contentQ.isFetching}>{selectedFile ? contentQ.data ?? (contentQ.isLoading ? "Loading…" : "Unable to load file.") : "Select a file."}</pre></div></div>
        </section>
      )}
    </div>
  );
}
