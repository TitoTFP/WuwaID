import { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useToast } from "./Toast";
import { api } from "../lib/api";
import ExportDialog from "./editor/ExportDialog";

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
  const [page, setPage] = useState(0);
  const [filter, setFilter] = useState("");
  const [selectedPrefixes, setSelectedPrefixes] = useState<string[]>([]);
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);

  const toast = useToast();
  const [showExportModal, setShowExportModal] = useState(false);

  const exportMutation = useMutation({
    mutationKey: ["export-category", category],
    mutationFn: (onlyUntranslated: boolean) => {
      if (!category) return Promise.resolve({ ok: false, files: [] });
      return api.exportTranslations({
        category_names: [category],
        only_untranslated: onlyUntranslated,
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
    setFilter("");
    setSelectedPrefixes([]);
    setSelectedTypes([]);
  }, [category]);

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
    <div className="space-y-4">
      <div className="flex items-center justify-between border-b border-white/5 pb-2">
        <div className="flex items-baseline gap-3">
          <h2 className="font-serif text-xl text-accent-gold" id="category-table-title">{category}</h2>
          <span className="text-xs text-slate-500">{progressText}</span>
        </div>
        <button
          type="button"
          onClick={() => setShowExportModal(true)}
          className="btn text-xs btn-active"
        >
          Export Category to SQLite
        </button>
      </div>

      <div className="space-y-3">
        <input
          type="text"
          id="category-filter-input"
          placeholder="Filter by key, english, translation..."
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
            setPage(0);
          }}
          className="input"
        />

        {prefixes.length > 1 && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
            <span className="font-medium">Prefixes:</span>
            <button
              type="button"
              onClick={() => {
                setSelectedPrefixes([]);
                setPage(0);
              }}
              className={`chip transition hover:border-accent-gold/40 cursor-pointer ${
                selectedPrefixes.length === 0
                  ? "border-accent-gold bg-accent-gold/10 text-accent-gold font-medium"
                  : "hover:bg-bg-3"
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
                  className={`chip transition hover:border-accent-gold/40 cursor-pointer ${
                    isSelected
                      ? "border-accent-gold bg-accent-gold/10 text-accent-gold font-medium"
                      : "hover:bg-bg-3"
                  }`}
                >
                  {pref}
                </button>
              );
            })}
          </div>
        )}

        {types.length > 1 && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
            <span className="font-medium">Types:</span>
            <button
              type="button"
              onClick={() => {
                setSelectedTypes([]);
                setPage(0);
              }}
              className={`chip transition hover:border-accent-gold/40 cursor-pointer ${
                selectedTypes.length === 0
                  ? "border-accent-gold bg-accent-gold/10 text-accent-gold font-medium"
                  : "hover:bg-bg-3"
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
                  className={`chip transition hover:border-accent-gold/40 cursor-pointer ${
                    isSelected
                      ? "border-accent-gold bg-accent-gold/10 text-accent-gold font-medium"
                      : "hover:bg-bg-3"
                  }`}
                >
                  {t}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="overflow-x-auto card">
        <table className="w-full text-sm border-collapse" aria-labelledby="category-table-title">
          <thead>
            <tr className="border-b border-white/5 bg-bg-2">
              <th className="px-4 py-2.5 text-left font-medium text-slate-300 text-xs uppercase tracking-wider">Key</th>
              <th className="px-4 py-2.5 text-left font-medium text-slate-300 text-xs uppercase tracking-wider">Prefix</th>
              <th className="px-4 py-2.5 text-left font-medium text-slate-300 text-xs uppercase tracking-wider">ZH</th>
              <th className="px-4 py-2.5 text-left font-medium text-slate-300 text-xs uppercase tracking-wider">EN</th>
              <th className="px-4 py-2.5 text-left font-medium text-slate-300 text-xs uppercase tracking-wider">JA</th>
              {showIdColumn && (
                <th className="px-4 py-2.5 text-left font-medium text-slate-300 text-xs uppercase tracking-wider">ID</th>
              )}
            </tr>
          </thead>
          <tbody>
            {pageEntries.map((entry) => (
              <tr key={entry.key} className="border-b border-white/5 bg-bg-1/40 hover:bg-bg-1/80 transition-colors">
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
        <div className="flex items-center justify-between text-sm pt-2">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="btn disabled:opacity-40 disabled:cursor-not-allowed"
          >
            &larr; Prev
          </button>
          <span className="text-slate-500 font-mono">
            Page {page + 1} of {pageCount}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            disabled={page === pageCount - 1}
            className="btn disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Next &rarr;
          </button>
        </div>
      )}
      <ExportDialog
        open={showExportModal}
        title="Export Category to SQLite"
        isPending={exportMutation.isPending}
        onCancel={() => setShowExportModal(false)}
        onConfirm={(onlyUntranslated) => exportMutation.mutate(onlyUntranslated)}
      />
    </div>
  );
}
