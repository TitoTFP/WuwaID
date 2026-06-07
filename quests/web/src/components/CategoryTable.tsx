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
    <div className="p-4">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-bold">{category}</h2>
        <span className="text-sm text-gray-500">{progressText}</span>
      </div>
      <div className="mb-4">
        <input
          type="text"
          placeholder="Filter..."
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
            setPage(0);
          }}
          className="w-full rounded border border-gray-300 px-3 py-2"
        />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              <th className="px-3 py-2 text-left font-medium">Key</th>
              <th className="px-3 py-2 text-left font-medium">Prefix</th>
              <th className="px-3 py-2 text-left font-medium">ZH</th>
              <th className="px-3 py-2 text-left font-medium">EN</th>
              <th className="px-3 py-2 text-left font-medium">JA</th>
              {showIdColumn && (
                <th className="px-3 py-2 text-left font-medium">ID</th>
              )}
            </tr>
          </thead>
          <tbody>
            {pageEntries.map((entry) => (
              <tr key={entry.key} className="border-b border-gray-100">
                <td className="px-3 py-1 font-mono text-xs">{entry.key}</td>
                <td className="px-3 py-1 text-xs text-gray-500">{entry.prefix}</td>
                <td className="px-3 py-1">{entry["zh-Hans"]}</td>
                <td className="px-3 py-1">{entry.en}</td>
                <td className="px-3 py-1">{entry.ja}</td>
                {showIdColumn && (
                  <td className="px-3 py-1 text-gray-700">
                    {entry.id ?? <span className="text-gray-300">&mdash;</span>}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pageCount > 1 && (
        <div className="mt-4 flex items-center justify-between">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="rounded border border-gray-300 px-3 py-1 disabled:opacity-50"
          >
            Prev
          </button>
          <span className="text-sm text-gray-500">
            Page {page + 1} of {pageCount}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            disabled={page === pageCount - 1}
            className="rounded border border-gray-300 px-3 py-1 disabled:opacity-50"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
