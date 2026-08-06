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
  const [error, setError] = useState(false);
  const [entriesLoading, setEntriesLoading] = useState(false);
  const [entriesError, setEntriesError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);



  // Set page title and load categories list on mount
  useEffect(() => {
    let active = true;
    document.title = "Grouped Texts - wuwaid-quests";
    setLoading(true);
    setError(false);
    api.categories()
      .then((data) => {
        if (!active) return;
        setCategories(data);
        setLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setCategories([]);
        setError(true);
        setLoading(false);
      });
    return () => { active = false; };
  }, [reloadKey]);

  // Update title when selected category changes
  useEffect(() => {
    if (!selected) {
      document.title = "Grouped Texts - wuwaid-quests";
      setEntries([]);
      setShowIdColumn(false);
      setEntriesLoading(false);
      setEntriesError(false);
      return;
    }

    let active = true;
    document.title = `${selected} - Grouped Texts - wuwaid-quests`;
    setEntries([]);
    setEntriesLoading(true);
    setEntriesError(false);

    api.categorySingle(selected)
      .then((data) => {
        if (!active) return;
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
        setEntriesLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setEntries([]);
        setEntriesError(true);
        setEntriesLoading(false);
      });
    return () => { active = false; };
  }, [selected, reloadKey]);

  if (loading) {
    return (
      <div className="container-narrow py-10 text-center" role="status" aria-live="polite">
        <div className="text-sm text-slate-400">Loading categories…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container-narrow space-y-3 py-10" role="alert">
        <p className="text-sm text-rose-300">Unable to load grouped texts.</p>
        <button type="button" className="btn" onClick={() => setReloadKey((value) => value + 1)}>Retry</button>
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
          aria-busy={loading}
        >
          {categories.length === 0 && (
            <p className="p-5 text-sm text-slate-400" role="status" aria-live="polite">No grouped texts available.</p>
          )}
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
      
      {entriesLoading && <p className="py-6 text-sm text-slate-400" role="status" aria-live="polite">Loading {selected}…</p>}
      {entriesError && (
        <div className="flex flex-wrap items-center justify-between gap-3 py-4 text-sm text-rose-300" role="alert">
          <span>Unable to load {selected}.</span>
          <button type="button" className="btn text-xs" onClick={() => setReloadKey((value) => value + 1)}>Retry</button>
        </div>
      )}
      {!entriesLoading && !entriesError && entries.length === 0 && (
        <p className="py-6 text-sm text-slate-400" role="status" aria-live="polite">No entries available in {selected}.</p>
      )}
      {!entriesLoading && !entriesError && entries.length > 0 && (
        <CategoryTable
          category={selected}
          entries={entries}
          showIdColumn={showIdColumn}
        />
      )}
    </div>
  );
}

export default CategoriesPage;
