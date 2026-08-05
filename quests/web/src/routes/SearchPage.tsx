import { Link, useSearchParams } from "react-router-dom";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import type { SearchHit } from "../lib/types";

const LANG_LABEL: Record<string, string> = {
  en: "EN",
  zh: "中文",
  ja: "JA",
  id: "ID",
};

interface CategorySearchHit {
  category: string;
  key: string;
  text: string;
}

export default function SearchPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const lang = (params.get("lang") ?? "en") as "en" | "zh" | "ja" | "id";
  const [draft, setDraft] = useState("");
  const [activeTab, setActiveTab] = useState<"quests" | "categories">("quests");

  // initialize draft from URL
  useEffect(() => { setDraft(q); }, [q]);

  // Reset tab to quests when query changes
  useEffect(() => {
    setActiveTab("quests");
  }, [q]);

  const { data: questHits = [], isLoading: isQuestLoading } = useQuery<SearchHit[]>({
    queryKey: ["search", "quest", q, lang],
    queryFn: () => api.search({ q, lang, scope: "quest" }),
    enabled: q.length > 0,
  });

  const { data: categoryData, isLoading: isCategoryLoading } = useQuery<{ results: CategorySearchHit[]; total: number }>({
    queryKey: ["search", "category", q, lang],
    queryFn: () => api.search({ q, lang, scope: "category" }),
    enabled: q.length > 0,
  });

  const categoryHits = categoryData?.results ?? [];

  // group by quest
  const groupedQuests = questHits.reduce<Record<number, SearchHit[]>>((acc, h) => {
    (acc[h.qid] ??= []).push(h);
    return acc;
  }, {});

  // group category hits by category name
  const groupedCategories = categoryHits.reduce<Record<string, CategorySearchHit[]>>((acc, h) => {
    (acc[h.category] ??= []).push(h);
    return acc;
  }, {});

  // If quests loaded and has 0 results, but categories has results, auto-switch to categories
  useEffect(() => {
    if (!isQuestLoading && questHits.length === 0 && !isCategoryLoading && categoryHits.length > 0) {
      setActiveTab("categories");
    }
  }, [isQuestLoading, isCategoryLoading, questHits.length, categoryHits.length]);

  // disambiguate quests that share a name across distinct qids
  const nameCounts = new Map<string, number>();
  Object.values(groupedQuests).forEach((items) => {
    const n = items[0]?.quest_name;
    if (n) nameCounts.set(n, (nameCounts.get(n) ?? 0) + 1);
  });
  const nameOrder = new Map<string, number>();
  const dupFor = (_qid: number, name: string) => {
    const total = nameCounts.get(name) ?? 1;
    if (total <= 1) return { dupIndex: undefined, dupTotal: undefined };
    const idx = (nameOrder.get(name) ?? 0) + 1;
    nameOrder.set(name, idx);
    return { dupIndex: idx, dupTotal: total };
  };

  return (
    <div className="container-narrow gap-6 pb-8">
      <header className="border-b border-white/10 pb-5">
        <h1 className="min-w-0 [overflow-wrap:anywhere] font-serif text-2xl text-slate-100 sm:text-3xl">Search</h1>
        <p className="mt-1 text-xs text-slate-500">
          FTS5 over 71,469 dialogue lines & static categories · bigram tokenized for CJK
        </p>
      </header>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          const trimmed = draft.trim();
          if (trimmed) setParams({ q: trimmed, lang });
        }}
        className="grid grid-cols-1 gap-3 border-y border-white/10 py-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-end"
      >
        <label className="min-w-0">
          <span className="mb-1 block text-[10px] text-slate-500">Archive query</span>
          <input
            autoFocus
            className="input"
            placeholder="e.g. threnodian, 杨, 漂泊者"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
        </label>
        <div>
          <span className="mb-1 block text-[10px] text-slate-500">Language</span>
          <div className="flex min-h-11 items-center border border-white/10 bg-bg-1" role="group" aria-label="Search language">
            {(["en", "zh", "ja", "id"] as const).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setParams({ q, lang: l })}
                aria-pressed={lang === l}
                className={`min-h-11 min-w-11 px-2 text-sm transition-colors ${
                  lang === l ? "bg-accent-signal/10 text-accent-signal" : "text-slate-400 hover:bg-bg-2 hover:text-slate-200"
                }`}
              >
                {LANG_LABEL[l]}
              </button>
            ))}
          </div>
        </div>
        <button type="submit" className="btn btn-active whitespace-nowrap">Search</button>
      </form>

      {q && (
        <div className="flex items-center gap-5 border-b border-white/10" role="group" aria-label="Search result types">
          <button
            type="button"
            onClick={() => setActiveTab("quests")}
            aria-pressed={activeTab === "quests"}
            className={`relative min-h-11 whitespace-nowrap border-b text-sm font-medium transition-colors ${
              activeTab === "quests"
                ? "border-accent-signal text-accent-signal"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            Dialogues
            <span className="ml-2 font-mono text-[10px] text-slate-500 tabular-nums">
              {isQuestLoading ? "…" : questHits.length}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("categories")}
            aria-pressed={activeTab === "categories"}
            className={`relative min-h-11 whitespace-nowrap border-b text-sm font-medium transition-colors ${
              activeTab === "categories"
                ? "border-accent-signal text-accent-signal"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            Grouped texts
            <span className="ml-2 font-mono text-[10px] text-slate-500 tabular-nums">
              {isCategoryLoading ? "…" : categoryHits.length}
            </span>
          </button>
        </div>
      )}

      {(activeTab === "quests" ? isQuestLoading : isCategoryLoading) && (
        <div className="text-sm text-slate-500">Searching…</div>
      )}

      {activeTab === "quests" && !isQuestLoading && q && questHits.length === 0 && (
        <div className="text-sm text-slate-500">
          No quest hits for <span className="text-slate-300">{q}</span>.
        </div>
      )}

      {activeTab === "categories" && !isCategoryLoading && q && categoryHits.length === 0 && (
        <div className="text-sm text-slate-500">
          No category hits for <span className="text-slate-300">{q}</span>.
        </div>
      )}

      {activeTab === "quests" && !isQuestLoading && (
        <div id="quest-search-results" className="divide-y divide-white/10 border-y border-white/10">
          {Object.entries(groupedQuests).map(([qid, items]) => {
            const name = items[0]?.quest_name ?? "";
            const { dupIndex, dupTotal } = dupFor(Number(qid), name);
            const isDup = (dupTotal ?? 0) > 1;
            return (
              <section key={qid} className="py-4">
                <div className="flex min-w-0 items-center justify-between gap-3 px-1 sm:px-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <Link to={`/quests/${qid}?q=${encodeURIComponent(q)}&lang=${lang}`} className="min-h-11 min-w-0 truncate inline-flex items-center font-serif text-lg text-slate-100 hover:text-accent-signal">
                      {name}
                    </Link>
                    {isDup && (
                      <span className="shrink-0 font-mono text-[10px] text-accent-signal">
                        record {dupIndex}/{dupTotal}
                      </span>
                    )}
                  </div>
                  <span className="shrink-0 font-mono text-[10px] text-slate-500">#{qid}</span>
                </div>
                <div className="divide-y divide-white/5 border-t border-white/5">
                  {items.map((h) => (
                    <Link
                      key={`${h.qid}-${h.line_id}`}
                      to={`/quests/${h.qid}?q=${encodeURIComponent(q)}&lang=${lang}#L${h.line_id}`}
                      className="block min-w-0 px-1 py-3 transition-colors hover:bg-bg-2 focus-visible:bg-bg-2 sm:px-3"
                    >
                      <div className="mb-1 font-mono text-[10px] text-slate-500">
                        {h.speaker_en || <em>— narrator —</em>} · line #{h.line_id} · {h.line_type}
                      </div>
                      <div
                        className="min-w-0 [overflow-wrap:anywhere] text-base leading-relaxed text-slate-200"
                        dangerouslySetInnerHTML={{ __html: h.snippet }}
                      />
                    </Link>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {activeTab === "categories" && !isCategoryLoading && (
        <div id="category-search-results" className="divide-y divide-white/10 border-y border-white/10">
          {Object.entries(groupedCategories).map(([categoryName, items]) => (
            <section key={categoryName} className="py-4">
              <div className="flex min-w-0 items-center justify-between gap-3 px-1 sm:px-3">
                <Link
                  to={`/categories/${categoryName}`}
                  className="inline-flex min-h-11 min-w-0 items-center truncate font-serif text-lg text-slate-100 hover:text-accent-signal"
                >
                  {categoryName}
                </Link>
                <span className="text-[10px] text-slate-500 font-mono shrink-0">
                  {items.length} match{items.length !== 1 ? "es" : ""}
                </span>
              </div>
              <div className="divide-y divide-white/5 border-t border-white/5">
                {items.map((h) => (
                  <Link
                    key={h.key}
                    to={`/categories/${h.category}?q=${encodeURIComponent(h.key)}`}
                    className="block min-w-0 px-1 py-3 transition-colors hover:bg-bg-2 focus-visible:bg-bg-2 sm:px-3"
                  >
                    <div className="mb-1 flex min-w-0 justify-between text-[10px] text-slate-500">
                      <span className="min-w-0 [overflow-wrap:anywhere] font-mono text-accent-signal select-all">{h.key}</span>
                    </div>
                    <div className="min-w-0 [overflow-wrap:anywhere] font-sans text-base leading-relaxed text-slate-200">
                      {h.text}
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
