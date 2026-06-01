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
    <div className="container-narrow space-y-6">
      <div>
        <Link to="/" className="link text-xs">← home</Link>
        <h1 className="mt-1 font-serif text-2xl text-accent-gold">
          {chapter?.name ?? `Chapter ${chid}`}
        </h1>
        <p className="text-xs text-slate-500 mt-1">
          {chapter?.quest_count ?? items.length} quests · {chapter?.line_count.toLocaleString() ?? 0} lines
        </p>
      </div>

      {isLoading && <div className="text-sm text-slate-500">Loading…</div>}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {dupInfo.map(({ q, dupIndex, dupTotal }) => (
          <QuestCard key={q.qid} q={q} dupIndex={dupIndex} dupTotal={dupTotal} />
        ))}
      </div>
    </div>
  );
}
