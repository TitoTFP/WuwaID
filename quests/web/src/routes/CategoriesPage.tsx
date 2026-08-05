import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { CategoryTable, CategoryEntry } from "../components/CategoryTable";
import { api } from "../lib/api";
import type { CategorySummary } from "../lib/types";

export function CategoriesPage() {
  const { categoryName } = useParams<{ categoryName?: string }>();
  const selected = categoryName || null;

  const [categories, setCategories] = useState<CategorySummary[]>([]);
  const [entries, setEntries] = useState<CategoryEntry[]>([]);
  const [showIdColumn, setShowIdColumn] = useState(false);
  const [loading, setLoading] = useState(true);



  // Set page title and load categories list on mount
  useEffect(() => {
    document.title = "Grouped Texts - wuwaid-quests";
    api.categories()
      .then((data) => {
        setCategories(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  // Update title when selected category changes
  useEffect(() => {
    if (!selected) {
      document.title = "Grouped Texts - wuwaid-quests";
      setEntries([]);
      return;
    }
    
    document.title = `${selected} - Grouped Texts - wuwaid-quests`;

    api.categorySingle(selected)
      .then((data) => {
        const list: CategoryEntry[] = (data.entries || []).map(
          (e) => ({
            key: e.key,
            prefix: e.key.split("_", 1)[0],
            "zh-Hans": e["zh-Hans"] ?? "",
            en: e.en ?? "",
            ja: e.ja ?? "",
            id: e.id ?? null,
          }),
        );
        setEntries(list);
        setShowIdColumn(list.some((e) => e.id !== null));
      })
      .catch((err) => {
        console.error("Error loading category entries:", err);
      });
  }, [selected]);

  if (loading) {
    return (
      <div className="container-narrow py-10 text-center">
        <div className="text-sm text-slate-500">Loading categories…</div>
      </div>
    );
  }

  if (!selected) {
    return (
      <div className="container-narrow gap-6 pb-8">
        <header className="border-b border-white/10 pb-5">
          <h1 className="min-w-0 [overflow-wrap:anywhere] font-serif text-2xl text-slate-100 sm:text-3xl" id="categories-heading">
            Grouped Texts
          </h1>
          <p className="mt-1 text-base text-slate-500">
            Browse static texts grouped by type and domain
          </p>
        </header>

        <div 
          className="divide-y divide-white/10 border-y border-white/10"
          aria-labelledby="categories-heading"
        >
          {categories.map((c) => {
            const pct =
              c.key_count > 0 ? (c.translated_count / c.key_count) * 100 : 0;
            const isFullyTranslated = pct >= 100;
            return (
              <Link
                key={c.name}
                id={`category-btn-${c.name.toLowerCase()}`}
                to={`/categories/${c.name}`}
                className="group grid min-h-20 min-w-0 grid-cols-[minmax(0,1fr)_7rem] items-center gap-4 px-1 py-3 text-left transition-colors hover:bg-bg-2 focus-visible:bg-bg-2 sm:grid-cols-[minmax(0,1fr)_10rem] sm:px-3"
              >
                <div className="min-w-0">
                  <div className="min-w-0 truncate font-serif text-lg text-slate-100 transition-colors group-hover:text-accent-signal">
                    {c.name}
                  </div>
                  <div className="mt-1 font-mono text-[10px] text-slate-500 tabular-nums">
                    {c.key_count.toLocaleString()} keys
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-mono text-[10px] text-slate-500 tabular-nums">
                    {c.translated_count.toLocaleString()} translated · {pct.toFixed(0)}%
                  </div>
                  <div
                    className="mt-2 h-px w-full bg-white/10"
                    role="progressbar"
                    aria-label={`${c.name} translation progress`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(pct)}
                  >
                    <div
                      className={`h-px ${isFullyTranslated ? "bg-accent-signal" : "bg-accent-signal"}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="container-narrow gap-4 pb-8">
      <header className="border-b border-white/10 pb-3">
        <Link
          id="back-to-categories-btn"
          to="/categories"
          className="link inline-flex min-h-11 items-center gap-2 whitespace-nowrap text-xs"
        >
          <span aria-hidden="true">&larr;</span> Back to categories
        </Link>
      </header>
      
      <CategoryTable
        category={selected}
        entries={entries}
        showIdColumn={showIdColumn}
      />
    </div>
  );
}

export default CategoriesPage;
