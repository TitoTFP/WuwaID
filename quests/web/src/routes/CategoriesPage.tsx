import { useEffect, useState } from "react";
import { CategoryTable, CategoryEntry } from "../components/CategoryTable";

interface CategorySummary {
  name: string;
  key_count: number;
  translated_count: number;
}

export function CategoriesPage() {
  const [categories, setCategories] = useState<CategorySummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [entries, setEntries] = useState<CategoryEntry[]>([]);
  const [showIdColumn, setShowIdColumn] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/categories")
      .then((r) => r.json())
      .then((data) => {
        setCategories(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selected) {
      setEntries([]);
      return;
    }
    fetch(`/api/category/${selected}`)
      .then((r) => r.json())
      .then((data) => {
        const list: CategoryEntry[] = (data.entries || data.items || []).map(
          (e: Record<string, unknown>) => ({
            key: e.key as string,
            prefix: (e.key as string).split("_", 1)[0],
            "zh-Hans": (e["zh-Hans"] as string) ?? "",
            en: (e.en as string) ?? "",
            ja: (e.ja as string) ?? "",
            id: (e.id as string) ?? null,
          }),
        );
        setEntries(list);
        setShowIdColumn(list.some((e) => e.id !== null));
      });
  }, [selected]);

  if (loading) return <div className="p-4">Loading...</div>;

  if (!selected) {
    return (
      <div className="p-4">
        <h1 className="mb-4 text-2xl font-bold">Categories</h1>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3">
          {categories.map((c) => {
            const pct =
              c.key_count > 0 ? (c.translated_count / c.key_count) * 100 : 0;
            return (
              <button
                key={c.name}
                onClick={() => setSelected(c.name)}
                className="rounded border border-gray-200 p-3 text-left hover:bg-gray-50"
              >
                <div className="font-medium">{c.name}</div>
                <div className="text-xs text-gray-500">
                  {c.translated_count} / {c.key_count} translated (
                  {pct.toFixed(0)}%)
                </div>
                <div className="mt-1 h-1 w-full rounded bg-gray-200">
                  <div
                    className="h-1 rounded bg-blue-500"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div>
      <button
        onClick={() => setSelected(null)}
        className="m-4 rounded border border-gray-300 px-3 py-1 hover:bg-gray-50"
      >
        &larr; Back to categories
      </button>
      <CategoryTable
        category={selected}
        entries={entries}
        showIdColumn={showIdColumn}
      />
    </div>
  );
}

export default CategoriesPage;
