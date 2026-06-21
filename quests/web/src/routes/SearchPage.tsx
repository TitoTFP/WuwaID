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
    <div className="container-narrow space-y-5">
      <div>
        <h1 className="font-serif text-2xl text-accent-gold">Search</h1>
        <p className="text-xs text-slate-500 mt-1">
          FTS5 over 71,469 dialogue lines & static categories · bigram tokenized for CJK
        </p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          const trimmed = draft.trim();
          if (trimmed) setParams({ q: trimmed, lang });
        }}
        className="card p-3 flex flex-col sm:flex-row gap-2"
      >
        <input
          autoFocus
          className="input flex-1"
          placeholder="e.g. threnodian, 杨, 漂泊者"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <div className="flex gap-0.5 rounded-md border border-white/10 bg-bg-1 p-0.5">
          {(["en", "zh", "ja", "id"] as const).map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setParams({ q, lang: l })}
              className={`px-3 py-1.5 text-sm rounded ${
                lang === l ? "bg-accent-gold/20 text-accent-gold" : "text-slate-400 hover:text-slate-200"
              }`}
            >
              {LANG_LABEL[l]}
            </button>
          ))}
        </div>
      </form>

      {q && (
        <div className="flex border-b border-white/5 gap-4">
          <button
            type="button"
            onClick={() => setActiveTab("quests")}
            className={`pb-2.5 text-sm font-medium transition-colors relative ${
              activeTab === "quests"
                ? "text-accent-gold"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Quests / Dialogues
            <span className="ml-1.5 rounded-full bg-slate-800 px-2 py-0.5 text-xs font-semibold text-slate-400">
              {isQuestLoading ? "…" : questHits.length}
            </span>
            {activeTab === "quests" && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent-gold" />
            )}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("categories")}
            className={`pb-2.5 text-sm font-medium transition-colors relative ${
              activeTab === "categories"
                ? "text-accent-gold"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Grouped Texts / Categories
            <span className="ml-1.5 rounded-full bg-slate-800 px-2 py-0.5 text-xs font-semibold text-slate-400">
              {isCategoryLoading ? "…" : categoryHits.length}
            </span>
            {activeTab === "categories" && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent-gold" />
            )}
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
        <div className="space-y-4">
          {Object.entries(groupedQuests).map(([qid, items]) => {
            const name = items[0]?.quest_name ?? "";
            const { dupIndex, dupTotal } = dupFor(Number(qid), name);
            const isDup = (dupTotal ?? 0) > 1;
            return (
              <div
                key={qid}
                className={`card p-3 sm:p-4 space-y-2 ${isDup ? "border-l-2 border-l-accent-gold/60" : ""}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Link to={`/quests/${qid}?q=${encodeURIComponent(q)}&lang=${lang}`} className="font-medium text-accent-gold hover:underline truncate">
                      {name}
                    </Link>
                    {isDup && (
                      <span className="text-[10px] text-accent-gold shrink-0">
                        {dupIndex}/{dupTotal}
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] text-slate-500 font-mono shrink-0">#{qid}</span>
                </div>
                {items.map((h) => (
                  <Link
                    key={`${h.qid}-${h.line_id}`}
                    to={`/quests/${h.qid}?q=${encodeURIComponent(q)}&lang=${lang}#L${h.line_id}`}
                    className="block rounded border-l-2 border-accent-teal/40 bg-bg-1/40 p-2 hover:bg-bg-2 transition"
                  >
                    <div className="text-[10px] text-slate-500 mb-0.5">
                      {h.speaker_en || <em>— narrator —</em>} · line #{h.line_id} · {h.line_type}
                    </div>
                    <div
                      className="text-sm text-slate-200"
                      dangerouslySetInnerHTML={{ __html: h.snippet }}
                    />
                  </Link>
                ))}
              </div>
            );
          })}
        </div>
      )}

      {activeTab === "categories" && !isCategoryLoading && (
        <div className="space-y-4">
          {Object.entries(groupedCategories).map(([categoryName, items]) => (
            <div key={categoryName} className="card p-3 sm:p-4 space-y-2">
              <div className="flex items-center justify-between gap-2 border-b border-white/5 pb-2 mb-2">
                <Link
                  to={`/categories/${categoryName}`}
                  className="font-serif text-lg text-accent-gold hover:underline truncate"
                >
                  {categoryName}
                </Link>
                <span className="text-[10px] text-slate-500 font-mono shrink-0">
                  {items.length} match{items.length !== 1 ? "es" : ""}
                </span>
              </div>
              <div className="space-y-2">
                {items.map((h) => (
                  <Link
                    key={h.key}
                    to={`/categories/${h.category}?q=${encodeURIComponent(h.key)}`}
                    className="block rounded border-l-2 border-accent-gold/40 bg-bg-1/40 p-2 hover:bg-bg-2 transition"
                  >
                    <div className="text-[10px] text-slate-500 mb-0.5 flex justify-between">
                      <span className="font-mono text-accent-gold select-all">{h.key}</span>
                    </div>
                    <div className="text-sm text-slate-200 mt-1 font-sans leading-relaxed">
                      {h.text}
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
