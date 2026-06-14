import { useState } from "react";
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
  const toast = useToast();

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
        toast.success(`Successfully imported ${res.stats.total_keys_imported} translations!`);
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div 
        className="card max-w-md w-full p-6 space-y-5 shadow-2xl border border-white/10 bg-bg-1/90 backdrop-blur-md animate-in fade-in zoom-in-95 duration-200"
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-modal-title"
      >
        {stats ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-full bg-accent-teal/20 text-accent-teal">
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <h2 id="import-modal-title" className="font-serif text-xl text-slate-100">
                  Import Completed!
                </h2>
                <p className="text-xs text-slate-400">Translations merged & index rebuilt.</p>
              </div>
            </div>

            <div className="rounded-lg border border-white/5 bg-bg-2/50 p-4 space-y-2 text-sm">
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
                <svg className="h-5 w-5 text-accent-gold" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                Import from SQLite DB
              </h2>
              <p className="mt-1 text-xs text-slate-400">
                Provide the path to a SQLite database file containing a <code className="font-mono text-slate-300">MultiText</code> table.
              </p>
            </div>

            {errorMsg && (
              <div className="rounded border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300 leading-normal">
                {errorMsg}
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
                Database File Path
              </label>
              <input
                type="text"
                placeholder="e.g., /home/nozomi/Downloads/34NPCTHST.db"
                value={dbPath}
                onChange={(e) => setDbPath(e.target.value)}
                className="input"
                disabled={isLoading}
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
                    <svg className="animate-spin h-4 w-4 text-accent-gold" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Importing & Indexing...
                  </>
                ) : (
                  "Import Translations"
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
