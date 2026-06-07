import { Link, useSearchParams } from "react-router-dom";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";

const LANG_LABEL: Record<string, string> = {
  en: "EN",
  zh: "中文",
  ja: "JA",
  id: "ID",
};

export default function SearchPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const lang = (params.get("lang") ?? "en") as "en" | "zh" | "ja" | "id";
  const [draft, setDraft] = useState("");

  // initialize draft from URL
  useEffect(() => { setDraft(q); }, [q]);

  const { data: hits = [], isLoading } = useQuery({
    queryKey: ["search", q, lang],
    queryFn: () => api.search({ q, lang }),
    enabled: q.length > 0,
  });

  // group by quest
  const grouped = hits.reduce<Record<number, typeof hits>>((acc, h) => {
    (acc[h.qid] ??= []).push(h);
    return acc;
  }, {});

  // disambiguate quests that share a name across distinct qids
  const nameCounts = new Map<string, number>();
  Object.values(grouped).forEach((items) => {
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
          FTS5 over 71,469 dialogue lines · bigram tokenized for CJK
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

      {isLoading && <div className="text-sm text-slate-500">Searching…</div>}

      {!isLoading && q && hits.length === 0 && (
        <div className="text-sm text-slate-500">No hits for <span className="text-slate-300">{q}</span>.</div>
      )}

      {Object.entries(grouped).map(([qid, items]) => {
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
  );
}
