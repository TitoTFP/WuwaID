import { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { useToast } from "./Toast";
import { api } from "../lib/api";
import ExportDialog, { type ExportMode } from "./editor/ExportDialog";
import ConfirmDialog from "./editor/ConfirmDialog";
import { canEdit, useMe } from "../lib/auth";

export interface CategoryEntry {
  key: string;
  prefix: string;
  "zh-Hans": string;
  en: string;
  ja: string;
  id: string | null;
}

export interface CategoryTableProps {
  category: string;
  entries: CategoryEntry[];
  showIdColumn: boolean;
}

const PAGE_SIZE = 200;

export function CategoryTable({ category, entries, showIdColumn }: CategoryTableProps) {
  const [searchParams] = useSearchParams();
  const [page, setPage] = useState(0);
  const [filter, setFilter] = useState(searchParams.get("q") ?? "");
  const [selectedPrefixes, setSelectedPrefixes] = useState<string[]>([]);
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);

  const toast = useToast();
  const [showExportModal, setShowExportModal] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  
  const meQ = useMe();
  const role = meQ.data?.role ?? "anon";

  const deleteMutation = useMutation({
    mutationFn: () => api.deleteCategoryTranslation(category),
    onSuccess: () => {
      setConfirmDelete(false);
      window.location.reload();
    },
    onError: (err: any) => {
      toast.error(`Delete failed: ${err.message || err}`);
    }
  });

  const exportMutation = useMutation({
    mutationKey: ["export-category", category],
    mutationFn: (mode: ExportMode) => {
      if (!category) return Promise.resolve({ ok: false, files: [] });
      return api.exportTranslations({
        category_names: [category],
        export_mode: mode,
        only_untranslated: mode === "untranslated",
        prefix_filters: selectedPrefixes.length > 0 ? selectedPrefixes : undefined,
        type_filters: selectedTypes.length > 0 ? selectedTypes : undefined,
        search_filter: filter.trim() || undefined,
      });
    },
    onSuccess: (res) => {
      setShowExportModal(false);
      const file = res.files?.[0];
      if (file) {
        toast.success(`Category successfully exported to output_db/id/${file}!`);
      } else {
        toast.success("Category successfully exported to output_db/id!");
      }
    },
    onError: (err: any) => {
      toast.error(`Export failed: ${err.message || err}`);
    }
  });

  // Reset page and filters when active category changes
  useEffect(() => {
    setPage(0);
    setFilter(searchParams.get("q") ?? "");
    setSelectedPrefixes([]);
    setSelectedTypes([]);
  }, [category, searchParams]);

  // Clear selectedTypes when prefix selection changes
  useEffect(() => {
    setSelectedTypes([]);
  }, [selectedPrefixes]);

  // Dynamically attach and cache the extracted text type for each entry
  const entriesWithTypes = useMemo(() => {
    return entries.map((e) => {
      const match = e.key.match(/(?:^|_)(Name|Desc|Title|Text|Content|Memo|Header|Tips|Active|Effect|Unlock|Hint|Desc[1-4]?)(?:_|$|\d)/i);
      let type = "";
      if (match) {
        const val = match[1].toLowerCase();
        if (val.startsWith("desc")) type = "Desc";
        else type = val.charAt(0).toUpperCase() + val.slice(1);
      }
      return { ...e, type };
    });
  }, [entries]);

  // Dynamically extract unique prefixes from entries
  const prefixes = useMemo(() => {
    const set = new Set<string>();
    entries.forEach((e) => {
      if (e.prefix) set.add(e.prefix);
    });
    return Array.from(set).sort();
  }, [entries]);

  // Dynamically extract unique subtypes/text types from entries (refined by selectedPrefixes)
  const types = useMemo(() => {
    const set = new Set<string>();
    const baseEntries = selectedPrefixes.length > 0
      ? entriesWithTypes.filter((e) => selectedPrefixes.includes(e.prefix))
      : entriesWithTypes;

    baseEntries.forEach((e) => {
      if (e.type) set.add(e.type);
    });
    return Array.from(set).sort();
  }, [entriesWithTypes, selectedPrefixes]);

  const filtered = useMemo(() => {
    let result = entriesWithTypes;

    if (filter) {
      const f = filter.toLowerCase();
      result = result.filter(
        (e) =>
          e.key.toLowerCase().includes(f) ||
          e.en.toLowerCase().includes(f) ||
          e["zh-Hans"].toLowerCase().includes(f) ||
          e.ja.toLowerCase().includes(f) ||
          (e.id && e.id.toLowerCase().includes(f))
      );
    }

    if (selectedPrefixes.length > 0) {
      result = result.filter((e) => selectedPrefixes.includes(e.prefix));
    }

    if (selectedTypes.length > 0) {
      result = result.filter((e) => selectedTypes.includes(e.type));
    }

    return result;
  }, [entriesWithTypes, filter, selectedPrefixes, selectedTypes]);

  const pageCount = Math.ceil(filtered.length / PAGE_SIZE);
  const pageEntries = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const translatedCount = entries.filter((e) => e.id).length;
  const progressText = `${translatedCount} / ${entries.length} translated`;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 border-b border-white/10 pb-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <h1 className="min-w-0 [overflow-wrap:anywhere] font-serif text-2xl text-slate-100 sm:text-3xl" id="category-table-title">
            {category}
          </h1>
          <span className="mt-1 block font-mono text-[10px] text-slate-500 tabular-nums sm:text-xs">{progressText}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowExportModal(true)}
            className="btn btn-active whitespace-nowrap text-xs"
          >
            Export SQLite
          </button>
          {canEdit(role) && (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="btn whitespace-nowrap border-rose-400/40 text-xs text-rose-300 hover:bg-rose-500/10"
              title="Delete Indonesian translation locally"
            >
              Delete ID
            </button>
          )}
          <Link
            to={`/translator/category/${category}`}
            className="btn whitespace-nowrap border-accent-gold/45 text-xs text-accent-gold hover:bg-accent-gold/5"
            title="Translate category entries to Indonesian"
          >
            Translate
          </Link>
        </div>
      </div>

      <div className="space-y-3">
        <label className="block">
          <span className="mb-1 block text-[10px] text-slate-500">Filter entries</span>
          <input
            type="text"
            id="category-filter-input"
            placeholder="Key, English, translation…"
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
              setPage(0);
            }}
            className="input"
          />
        </label>

        {prefixes.length > 1 && (
          <div className="flex flex-wrap items-center gap-x-1 gap-y-2 text-xs text-slate-400" role="group" aria-label="Filter by prefix">
            <span className="mr-2 font-medium">Prefixes</span>
            <button
              type="button"
              onClick={() => {
                setSelectedPrefixes([]);
                setPage(0);
              }}
              aria-pressed={selectedPrefixes.length === 0}
              className={`inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center border-b px-2 text-xs whitespace-nowrap transition-colors ${
                selectedPrefixes.length === 0
                  ? "border-accent-gold text-accent-gold"
                  : "border-transparent text-slate-400 hover:border-white/20 hover:text-slate-200"
              }`}
            >
              All
            </button>
            {prefixes.map((pref) => {
              const isSelected = selectedPrefixes.includes(pref);
              return (
                <button
                  key={pref}
                  type="button"
                  onClick={() => {
                    setSelectedPrefixes((prev) =>
                      prev.includes(pref)
                        ? prev.filter((p) => p !== pref)
                        : [...prev, pref]
                    );
                    setPage(0);
                  }}
                  aria-pressed={isSelected}
                  className={`inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center border-b px-2 text-xs whitespace-nowrap transition-colors ${
                    isSelected
                      ? "border-accent-gold text-accent-gold"
                      : "border-transparent text-slate-400 hover:border-white/20 hover:text-slate-200"
                  }`}
                >
                  {pref}
                </button>
              );
            })}
          </div>
        )}

        {types.length > 1 && (
          <div className="flex flex-wrap items-center gap-x-1 gap-y-2 text-xs text-slate-400" role="group" aria-label="Filter by type">
            <span className="mr-2 font-medium">Types</span>
            <button
              type="button"
              onClick={() => {
                setSelectedTypes([]);
                setPage(0);
              }}
              aria-pressed={selectedTypes.length === 0}
              className={`inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center border-b px-2 text-xs whitespace-nowrap transition-colors ${
                selectedTypes.length === 0
                  ? "border-accent-gold text-accent-gold"
                  : "border-transparent text-slate-400 hover:border-white/20 hover:text-slate-200"
              }`}
            >
              All
            </button>
            {types.map((t) => {
              const isSelected = selectedTypes.includes(t);
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => {
                    setSelectedTypes((prev) =>
                      prev.includes(t)
                        ? prev.filter((p) => p !== t)
                        : [...prev, t]
                    );
                    setPage(0);
                  }}
                  aria-pressed={isSelected}
                  className={`inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center border-b px-2 text-xs whitespace-nowrap transition-colors ${
                    isSelected
                      ? "border-accent-gold text-accent-gold"
                      : "border-transparent text-slate-400 hover:border-white/20 hover:text-slate-200"
                  }`}
                >
                  {t}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="divide-y divide-white/10 border-y border-white/10 md:hidden" aria-labelledby="category-table-title">
        {pageEntries.map((entry) => (
          <article key={entry.key} className="space-y-3 py-4">
            <div className="flex min-w-0 items-start justify-between gap-3">
              <code className="min-w-0 [overflow-wrap:anywhere] font-mono text-[10px] text-accent-gold select-all">
                {entry.key}
              </code>
              <span className="shrink-0 font-mono text-[10px] text-slate-500">{entry.prefix}</span>
            </div>
            <dl className="space-y-2 text-base leading-relaxed">
              <div className="grid grid-cols-[2rem_minmax(0,1fr)] gap-2">
                <dt className="font-mono text-[10px] text-slate-500">ZH</dt>
                <dd className="min-w-0 [overflow-wrap:anywhere] text-slate-300">{entry["zh-Hans"] || "—"}</dd>
              </div>
              <div className="grid grid-cols-[2rem_minmax(0,1fr)] gap-2">
                <dt className="font-mono text-[10px] text-accent-gold">EN</dt>
                <dd className="min-w-0 [overflow-wrap:anywhere] text-slate-100">{entry.en || "—"}</dd>
              </div>
              <div className="grid grid-cols-[2rem_minmax(0,1fr)] gap-2">
                <dt className="font-mono text-[10px] text-slate-500">JA</dt>
                <dd className="min-w-0 [overflow-wrap:anywhere] text-slate-300">{entry.ja || "—"}</dd>
              </div>
              {showIdColumn && (
                <div className="grid grid-cols-[2rem_minmax(0,1fr)] gap-2">
                  <dt className="font-mono text-[10px] text-accent-teal">ID</dt>
                  <dd className="min-w-0 [overflow-wrap:anywhere] text-slate-200">{entry.id || "—"}</dd>
                </div>
              )}
            </dl>
          </article>
        ))}
        {pageEntries.length === 0 && (
          <p className="py-8 text-center text-sm text-slate-500">No matching entries found.</p>
        )}
      </div>

      <div className="hidden overflow-x-auto border-y border-white/10 md:block">
        <table className="w-full text-sm border-collapse" aria-labelledby="category-table-title">
          <thead>
            <tr className="border-b border-white/10 bg-bg-2">
              <th className="px-4 py-3 text-left font-medium text-slate-300 text-xs uppercase tracking-wider">Key</th>
              <th className="px-4 py-3 text-left font-medium text-slate-300 text-xs uppercase tracking-wider">Prefix</th>
              <th className="px-4 py-3 text-left font-medium text-slate-300 text-xs uppercase tracking-wider">ZH</th>
              <th className="px-4 py-3 text-left font-medium text-slate-300 text-xs uppercase tracking-wider">EN</th>
              <th className="px-4 py-3 text-left font-medium text-slate-300 text-xs uppercase tracking-wider">JA</th>
              {showIdColumn && (
                <th className="px-4 py-3 text-left font-medium text-slate-300 text-xs uppercase tracking-wider">ID</th>
              )}
            </tr>
          </thead>
          <tbody>
            {pageEntries.map((entry) => (
              <tr key={entry.key} className="border-b border-white/10 transition-colors hover:bg-bg-2">
                <td className="px-4 py-2 font-mono text-[10px] text-accent-gold select-all">{entry.key}</td>
                <td className="px-4 py-2 text-xs text-slate-500 font-mono">{entry.prefix}</td>
                <td className="px-4 py-2 text-slate-300 font-sans leading-relaxed">{entry["zh-Hans"]}</td>
                <td className="px-4 py-2 text-slate-200 font-sans leading-relaxed">{entry.en}</td>
                <td className="px-4 py-2 text-slate-300 font-sans leading-relaxed">{entry.ja}</td>
                {showIdColumn && (
                  <td className="px-4 py-2 font-sans leading-relaxed">
                    {entry.id ? (
                      <span className="text-accent-teal font-medium">{entry.id}</span>
                    ) : (
                      <span className="text-slate-600 select-none">&mdash;</span>
                    )}
                  </td>
                )}
              </tr>
            ))}
            {pageEntries.length === 0 && (
              <tr>
                <td colSpan={showIdColumn ? 6 : 5} className="px-4 py-8 text-center text-sm text-slate-500">
                  No matching entries found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {pageCount > 1 && (
        <nav className="flex items-center justify-between gap-3 pt-2 text-sm" aria-label="Category entry pages">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="btn whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-40"
          >
            &larr; Prev
          </button>
          <span className="text-slate-500 font-mono">
            Page {page + 1} of {pageCount}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            disabled={page === pageCount - 1}
            className="btn whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-40"
          >
            Next &rarr;
          </button>
        </nav>
      )}
      <ExportDialog
        open={showExportModal}
        title="Export Category to SQLite"
        isPending={exportMutation.isPending}
        onCancel={() => setShowExportModal(false)}
        onConfirm={(mode) => exportMutation.mutate(mode)}
      />
      <ConfirmDialog
        open={confirmDelete}
        title="Delete Indonesian Translation?"
        message="This will permanently delete all Indonesian translation data (including edits, drafts, and cache) for this category. This action cannot be undone."
        confirmLabel={deleteMutation.isPending ? "Deleting…" : "Delete"}
        destructive
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => deleteMutation.mutate()}
      />
    </div>
  );
}
