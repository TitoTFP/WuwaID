import { useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import { useToast } from "../Toast";

interface ImportModalProps {
  onClose: () => void;
}

export default function ImportModal({ onClose }: ImportModalProps) {
  const [dbPath, setDbPath] = useState("/home/nozomi/Downloads/34NPCTHST.db");
  const [isLoading, setIsLoading] = useState(false);
  const [stats, setStats] = useState<any>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const toast = useToast();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || dialog.open) return;
    dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, []);

  async function handleImport(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = dbPath.trim();
    if (!trimmed) {
      setErrorMsg("Please enter a database file path.");
      return;
    }

    setIsLoading(true);
    setErrorMsg("");
    setStats(null);

    try {
      const res = await api.importTranslations(trimmed);
      if (res.ok && res.stats) {
        setStats(res.stats);
      } else {
        setErrorMsg("Failed to parse import results.");
      }
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || "An unexpected error occurred during import.");
      toast.error("Import failed.");
    } finally {
      setIsLoading(false);
    }
  }

  function handleSuccessClose() {
    onClose();
    // Reload page to refresh search index and local data views
    window.location.reload();
  }

  return (
    <dialog
      ref={dialogRef}
      className="fixed inset-0 m-auto max-h-[calc(100dvh-1.5rem)] w-[calc(100%_-_1.5rem)] max-w-md border border-white/15 bg-bg-1 p-0 text-slate-100 backdrop:bg-black/70"
      aria-labelledby="import-modal-title"
      aria-describedby="import-modal-description"
      onCancel={(event) => {
        event.preventDefault();
        if (!isLoading) onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && !isLoading) onClose();
      }}
    >
      <div 
        className="max-h-[calc(100dvh-1.5rem)] w-full space-y-5 overflow-y-auto bg-bg-1 p-4 sm:p-6"
        onClick={(event) => event.stopPropagation()}
      >
        {stats ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center border border-accent-teal/30 text-accent-teal">
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <h2 id="import-modal-title" className="font-serif text-xl text-slate-100">
                  Import Completed!
                </h2>
                <p id="import-modal-description" className="text-base text-slate-400">Translations merged & index rebuilt.</p>
              </div>
            </div>

            <div className="space-y-2 border-y border-white/10 bg-bg-2/50 p-4 text-sm">
              <div className="flex justify-between border-b border-white/5 pb-2">
                <span className="text-slate-400">Total keys imported</span>
                <span className="font-mono text-accent-gold font-semibold">{stats.total_keys_imported}</span>
              </div>
              <div className="flex justify-between border-b border-white/5 py-1">
                <span className="text-slate-400">Quests updated</span>
                <span className="font-mono text-slate-200">{stats.quests_updated}</span>
              </div>
              <div className="flex justify-between border-b border-white/5 py-1">
                <span className="text-slate-400">Categories updated</span>
                <span className="font-mono text-slate-200">{stats.categories_updated}</span>
              </div>
              <div className="flex justify-between pt-1">
                <span className="text-slate-400">Keys skipped (not in game)</span>
                <span className="font-mono text-slate-400">{stats.skipped_keys}</span>
              </div>
            </div>

            {stats.message && (
              <div className="max-h-24 select-all overflow-y-auto rounded-sm border border-white/5 bg-bg-2/30 p-2 text-center font-mono text-xs text-slate-400">
                {stats.message}
              </div>
            )}

            <button
              onClick={handleSuccessClose}
              className="btn w-full justify-center border-accent-gold/60 bg-accent-gold/10 text-accent-gold hover:bg-accent-gold/20"
            >
              Done & Reload Page
            </button>
          </div>
        ) : (
          <form onSubmit={handleImport} className="space-y-4">
            <div>
              <h2 id="import-modal-title" className="font-serif text-xl text-slate-100 flex items-center gap-2">
                <svg className="h-5 w-5 text-accent-gold" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                Import from SQLite DB(s)
              </h2>
              <p id="import-modal-description" className="mt-1 text-base leading-relaxed text-slate-400">
                Provide the path to SQLite database files. You can enter a directory path, a glob pattern (e.g. <code className="font-mono text-slate-300">/path/to/*.db</code>), or a comma-separated list of paths.
              </p>
            </div>

            <div
              id="import-error"
              role={errorMsg ? "alert" : undefined}
              aria-live="polite"
              className={[
                "min-h-11 rounded-sm border border-transparent p-3 text-xs leading-normal",
                errorMsg ? "border-rose-500/30 bg-rose-500/10 text-rose-300" : "",
              ].join(" ")}
            >
              {errorMsg || <span aria-hidden="true">&nbsp;</span>}
            </div>

            <div className="space-y-2">
              <label htmlFor="import-db-path" className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
                Database Path(s) / Glob Pattern / Directory
              </label>
              <input
                id="import-db-path"
                type="text"
                placeholder="e.g., /home/nozomi/Downloads/*.db or /path/file1.db, /path/file2.db"
                value={dbPath}
                onChange={(e) => setDbPath(e.target.value)}
                className="input"
                disabled={isLoading}
                aria-invalid={!!errorMsg || undefined}
                aria-describedby="import-error"
                autoFocus
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="btn"
                disabled={isLoading}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn border-accent-gold/60 bg-accent-gold/10 text-accent-gold hover:bg-accent-gold/20 flex items-center gap-2"
                disabled={isLoading}
              >
                {isLoading ? (
                  <>
                    <svg className="animate-spin h-4 w-4 text-accent-gold" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Importing & Indexing…
                  </>
                ) : (
                  "Import Translations"
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </dialog>
  );
}
