import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";

export default function CategoriesPage() {
  const [activeCategory, setActiveCategory] = useState<string>("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 50;

  // Fetch list of available categories
  const { data: categories = [] } = useQuery({
    queryKey: ["categories"],
    queryFn: api.categories,
  });

  // Automatically select first category when loaded
  useEffect(() => {
    if (categories.length > 0 && !activeCategory) {
      setActiveCategory(categories[0]);
    }
  }, [categories, activeCategory]);

  // Fetch paginated & filtered items for the active category
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["category", activeCategory, q, page],
    queryFn: () =>
      api.category(activeCategory, {
        q: q || undefined,
        page,
        page_size: pageSize,
      }),
    enabled: !!activeCategory,
  });

  return (
    <div className="container-narrow space-y-5">
      <div>
        <h1 className="font-serif text-2xl text-accent-gold font-bold">Grouped Texts</h1>
        <p className="text-xs text-slate-500 mt-1">
          Browse and search through localized text categories (Item descriptions, Skills, UI labels)
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {/* Category List Sidebar */}
        <div className="card p-3 space-y-1 h-[650px] overflow-y-auto md:col-span-1 border border-white/5">
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider px-2 py-1 mb-2">
            Categories ({categories.length})
          </h2>
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => {
                setActiveCategory(cat);
                setPage(1);
              }}
              className={`w-full text-left px-3 py-2 rounded text-sm transition ${
                activeCategory === cat
                  ? "bg-accent-gold/20 text-accent-gold font-medium ring-1 ring-accent-gold/30"
                  : "text-slate-300 hover:bg-bg-2 hover:text-white"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Content Area */}
        <div className="md:col-span-3 space-y-3 flex flex-col h-[650px]">
          {/* Filters card */}
          <div className="card p-3 flex gap-2 shrink-0 border border-white/5">
            <input
              className="input flex-1"
              placeholder="Search key or translations..."
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
            />
          </div>

          {/* Results list */}
          <div className="flex-1 overflow-y-auto space-y-2 pr-1 min-h-0">
            {isLoading && (
              <div className="text-sm text-slate-500 p-4">Loading translations...</div>
            )}

            {!isLoading && data?.items.length === 0 && (
              <div className="text-sm text-slate-500 p-4">
                No entries found. Try a different query.
              </div>
            )}

            {!isLoading &&
              data?.items.map((item) => (
                <div key={item.key} className="card p-3 space-y-2 border border-white/5 hover:border-white/10 transition bg-bg-1/20">
                  <div className="flex justify-between items-start gap-2">
                    <span className="text-xs font-mono text-slate-400 bg-bg-2 px-1.5 py-0.5 rounded border border-white/5 truncate max-w-full">
                      {item.key}
                    </span>
                  </div>
                  
                  <div className="grid grid-cols-1 gap-2 text-sm">
                    {item.en && (
                      <div className="bg-bg-1/40 rounded p-2 border border-white/5">
                        <span className="text-[10px] text-slate-500 block uppercase font-bold tracking-wider mb-1">English</span>
                        <div className="text-slate-200">{item.en}</div>
                      </div>
                    )}
                    {item["zh-Hans"] && (
                      <div className="bg-bg-1/40 rounded p-2 border border-white/5">
                        <span className="text-[10px] text-slate-500 block uppercase font-bold tracking-wider mb-1">Chinese (Simplified)</span>
                        <div className="text-slate-300 font-sans">{item["zh-Hans"]}</div>
                      </div>
                    )}
                    {item.ja && (
                      <div className="bg-bg-1/40 rounded p-2 border border-white/5">
                        <span className="text-[10px] text-slate-500 block uppercase font-bold tracking-wider mb-1">Japanese</span>
                        <div className="text-slate-300 font-sans">{item.ja}</div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
          </div>

          {/* Pagination Footer */}
          {data && data.total > data.page_size && (
            <div className="flex items-center justify-between text-sm pt-2 shrink-0 border-t border-white/5">
              <button
                className="btn"
                disabled={page === 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                ← Prev
              </button>
              <span className="text-xs text-slate-400">
                Page {page} of {Math.ceil(data.total / data.page_size)} ({data.total.toLocaleString()} total entries)
              </span>
              <button
                className="btn"
                disabled={page * data.page_size >= data.total}
                onClick={() => setPage((p) => p + 1)}
              >
                Next →
              </button>
            </div>
          )}

          {isFetching && !isLoading && (
            <div className="text-center text-[10px] text-slate-500 uppercase tracking-widest shrink-0">
              updating...
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
