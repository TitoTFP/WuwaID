import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { useState } from "react";
import { api } from "../lib/api";
import { getAuthorLabel } from "../lib/session";
import type { DraftPatch } from "../lib/types";
import LineList from "../components/editor/LineList";
import LineForm from "../components/editor/LineForm";

export default function EditorPage() {
  const { qid = "0" } = useParams();
  const qidN = Number(qid);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const queryClient = useQueryClient();

  const linesQ = useQuery({
    queryKey: ["editor", "lines", qidN],
    queryFn: () => api.editorQuestLines(qidN),
    enabled: !!qidN,
  });

  const questQ = useQuery({
    queryKey: ["editor", "quest", qidN],
    queryFn: () => api.editorQuest(qidN),
    enabled: !!qidN,
  });

  const submitQ = useMutation({
    mutationFn: (patch: DraftPatch) =>
      api.createDraft(
        { qid: qidN, line_id: selectedId!, patch },
        getAuthorLabel(),
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["editor", "lines", qidN] });
      queryClient.invalidateQueries({ queryKey: ["editor", "quest", qidN] });
    },
  });

  const lines = linesQ.data ?? [];
  const selectedLine = questQ.data?.all_lines.find((line) => line.id === selectedId) ?? null;

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
              Select a line on the left to edit it.
            </div>
          ) : questQ.isLoading ? (
            <div className="text-sm text-slate-500">Loading line…</div>
          ) : questQ.error ? (
            <div className="text-sm text-rose-400">Failed to load quest.</div>
          ) : selectedLine ? (
            <div className="space-y-3">
              <LineForm
                line={selectedLine}
                busy={submitQ.isPending}
                onSubmit={(patch) => submitQ.mutate(patch)}
              />
              {submitQ.error && (
                <div className="text-xs text-rose-400">Failed to save draft.</div>
              )}
              {submitQ.isSuccess && (
                <div className="text-xs text-accent-gold">Draft saved.</div>
              )}
            </div>
          ) : (
            <div className="text-sm text-slate-500">
              Line #{selectedId} was not found in this quest.
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
