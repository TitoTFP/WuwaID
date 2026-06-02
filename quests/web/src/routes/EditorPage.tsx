import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { useMe } from "../lib/auth";
import { getAuthorLabel } from "../lib/session";
import type { DialogueLine, DialogueTreeNode, DraftPatch, LineSummary, TreeDropPosition } from "../lib/types";
import DialogueTreeView from "../components/editor/DialogueTreeView";
import LineForm from "../components/editor/LineForm";
import DraftBanner from "../components/editor/DraftBanner";

type ReorderPreview = { line_id: number; position_after: number | null };

const STATE_KEY_RE = /^(.*)_(\d+)_(\d+)$/;

function parseStateKey(stateKey: string) {
  const match = stateKey.match(STATE_KEY_RE);
  if (!match) return null;
  return {
    flowName: match[1],
    stateId: Number(match[2]),
    subId: Number(match[3]),
  };
}

function buildEditorTree(
  allLines: DialogueLine[],
  summaries: LineSummary[],
  plotModeByKey: Map<string, string>,
): DialogueTreeNode[] {
  const summaryById = new Map(summaries.map((line) => [line.id, line]));
  const flows: DialogueTreeNode[] = [];
  const flowByName = new Map<string, DialogueTreeNode>();
  const stateByKey = new Map<string, DialogueTreeNode>();

  for (const line of allLines) {
    const parsed = parseStateKey(line.state_key ?? "");
    const flowName = parsed?.flowName || "Ungrouped";
    const stateKey = line.state_key || "ungrouped";
    let flow = flowByName.get(flowName);
    if (!flow) {
      flow = {
        id: `flow:${flowName}`,
        kind: "flow",
        label: flowName || "Scene",
        flowName,
        lineIds: [],
        children: [],
      };
      flowByName.set(flowName, flow);
      flows.push(flow);
    }

    let state = stateByKey.get(stateKey);
    if (!state) {
      state = {
        id: `state:${stateKey}`,
        kind: "state",
        label: parsed ? `state ${parsed.stateId}.${parsed.subId}` : stateKey,
        flowName,
        stateKey,
        stateId: parsed?.stateId,
        subId: parsed?.subId,
        plotMode: plotModeByKey.get(stateKey) ?? "Normal",
        lineIds: [],
        children: [],
      };
      stateByKey.set(stateKey, state);
      flow.children?.push(state);
    }

    const summary = summaryById.get(line.id);
    const treeLine: DialogueLine & { is_edited?: boolean } = {
      ...line,
      speaker_en: summary?.speaker_en ?? line.speaker_en,
      text_en: summary?.text_en ?? line.text_en,
      type: summary?.type ?? line.type,
      state_key: summary?.state_key ?? line.state_key,
      is_edited: summary?.is_edited ?? false,
    };
    const leaf: DialogueTreeNode = {
      id: `line:${line.id}`,
      kind: "line",
      label: `#${line.id}`,
      flowName,
      stateKey,
      line: treeLine,
      lineIds: [line.id],
    };
    state.children?.push(leaf);
    state.lineIds.push(line.id);
    flow.lineIds.push(line.id);
  }

  return flows;
}

function lineMatchesSearch(line: DialogueLine & { is_edited?: boolean }, query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [
    String(line.id),
    line.type,
    line.state_key,
    line.text_key,
    line.speaker_en,
    line["speaker_zh-Hans"],
    line.speaker_ja,
    line.text_en,
    line["text_zh-Hans"],
    line.text_ja,
  ].some((value) => String(value ?? "").toLowerCase().includes(q));
}

function filterEditorTree(nodes: DialogueTreeNode[], query: string): DialogueTreeNode[] {
  const q = query.trim();
  if (!q) return nodes;
  const filtered: DialogueTreeNode[] = [];
  for (const node of nodes) {
    if (node.kind === "line") {
      if (node.line && lineMatchesSearch(node.line, q)) filtered.push(node);
      continue;
    }
    const children = filterEditorTree(node.children ?? [], q);
    if (children.length) {
      filtered.push({
        ...node,
        children,
        lineIds: children.flatMap((child) => child.lineIds),
      });
    }
  }
  return filtered;
}

function countTreeLines(nodes: DialogueTreeNode[]) {
  let total = 0;
  for (const node of nodes) {
    if (node.kind === "line") total += 1;
    else total += countTreeLines(node.children ?? []);
  }
  return total;
}

export default function EditorPage() {
  const { qid = "0" } = useParams();
  const qidN = Number(qid);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [searchQ, setSearchQ] = useState("");
  const [previewLines, setPreviewLines] = useState<DialogueLine[]>([]);
  const [reorderPreview, setReorderPreview] = useState<ReorderPreview[]>([]);
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
      queryClient.invalidateQueries({ queryKey: ["drafts"] });
    },
  });

  const saveReorderQ = useMutation({
    mutationFn: async (drafts: ReorderPreview[]) => {
      for (const draft of drafts) {
        await api.createDraft(
          {
            qid: qidN,
            line_id: draft.line_id,
            patch: { _op: "reorder" },
            position_after: draft.position_after,
          },
          authorLabel,
        );
      }
    },
    onSuccess: () => {
      setReorderPreview([]);
      queryClient.invalidateQueries({ queryKey: ["drafts"] });
    },
  });

  const draftsQ = useQuery({
    queryKey: ["drafts", role === "editor" ? "editor" : authorLabel],
    queryFn: () => api.listDrafts(role === "editor" ? null : authorLabel),
    enabled: !!meQ.data,
  });

  useEffect(() => {
    setPreviewLines(questQ.data?.all_lines ?? []);
    setReorderPreview([]);
  }, [questQ.data?.quest_id, questQ.data?.all_lines]);

  const lines = linesQ.data ?? [];
  const selectedLine = previewLines.find((line) => line.id === selectedId) ?? null;
  const originalSelectedLine = questQ.data?.all_lines.find((line) => line.id === selectedId) ?? null;
  const plotModeByKey = useMemo(() => {
    const map = new Map<string, string>();
    for (const flow of questQ.data?.flows ?? []) {
      for (const state of flow.states ?? []) map.set(state.state_key, state.plot_mode);
    }
    return map;
  }, [questQ.data]);
  const tree = useMemo(
    () => buildEditorTree(previewLines, lines, plotModeByKey),
    [previewLines, lines, plotModeByKey],
  );
  const filteredTree = useMemo(() => filterEditorTree(tree, searchQ), [tree, searchQ]);
  const searchMatchCount = useMemo(() => countTreeLines(filteredTree), [filteredTree]);
  const pendingCounts = (draftsQ.data ?? [])
    .filter((draft) => draft.qid === qidN && draft.status === "pending")
    .reduce<Record<number, number>>((acc, draft) => {
      acc[draft.line_id] = (acc[draft.line_id] ?? 0) + 1;
      return acc;
    }, {});

  const moveBlock = (
    movedLineIds: number[],
    targetLineIds: number[],
    position: TreeDropPosition,
  ) => {
    if (!movedLineIds.length || !targetLineIds.length) return;
    const moved = movedLineIds.filter((id) => previewLines.some((line) => line.id === id));
    if (!moved.length) return;
    const remaining = previewLines.map((line) => line.id).filter((id) => !moved.includes(id));
    const targetAnchorId = position === "before" ? targetLineIds[0] : targetLineIds[targetLineIds.length - 1];
    const targetIndex = remaining.findIndex((id) => id === targetAnchorId);
    if (targetIndex < 0) return;
    const insertAt = position === "after" || position === "inside" ? targetIndex + 1 : targetIndex;
    const nextOrder = [...remaining.slice(0, insertAt), ...moved, ...remaining.slice(insertAt)];
    const currentOrder = previewLines.map((line) => line.id).join(",");
    if (nextOrder.join(",") === currentOrder) return;

    const byId = new Map(previewLines.map((line) => [line.id, line]));
    setPreviewLines(nextOrder.flatMap((id) => byId.get(id) ? [byId.get(id)!] : []));

    const drafts: ReorderPreview[] = [];
    let anchor: number | null = insertAt > 0 ? remaining[insertAt - 1] : null;
    for (const lineId of moved) {
      drafts.push({ line_id: lineId, position_after: anchor });
      anchor = lineId;
    }
    setReorderPreview((current) => {
      const next = current.filter((draft) => !moved.includes(draft.line_id));
      return [...next, ...drafts];
    });
  };

  const resetPreview = () => {
    setPreviewLines(questQ.data?.all_lines ?? []);
    setReorderPreview([]);
  };

  const previewLineEdit = (line: DialogueLine) => {
    setPreviewLines((current) => current.map((item) => (item.id === line.id ? line : item)));
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
        {reorderPreview.length > 0 && (
          <div className="card mt-3 flex flex-wrap items-center justify-between gap-3 border-accent-gold/20 bg-accent-gold/5 p-3 text-sm">
            <div>
              <div className="text-slate-200">
                Previewing {reorderPreview.length} unsaved reorder {reorderPreview.length === 1 ? "change" : "changes"}.
              </div>
              <div className="text-xs text-slate-500">
                Tree order updates immediately. Save to create review drafts.
              </div>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                className="btn btn-active text-xs"
                disabled={saveReorderQ.isPending}
                onClick={() => saveReorderQ.mutate(reorderPreview)}
              >
                {saveReorderQ.isPending ? "Saving..." : "Save reorder drafts"}
              </button>
              <button type="button" className="btn text-xs" onClick={resetPreview}>
                Reset preview
              </button>
            </div>
          </div>
        )}
        <DraftBanner qid={qidN} />
      </div>
      <div className="grid min-h-[60vh] gap-4 lg:grid-cols-[22rem_1fr]">
        <aside className="card max-h-[80vh] overflow-auto p-2 lg:sticky lg:top-4">
          {linesQ.isLoading && (
            <div className="text-xs text-slate-500 p-2">Loading lines…</div>
          )}
          {linesQ.error && (
            <div className="text-xs text-rose-400 p-2">Failed to load lines.</div>
          )}
          {tree.length > 0 && (
            <DialogueTreeView
              nodes={filteredTree}
              selectedId={selectedId}
              onSelect={setSelectedId}
              pendingCounts={pendingCounts}
              searchQ={searchQ}
              onSearchChange={setSearchQ}
              searchMatchCount={searchMatchCount}
              totalLineCount={previewLines.length || lines.length}
              onMoveBlock={moveBlock}
            />
          )}
          {saveReorderQ.error && (
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
                originalLine={originalSelectedLine ?? selectedLine}
                busy={submitQ.isPending}
                onPreview={previewLineEdit}
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
