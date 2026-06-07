import { useMemo, useState } from "react";

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

  const filtered = useMemo(() => {
    if (!filter) return entries;
    const f = filter.toLowerCase();
    return entries.filter(
      (e) =>
        e.key.toLowerCase().includes(f) ||
        e.en.toLowerCase().includes(f) ||
        e["zh-Hans"].toLowerCase().includes(f) ||
        e.ja.toLowerCase().includes(f) ||
        (e.id && e.id.toLowerCase().includes(f))
    );
  }, [entries, filter]);

  const pageCount = Math.ceil(filtered.length / PAGE_SIZE);
  const pageEntries = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const translatedCount = entries.filter((e) => e.id).length;
  const progressText = `${translatedCount} / ${entries.length} translated`;

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between border-b border-white/5 pb-2">
        <h2 className="font-serif text-xl text-accent-gold" id="category-table-title">{category}</h2>
        <span className="text-xs text-slate-500">{progressText}</span>
      </div>

      <div>
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
    </div>
  );
}
