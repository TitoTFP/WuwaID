import { Link, useParams } from "react-router-dom";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import QuestCard from "../components/QuestCard";

export default function ChapterPage() {
  const { chapterId = "0" } = useParams();
  const chid = Number(chapterId);
  const { data: chapters = [] } = useQuery({ queryKey: ["chapters"], queryFn: api.chapters });
  const { data, isLoading } = useQuery({
    queryKey: ["quests", "chapter", chid],
    queryFn: () =>
      api.quests({ side: 0, page_size: 200 }),
  });

  const chapter = chapters.find((c) => c.id === chid);
  const items = (data?.items ?? []).filter((q) => q.chapter_id === chid);

  const dupInfo = useMemo(() => {
    const counts = new Map<string, number>();
    items.forEach((q) => counts.set(q.quest_name, (counts.get(q.quest_name) ?? 0) + 1));
    const seen = new Map<string, number>();
    return items.map((q) => {
      const total = counts.get(q.quest_name) ?? 1;
      const idx = (seen.get(q.quest_name) ?? 0) + 1;
      seen.set(q.quest_name, idx);
      return { q, dupIndex: idx, dupTotal: total };
    });
  }, [items]);

  return (
    <div className="container-narrow gap-6 pb-8">
      <header className="border-b border-white/10 pb-5">
        <Link to="/" className="link inline-flex min-h-11 items-center whitespace-nowrap text-xs">← Home</Link>
        <h1 className="min-w-0 [overflow-wrap:anywhere] font-serif text-2xl text-slate-100 sm:text-3xl">
          {chapter?.name ?? `Chapter ${chid}`}
        </h1>
        <p className="mt-1 font-mono text-[10px] text-slate-500 tabular-nums sm:text-xs">
          {chapter?.quest_count ?? items.length} quests · {chapter?.line_count.toLocaleString() ?? 0} lines
        </p>
      </header>

      {isLoading && <div className="py-4 text-sm text-slate-500">Loading quests…</div>}

      <div className="divide-y divide-white/10 border-y border-white/10" aria-label="Chapter quests">
        {dupInfo.map(({ q, dupIndex, dupTotal }) => (
          <QuestCard key={q.qid} q={q} dupIndex={dupIndex} dupTotal={dupTotal} />
        ))}
      </div>
    </div>
  );
}
