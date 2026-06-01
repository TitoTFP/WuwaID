import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { useState } from "react";
import { api } from "../lib/api";
import { useMe } from "../lib/auth";
import { getAuthorLabel } from "../lib/session";
import type { DraftPatch, LineSummary } from "../lib/types";
import LineList from "../components/editor/LineList";
import LineForm from "../components/editor/LineForm";
import DraftBanner from "../components/editor/DraftBanner";

export default function EditorPage() {
  const { qid = "0" } = useParams();
  const qidN = Number(qid);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const queryClient = useQueryClient();
  const meQ = useMe();
  const role = meQ.data?.role ?? "anon";
  const authorLabel = getAuthorLabel();

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
        authorLabel,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["editor", "lines", qidN] });
      queryClient.invalidateQueries({ queryKey: ["editor", "quest", qidN] });
      queryClient.invalidateQueries({ queryKey: ["drafts"] });
    },
  });

  const structureQ = useMutation({
    mutationFn: (draft: { line_id: number; patch: DraftPatch; position_after?: number | null }) =>
      api.createDraft({ qid: qidN, ...draft }, authorLabel),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["drafts"] });
    },
  });

  const draftsQ = useQuery({
    queryKey: ["drafts", role === "editor" ? "editor" : authorLabel],
    queryFn: () => api.listDrafts(role === "editor" ? null : authorLabel),
    enabled: !!meQ.data,
  });

  const lines = linesQ.data ?? [];
  const selectedLine = questQ.data?.all_lines.find((line) => line.id === selectedId) ?? null;
  const pendingCounts = (draftsQ.data ?? [])
    .filter((draft) => draft.qid === qidN && draft.status === "pending")
    .reduce<Record<number, number>>((acc, draft) => {
      acc[draft.line_id] = (acc[draft.line_id] ?? 0) + 1;
      return acc;
    }, {});

  const indexOf = (lineId: number) => lines.findIndex((line) => line.id === lineId);
  const moveLine = (lineId: number, direction: -1 | 1) => {
    const idx = indexOf(lineId);
    const targetIdx = idx + direction;
    if (idx < 0 || targetIdx < 0 || targetIdx >= lines.length) return;
    const previous = direction < 0 ? lines[targetIdx - 1] : lines[targetIdx];
    structureQ.mutate({
      line_id: lineId,
      patch: { _op: "reorder" },
      position_after: previous?.id ?? null,
    });
  };
  const insertAfter = (lineId: number) => {
    const anchor = lines.find((line) => line.id === lineId) as LineSummary | undefined;
    structureQ.mutate({
      line_id: 0,
      position_after: lineId,
      patch: {
        type: "Talk",
        state_key: anchor?.state_key ?? "",
        text_key: `draft_${Date.now()}`,
        speaker_en: "",
        "speaker_zh-Hans": "",
        speaker_ja: "",
        text_en: "",
        "text_zh-Hans": "",
        text_ja: "",
      },
    });
  };

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
        <DraftBanner qid={qidN} />
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
              pendingCounts={pendingCounts}
              onMoveUp={(id) => moveLine(id, -1)}
              onMoveDown={(id) => moveLine(id, 1)}
              onInsertAfter={insertAfter}
            />
          )}
          {structureQ.error && (
            <div className="text-xs text-rose-400 p-2">Failed to save structure draft.</div>
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
