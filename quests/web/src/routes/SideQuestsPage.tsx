import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import QuestCard from "../components/QuestCard";
import type { Speaker } from "../lib/types";

const TYPE_LABEL: Record<number, string> = {
  1: "Main",
  2: "World",
  3: "Companion",
  4: "Story",
  7: "Event",
  9: "Daily",
  10: "Tutorial",
  11: "Challenge",
  14: "Chain",
  100: "Activity",
};

export default function SideQuestsPage() {
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<"id" | "name" | "lines" | "lines_asc" | "translated" | "translated_asc">("id");
  const [questType, setQuestType] = useState<number | "">("");
  const [speaker, setSpeaker] = useState("");
  const [hasOptions, setHasOptions] = useState<"" | "yes" | "no">("");
  const [q, setQ] = useState("");

  const { data: speakers = [] } = useQuery<Speaker[]>({ queryKey: ["speakers"], queryFn: api.speakers });

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["side-quests", page, sort, questType, speaker, hasOptions, q],
    queryFn: () =>
      api.quests({
        side: 1,
        sort,
        quest_type: questType === "" ? undefined : Number(questType),
        spk: speaker || undefined,
        has_options: hasOptions === "" ? undefined : hasOptions === "yes",
        q: q || undefined,
        page,
        page_size: 50,
      }),
  });

  return (
    <div className="container-narrow gap-6 pb-8">
      <header className="border-b border-white/10 pb-5">
        <h1 className="min-w-0 [overflow-wrap:anywhere] font-serif text-2xl text-slate-100 sm:text-3xl">Side Quests</h1>
        <p className="mt-1 font-mono text-[10px] text-slate-500 tabular-nums sm:text-xs">
          {data?.total.toLocaleString() ?? "…"} quests · filtered & paginated
        </p>
      </header>

      <section className="border-y border-white/10 py-3" aria-label="Quest filters">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <label className="min-w-0 sm:col-span-2 lg:col-span-1">
            <span className="mb-1 block text-[10px] text-slate-500">Quest name</span>
            <input
              className="input"
              placeholder="Name contains…"
              value={q}
              onChange={(e) => { setQ(e.target.value); setPage(1); }}
            />
          </label>
          <label className="min-w-0">
            <span className="mb-1 block text-[10px] text-slate-500">Type</span>
            <select
              className="input"
              value={questType}
              onChange={(e) => { setQuestType(e.target.value === "" ? "" : Number(e.target.value)); setPage(1); }}
            >
              <option value="">All types</option>
              {Object.entries(TYPE_LABEL).map(([k, v]) => (
                <option key={k} value={k}>{v} ({k})</option>
              ))}
            </select>
          </label>
          <label className="min-w-0">
            <span className="mb-1 block text-[10px] text-slate-500">Speaker</span>
            <select
              className="input"
              value={speaker}
              onChange={(e) => { setSpeaker(e.target.value); setPage(1); }}
            >
              <option value="">Any speaker</option>
              {speakers.slice(0, 200).map((s) => (
                <option key={s.name} value={s.name}>{s.name} ({s.line_count})</option>
              ))}
            </select>
          </label>
          <label className="min-w-0">
            <span className="mb-1 block text-[10px] text-slate-500">Choices</span>
            <select
              className="input"
              value={hasOptions}
              onChange={(e) => { setHasOptions(e.target.value as any); setPage(1); }}
            >
              <option value="">Any</option>
              <option value="yes">Has player options</option>
              <option value="no">No options</option>
            </select>
          </label>
          <label className="min-w-0">
            <span className="mb-1 block text-[10px] text-slate-500">Order</span>
            <select
              className="input"
              value={sort}
              onChange={(e) => setSort(e.target.value as any)}
            >
              <option value="id">Sort: id</option>
              <option value="name">Sort: name</option>
              <option value="lines">Sort: most lines</option>
              <option value="lines_asc">Sort: fewest lines</option>
              <option value="translated">Sort: most translated</option>
              <option value="translated_asc">Sort: least translated</option>
            </select>
          </label>
        </div>
      </section>

      {isLoading && <div className="py-4 text-sm text-slate-500">Loading quests…</div>}

      {(() => {
        const items = data?.items ?? [];
        const counts = new Map<string, number>();
        items.forEach((q) => counts.set(q.quest_name, (counts.get(q.quest_name) ?? 0) + 1));
        const seen = new Map<string, number>();
        const dupInfo = items.map((q) => {
          const total = counts.get(q.quest_name) ?? 1;
          const idx = (seen.get(q.quest_name) ?? 0) + 1;
          seen.set(q.quest_name, idx);
          return { q, dupIndex: idx, dupTotal: total };
        });
        return (
          <div className="divide-y divide-white/10 border-y border-white/10" aria-label="Side quests">
            {dupInfo.map(({ q, dupIndex, dupTotal }) => (
              <QuestCard key={q.qid} q={q} dupIndex={dupIndex} dupTotal={dupTotal} />
            ))}
          </div>
        );
      })()}

      {data && data.total > data.page_size && (
        <nav className="flex items-center justify-between gap-3 text-sm" aria-label="Side quest pages">
          <button
            className="btn whitespace-nowrap"
            disabled={page === 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            ← Prev
          </button>
          <span className="font-mono text-[10px] text-slate-500 tabular-nums sm:text-xs">
            Page {page} of {Math.ceil(data.total / data.page_size)}
          </span>
          <button
            className="btn whitespace-nowrap"
            disabled={page * data.page_size >= data.total}
            onClick={() => setPage((p) => p + 1)}
          >
            Next →
          </button>
        </nav>
      )}

      {isFetching && !isLoading && <div className="text-center text-xs text-slate-500">updating…</div>}
    </div>
  );
}
