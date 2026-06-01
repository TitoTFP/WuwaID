import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { useMemo, useState } from "react";
import { api } from "../lib/api";
import LineList from "../components/editor/LineList";

export default function EditorPage() {
  const { qid = "0" } = useParams();
  const qidN = Number(qid);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const linesQ = useQuery({
    queryKey: ["editor", "lines", qidN],
    queryFn: () => api.editorQuestLines(qidN),
    enabled: !!qidN,
  });

  const lines = useMemo(() => linesQ.data ?? [], [linesQ.data]);

  return (
    <div className="container-narrow">
      <div className="mb-3">
        <Link
          to={qidN ? `/quests/${qidN}` : "/"}
          className="link text-xs"
        >
          ← back to viewer
        </Link>
        <h1 className="mt-1 font-serif text-2xl text-slate-100">
          Editor · quest #{qidN}
        </h1>
      </div>
      <div className="grid grid-cols-[18rem_1fr] gap-4 min-h-[60vh]">
        <aside className="card p-2 overflow-auto max-h-[80vh]">
          {linesQ.isLoading && (
            <div className="text-xs text-slate-500 p-2">Loading lines…</div>
          )}
          {linesQ.error && (
            <div className="text-xs text-rose-400 p-2">Failed to load lines.</div>
          )}
          {lines.length > 0 && (
            <LineList
              lines={lines}
              selectedId={selectedId}
              onSelect={setSelectedId}
              pendingCounts={{}}
            />
          )}
        </aside>
        <section className="card p-4">
          {selectedId === null ? (
            <div className="text-sm text-slate-500">
              Select a line on the left to edit it. (Form coming in next task.)
            </div>
          ) : (
            <div className="text-sm text-slate-300">
              Editing line #{selectedId}. (Form coming in next task.)
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
