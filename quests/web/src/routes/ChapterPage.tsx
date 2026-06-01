import { Link, useParams } from "react-router-dom";
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
        {items.map((q) => (
          <QuestCard key={q.qid} q={q} />
        ))}
      </div>
    </div>
  );
}
