import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { useMe } from "../lib/auth";
import { getAuthorLabel } from "../lib/session";
import type { DialogueLine, DialogueTreeNode, DraftPatch, LineSummary, TreeDropPosition } from "../lib/types";
import DialogueTreeView, { applyFilters, type TreeFilters } from "../components/editor/DialogueTreeView";
import LineForm, { TAB_ORDER } from "../components/editor/LineForm";
import DraftBanner from "../components/editor/DraftBanner";
import ShortcutsHelp from "../components/editor/ShortcutsHelp";
import ResizeHandle from "../components/editor/ResizeHandle";
import Skeleton from "../components/editor/Skeleton";
import { useGlobalHotkeys } from "../lib/keyboard";
import { useToast } from "../components/Toast";
import { useUnsavedGuard } from "../lib/useUnsavedGuard";

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
        localIndex: (flow.children?.length ?? 0) + 1,
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

function collectLineIds(nodes: DialogueTreeNode[]): number[] {
  const out: number[] = [];
  function walk(list: DialogueTreeNode[]) {
    for (const n of list) {
      if (n.kind === "line" && n.line) out.push(n.line.id);
      else if (n.children) walk(n.children);
    }
  }
  walk(nodes);
  return out;
}

export default function EditorPage() {
  const { qid = "0" } = useParams();
  const qidN = Number(qid);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
  const [searchQ, setSearchQ] = useState("");
  const [previewLines, setPreviewLines] = useState<DialogueLine[]>([]);
  const [reorderPreview, setReorderPreview] = useState<ReorderPreview[]>([]);
  const [tab, setTab] = useState<"en" | "zh-Hans" | "ja" | "META">("META");
  const [filters, setFilters] = useState<TreeFilters>({
    editedOnly: false,
    pendingOnly: false,
    hasOptionsOnly: false,
    type: null,
  });
  const [showHelp, setShowHelp] = useState(false);
  const [multiLang, setMultiLang] = useState(false);
  const queryClient = useQueryClient();
  const meQ = useMe();
  const role = meQ.data?.role ?? "anon";
  const authorLabel = getAuthorLabel();
  const toast = useToast();

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
    mutationFn: (params: { patch: DraftPatch; note: string }) =>
      api.createDraft(
        { qid: qidN, line_id: selectedId!, patch: params.patch, note: params.note || undefined },
        authorLabel,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["drafts"] });
      toast.success("Draft saved");
    },
    onError: () => toast.error("Failed to save draft"),
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
      toast.success("Reorder drafts saved");
    },
    onError: () => toast.error("Failed to save reorder drafts"),
  });

  const draftsQ = useQuery({
    queryKey: ["drafts", role === "editor" ? "editor" : authorLabel],
    queryFn: () => api.listDrafts(role === "editor" ? null : authorLabel),
    enabled: !!meQ.data,
  });

  useEffect(() => {
    setPreviewLines(questQ.data?.all_lines ?? []);
    setReorderPreview([]);
    setSelectedId(null);
    setSelectedIds(new Set());
    setSearchQ("");
  }, [qidN, questQ.data?.quest_id, questQ.data?.all_lines]);

  const lines = linesQ.data ?? [];
  const previewLineMap = useMemo(() => {
    const m = new Map<number, DialogueLine>();
    for (const l of previewLines) m.set(l.id, l);
    return m;
  }, [previewLines]);
  const originalLineMap = useMemo(() => {
    const m = new Map<number, DialogueLine>();
    for (const l of questQ.data?.all_lines ?? []) m.set(l.id, l);
    return m;
  }, [questQ.data]);
  const selectedLine = selectedId !== null ? (previewLineMap.get(selectedId) ?? null) : null;
  const originalSelectedLine = selectedId !== null ? (originalLineMap.get(selectedId) ?? null) : null;
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
  const searchedTree = useMemo(() => filterEditorTree(tree, searchQ), [tree, searchQ]);
  const pendingCountsById = useMemo(() => {
    const acc: Record<number, number> = {};
    for (const draft of draftsQ.data ?? []) {
      if (draft.qid !== qidN || draft.status !== "pending") continue;
      acc[draft.line_id] = (acc[draft.line_id] ?? 0) + 1;
    }
    return acc;
  }, [draftsQ.data, qidN]);
  const filteredTree = useMemo(
    () => applyFilters(searchedTree, filters, pendingCountsById),
    [searchedTree, filters, pendingCountsById],
  );
  const searchMatchCount = useMemo(() => countTreeLines(searchedTree), [searchedTree]);

  const allLineIds = useMemo(() => collectLineIds(tree), [tree]);
  const lineIdIndex = useMemo(() => {
    const map = new Map<number, number>();
    allLineIds.forEach((id, idx) => map.set(id, idx));
    return map;
  }, [allLineIds]);

  const typesInQuest = useMemo(() => {
    const set = new Set<string>();
    for (const line of previewLines) set.add(String(line.type));
    return Array.from(set).sort();
  }, [previewLines]);

  // For each line, list of options that point at it (for backlinks panel).
  // Built once so the backlinks useMemo is O(1) instead of O(N×M).
  const optIndex = useMemo(() => {
    const idx = new Map<number, { fromId: number; fromType: string; snippet: string }[]>();
    for (const line of previewLines) {
      for (const opt of line.options ?? []) {
        let targetId: number | undefined;
        if (typeof opt.plot_line_id === "number") {
          targetId = opt.plot_line_id;
        } else if (opt.plot_line_key) {
          targetId = previewLineMap.get(parseInt(opt.plot_line_key.split("_").pop() ?? "0", 10))?.id;
          if (targetId == null) {
            // Fall back: scan all_lines via text_key (rare case)
            for (const l of previewLines) {
              if (l.text_key === opt.plot_line_key) { targetId = l.id; break; }
            }
          }
        }
        if (targetId == null) continue;
        if (!idx.has(targetId)) idx.set(targetId, []);
        idx.get(targetId)!.push({
          fromId: line.id,
          fromType: line.type,
          snippet: (opt.text_en || opt["text_zh-Hans"] || opt.text_ja || "").slice(0, 60),
        });
      }
    }
    return idx;
  }, [previewLines, previewLineMap]);

  // For jumpToLine: state_id.sub_id → first matching line. User-triggered but
  // cheap to keep memoized.
  const stateKeyIndex = useMemo(() => {
    const m = new Map<string, DialogueLine>();
    for (const l of previewLines) {
      const parsed = parseStateKey(l.state_key ?? "");
      if (parsed) {
        const k = `${parsed.stateId}.${parsed.subId}`;
        if (!m.has(k)) m.set(k, l);
      }
    }
    return m;
  }, [previewLines]);

  // For LineForm handleMoveState: state_key → lines in that state.
  const linesByState = useMemo(() => {
    const m = new Map<string, DialogueLine[]>();
    for (const l of previewLines) {
      const k = l.state_key || "";
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(l);
    }
    return m;
  }, [previewLines]);

  // For LineForm handleMoveState: flowName → ordered state_keys (preserves
  // encounter order). Replaces the O(N²) filter+includes inside LineForm.
  const stateOrderByFlow = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const l of previewLines) {
      const parsed = parseStateKey(l.state_key ?? "");
      const flow = parsed?.flowName || "Ungrouped";
      const key = l.state_key || "";
      if (!key) continue;
      if (!m.has(flow)) m.set(flow, []);
      const arr = m.get(flow)!;
      if (!arr.includes(key)) arr.push(key);
    }
    return m;
  }, [previewLines]);

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
    setPreviewLines(nextOrder.flatMap((id) => (byId.get(id) ? [byId.get(id)!] : [])));

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

  const selectById = useCallback(
    (id: number) => {
      setSelectedId(id);
      setSelectedIds(new Set());
    },
    [],
  );

  const selectRelative = useCallback(
    (direction: 1 | -1) => {
      if (selectedId === null) {
        if (allLineIds.length > 0) selectById(allLineIds[0]);
        return;
      }
      const idx = lineIdIndex.get(selectedId);
      if (idx === undefined) return;
      const next = allLineIds[idx + direction];
      if (next !== undefined) selectById(next);
    },
    [selectedId, allLineIds, lineIdIndex, selectById],
  );

  const jumpToLine = useCallback(
    (raw: string) => {
      const clean = raw.trim().replace(/^#/, "");
      if (!clean) return;

      // Try matching state ID (e.g., 119000000.1)
      const stateMatch = clean.match(/^(\d+)\.(\d+)$/);
      if (stateMatch) {
        const k = `${stateMatch[1]}.${stateMatch[2]}`;
        const matchLine = stateKeyIndex.get(k);
        if (matchLine) {
          selectById(matchLine.id);
          toast.success(`Jumped to state ${stateMatch[1]}.${stateMatch[2]}`);
          return;
        }
      }

      // Try matching line ID
      const lineId = Number(clean);
      if (Number.isInteger(lineId) && allLineIds.includes(lineId)) {
        selectById(lineId);
        toast.success(`Jumped to #${lineId}`);
      } else {
        toast.error(`Line/state "${raw}" not found in this quest`);
      }
    },
    [allLineIds, stateKeyIndex, selectById, toast],
  );

  const onSelectMany = useCallback((ids: number[], replace: boolean) => {
    setSelectedIds((current) => {
      const next = replace ? new Set<number>() : new Set(current);
      for (const id of ids) {
        if (next.has(id)) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }, []);

  const clearMultiSelect = useCallback(() => setSelectedIds(new Set()), []);

  const tabCycle = useCallback((dir: 1 | -1) => {
    setTab((current) => {
      const idx = TAB_ORDER.indexOf(current);
      if (idx < 0) return "en";
      const next = (idx + dir + TAB_ORDER.length) % TAB_ORDER.length;
      return TAB_ORDER[next];
    });
  }, []);

  const dirty = submitQ.isPending || (reorderPreview.length > 0);
  useUnsavedGuard(dirty);

  useGlobalHotkeys([
    { key: "j", handler: () => selectRelative(1) },
    { key: "k", handler: () => selectRelative(-1) },
    { key: "s", handler: (event) => {
        event.preventDefault();
        // submission handled in form via direct ref? simpler: ignore for now
      }, options: { mod: true } },
    { key: "1", handler: () => setTab("en") },
    { key: "2", handler: () => setTab("zh-Hans") },
    { key: "3", handler: () => setTab("ja") },
    { key: "4", handler: () => setTab("META") },
    { key: "[", handler: () => tabCycle(-1) },
    { key: "]", handler: () => tabCycle(1) },
    { key: "?", handler: () => setShowHelp((v) => !v), options: { shift: true } },
    { key: "Escape", handler: () => { setShowHelp(false); if (searchQ) setSearchQ(""); } },
  ]);

  const backlinks = useMemo(() => {
    if (!selectedLine) return [] as { fromId: number; fromType: string; snippet: string }[];
    return optIndex.get(selectedLine.id) ?? [];
  }, [selectedLine, optIndex]);

  const breadcrumb = useMemo(() => {
    if (!selectedLine) return null;
    const parsed = parseStateKey(selectedLine.state_key ?? "");
    const flow = parsed?.flowName || "Ungrouped";
    const state = parsed ? `state ${parsed.stateId}.${parsed.subId}` : selectedLine.state_key;
    return { flow, state, line: selectedLine.id };
  }, [selectedLine]);

  return (
    <div className="container-wide flex-1 flex flex-col overflow-hidden">
      <div className="mb-3">
        <Link
          to={qidN ? `/quests/${qidN}` : "/"}
          className="link text-xs"
        >
          ← back to viewer
        </Link>
        <div className="mt-1 flex flex-wrap items-baseline justify-between gap-3">
          <h1 className="font-serif text-2xl text-slate-100">
            Editor · quest #{qidN}
            <span className="ml-2 text-sm text-slate-400">{questQ.data?.quest_name ?? "…"}</span>
          </h1>
          <button
            type="button"
            className="btn text-xs"
            onClick={() => setShowHelp(true)}
            title="Show keyboard shortcuts"
            aria-label="Show keyboard shortcuts"
          >
            ?
          </button>
        </div>
        {breadcrumb && (
          <div className="mt-1 text-[11px] text-slate-500">
            <span>quest #{qidN}</span>
            <span className="mx-1 text-slate-700">›</span>
            <span>{breadcrumb.flow}</span>
            <span className="mx-1 text-slate-700">›</span>
            <span>{breadcrumb.state}</span>
            <span className="mx-1 text-slate-700">›</span>
            <span className="text-slate-300">line #{breadcrumb.line}</span>
          </div>
        )}
        {reorderPreview.length > 0 && (
          <div className="card mt-3 flex flex-col gap-3 border-accent-gold/20 bg-accent-gold/5 p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
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
            <ul className="space-y-1 text-xs text-slate-300">
              {reorderPreview.map((change) => (
                <li
                  key={change.line_id}
                  className="flex items-center justify-between gap-2 rounded border border-white/5 bg-bg-1/40 px-2 py-1"
                >
                  <span className="font-mono">
                    #<span className="text-slate-400">{change.line_id}</span>{" "}
                    <span className="text-slate-500">→</span>{" "}
                    {change.position_after === null ? (
                      <span className="text-slate-500">top</span>
                    ) : (
                      <span>after #{change.position_after}</span>
                    )}
                  </span>
                  <button
                    type="button"
                    className="text-rose-300 hover:text-rose-200"
                    onClick={() =>
                      setReorderPreview((current) => current.filter((d) => d.line_id !== change.line_id))
                    }
                  >
                    ↶
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <DraftBanner qid={qidN} />
        {selectedIds.size > 1 && (
          <div className="card mt-3 flex flex-wrap items-center justify-between gap-2 border-accent-teal/30 bg-accent-teal/5 p-2 text-xs text-slate-200">
            <span>
              {selectedIds.size} lines selected
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                className="btn text-xs"
                onClick={() => {
                  const ids = Array.from(selectedIds);
                  if (!ids.length) return;
                  moveBlock(ids, [ids[ids.length - 1]], "after");
                  toast.success(`Moved ${ids.length} lines`);
                }}
              >
                Move to end
              </button>
              <button type="button" className="btn text-xs" onClick={clearMultiSelect}>
                Clear
              </button>
            </div>
          </div>
        )}
      </div>
      <div className="flex flex-1 min-h-0 gap-4">
        <div className="flex w-[22rem] max-w-full shrink-0 relative">
          <aside className="card flex-1 flex flex-col overflow-hidden p-2">
            {linesQ.isLoading && questQ.isLoading && (
              <div className="p-2">
                <Skeleton lines={6} />
              </div>
            )}
            {tree.length > 0 && (
              <DialogueTreeView
                nodes={filteredTree}
                selectedId={selectedId}
                onSelect={selectById}
                pendingCounts={pendingCountsById}
                searchQ={searchQ}
                onSearchChange={setSearchQ}
                searchMatchCount={searchMatchCount}
                totalLineCount={previewLines.length || lines.length}
                filters={filters}
                onFiltersChange={setFilters}
                types={typesInQuest}
                onMoveBlock={moveBlock}
                onJumpToLine={jumpToLine}
                activeLang={tab === "META" ? "en" : tab}
                selectedIds={selectedIds}
                onSelectMany={onSelectMany}
                storageKeyOpen={`editor:open:${qidN}`}
                storageKeyReview={`editor:review:${qidN}`}
              />
            )}
            {saveReorderQ.error && (
              <div className="text-xs text-rose-400 p-2">Failed to save structure draft.</div>
            )}
          </aside>
          <ResizeHandle storageKey={`editor:tree-width:${qidN}`} min={240} max={960} />
        </div>
        <section className="card flex-1 flex flex-col p-4 min-h-0 overflow-y-auto">
          {selectedId === null ? (
            <div className="flex h-full flex-col items-center justify-center text-sm text-slate-500">
              <p>Select a line on the left, or press <kbd className="rounded border border-white/10 bg-bg-2 px-1 text-[10px] text-slate-300">/</kbd> to focus search.</p>
              <p className="mt-1 text-[11px] text-slate-600">Press <kbd className="rounded border border-white/10 bg-bg-2 px-1 text-[10px] text-slate-300">?</kbd> for shortcuts.</p>
            </div>
          ) : questQ.isLoading ? (
            <Skeleton variant="form" />
          ) : questQ.error ? (
            <div className="text-sm text-rose-400">Failed to load quest.</div>
          ) : selectedLine ? (
            <div className="flex h-full flex-col gap-3">
              <div className="flex items-center justify-between">
                <div className="text-[10px] uppercase tracking-widest text-slate-500">Edit line</div>
                <label className="flex items-center gap-1 text-[10px] text-slate-500">
                  <input
                    type="checkbox"
                    checked={multiLang}
                    onChange={(e) => setMultiLang(e.target.checked)}
                    className="accent-accent-gold"
                  />
                  3-lang view
                </label>
              </div>
              <LineForm
                line={selectedLine}
                originalLine={originalSelectedLine ?? selectedLine}
                qid={qidN}
                tab={tab}
                onTabChange={setTab}
                busy={submitQ.isPending}
                onPreview={previewLineEdit}
                onSubmit={(patch, note) => submitQ.mutate({ patch, note })}
                onSelectNext={(dir) => {
                  setTab("META");
                  selectRelative(dir);
                }}
                allLines={previewLines}
                linesByState={linesByState}
                stateOrderByFlow={stateOrderByFlow}
                multiLang={multiLang}
                onMoveBlock={moveBlock}
              />
              {backlinks.length > 0 && (
                <details className="rounded-md border border-white/10 bg-bg-1/40 p-2 text-xs">
                  <summary className="cursor-pointer text-slate-300">
                    Backlinks · {backlinks.length} line(s) jump here
                  </summary>
                  <ul className="mt-2 space-y-1">
                    {backlinks.map((link) => (
                      <li
                        key={link.fromId}
                        className="flex items-center gap-2"
                      >
                        <button
                          type="button"
                          className="link text-xs"
                          onClick={() => selectById(link.fromId)}
                        >
                          #{link.fromId} · {link.fromType}
                        </button>
                        {link.snippet && (
                          <span className="truncate text-slate-500">— {link.snippet}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          ) : (
            <div className="text-sm text-slate-500">
              Line #{selectedId} was not found in this quest.
            </div>
          )}
        </section>
      </div>
      <ShortcutsHelp open={showHelp} onClose={() => setShowHelp(false)} />
    </div>
  );
}
