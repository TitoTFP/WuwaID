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
  const [sort, setSort] = useState<"id" | "name" | "lines" | "lines_asc">("id");
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
    <div className="container-narrow space-y-5">
      <div>
        <h1 className="font-serif text-2xl text-accent-gold">Side Quests</h1>
        <p className="text-xs text-slate-500 mt-1">
          {data?.total.toLocaleString() ?? "…"} quests · filtered & paginated
        </p>
      </div>

      <div className="card p-3 grid grid-cols-2 sm:grid-cols-5 gap-2">
        <input
          className="input col-span-2 sm:col-span-1"
          placeholder="Name contains…"
          value={q}
          onChange={(e) => { setQ(e.target.value); setPage(1); }}
        />
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
        <select
          className="input"
          value={hasOptions}
          onChange={(e) => { setHasOptions(e.target.value as any); setPage(1); }}
        >
          <option value="">Any</option>
          <option value="yes">Has player options</option>
          <option value="no">No options</option>
        </select>
        <select
          className="input"
          value={sort}
          onChange={(e) => setSort(e.target.value as any)}
        >
          <option value="id">Sort: id</option>
          <option value="name">Sort: name</option>
          <option value="lines">Sort: most lines</option>
          <option value="lines_asc">Sort: fewest lines</option>
        </select>
      </div>

      {isLoading && <div className="text-sm text-slate-500">Loading…</div>}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {data?.items.map((q) => <QuestCard key={q.qid} q={q} />)}
      </div>

      {data && data.total > data.page_size && (
        <div className="flex items-center justify-between text-sm">
          <button
            className="btn"
            disabled={page === 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            ← Prev
          </button>
          <span className="text-slate-500">
            Page {page} of {Math.ceil(data.total / data.page_size)}
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

      {isFetching && !isLoading && <div className="text-center text-xs text-slate-500">updating…</div>}
    </div>
  );
}
