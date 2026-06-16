import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { useMe } from "../lib/auth";
import { getAuthorLabel } from "../lib/session";
import type { DialogueLine, DialogueTreeNode, DraftPatch, LineSummary } from "../lib/types";
import DialogueTreeView, { applyFilters, type TreeFilters } from "../components/editor/DialogueTreeView";
import TranslatorForm from "../components/editor/TranslatorForm";
import DraftBanner from "../components/editor/DraftBanner";
import ShortcutsHelp from "../components/editor/ShortcutsHelp";
import ResizeHandle from "../components/editor/ResizeHandle";
import Skeleton from "../components/editor/Skeleton";
import { useGlobalHotkeys } from "../lib/keyboard";
import { useToast } from "../components/Toast";
import { useUnsavedGuard } from "../lib/useUnsavedGuard";

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
    line.speaker_id,
    line.text_en,
    line["text_zh-Hans"],
    line.text_ja,
    line.text_id,
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

export default function TranslatorPage() {
  const { qid = "0" } = useParams();
  const qidN = Number(qid);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [searchQ, setSearchQ] = useState("");
  const [previewLines, setPreviewLines] = useState<DialogueLine[]>([]);
  const [filters, setFilters] = useState<TreeFilters>({
    editedOnly: false,
    pendingOnly: false,
    hasOptionsOnly: false,
    untranslatedOnly: false,
    type: null,
  });
  const [showHelp, setShowHelp] = useState(false);
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
      // Invalidate quest details so the progress tracker and tree lines refresh
      queryClient.invalidateQueries({ queryKey: ["editor", "quest", qidN] });
      toast.success("Draft saved");
    },
    onError: () => toast.error("Failed to save draft"),
  });

  const draftsQ = useQuery({
    queryKey: ["drafts", role === "editor" ? "editor" : authorLabel],
    queryFn: () => api.listDrafts(role === "editor" ? null : authorLabel),
    enabled: !!meQ.data,
  });

  useEffect(() => {
    setPreviewLines(questQ.data?.all_lines ?? []);
    setSelectedId(null);
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

  const previewLineEdit = (line: DialogueLine) => {
    setPreviewLines((current) => current.map((item) => (item.id === line.id ? line : item)));
  };

  const selectById = useCallback(
    (id: number) => {
      setSelectedId(id);
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

  // Indonesian Translation Stats
  const stats = useMemo(() => {
    if (!questQ.data?.all_lines) return { count: 0, percentage: 0 };
    const all = questQ.data.all_lines;
    const linesWithSource = all.filter((l) => l.text_en && l.text_en.trim() !== "");
    if (linesWithSource.length === 0) return { count: 0, percentage: 100 };
    
    // We count a line as translated if text_id has non-empty content
    const count = all.filter((l) => l.text_id && l.text_id.trim() !== "").length;
    const percentage = Math.round((count / linesWithSource.length) * 100);
    return { count, percentage, total: linesWithSource.length };
  }, [questQ.data]);

  const dirty = submitQ.isPending;
  useUnsavedGuard(dirty);

  useGlobalHotkeys([
    { key: "j", handler: () => selectRelative(1) },
    { key: "k", handler: () => selectRelative(-1) },
    { key: "?", handler: () => setShowHelp((v) => !v), options: { shift: true } },
    { key: "Escape", handler: () => { setShowHelp(false); if (searchQ) setSearchQ(""); } },
  ]);

  const breadcrumb = useMemo(() => {
    if (!selectedLine) return null;
    const parsed = parseStateKey(selectedLine.state_key ?? "");
    const flow = parsed?.flowName || "Ungrouped";
    const state = parsed ? `state ${parsed.stateId}.${parsed.subId}` : selectedLine.state_key;
    return { flow, state, line: selectedLine.id };
  }, [selectedLine]);

  return (
    <div className="container-wide flex-1 flex flex-col overflow-hidden">
      <div className="mb-3 space-y-2">
        <div className="flex items-center justify-between">
          <Link
            to={qidN ? `/quests/${qidN}` : "/"}
            className="link text-xs"
          >
            ← back to viewer
          </Link>
          <div className="flex gap-2">
            <Link
              to={`/editor/${qidN}`}
              className="btn text-xs bg-bg-2 hover:bg-white/5"
              title="Edit quest dialogue metadata and ordering flow"
            >
              Structure Editor Mode
            </Link>
            <div className="btn text-xs btn-active border-accent-gold/45 text-accent-gold">
              Indonesian Translation Mode
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h1 className="font-serif text-2xl text-slate-100">
            Translator Workspace · quest #{qidN}
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

        {/* Translation Progress bar */}
        {questQ.data && (
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 bg-bg-2/30 border border-white/5 rounded-md px-3 py-2 text-xs">
            <div className="font-semibold text-slate-300 shrink-0">Indonesian Translation Progress:</div>
            <div className="relative flex-1 h-2.5 bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-accent-gold to-yellow-500 transition-all duration-500 rounded-full"
                style={{ width: `${stats.percentage}%` }}
              />
            </div>
            <div className="font-mono text-slate-400 shrink-0 select-none">
              <span className="text-accent-gold font-bold">{stats.percentage}%</span> ({stats.count} / {stats.total} lines translated)
            </div>
          </div>
        )}

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

        <DraftBanner qid={qidN} />
      </div>

      <div className="flex flex-1 min-h-0 gap-4">
        {/* Dialogue line tree sidebar */}
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
                onJumpToLine={jumpToLine}
                activeLang="id"
                storageKeyOpen={`translator:open:${qidN}`}
                storageKeyReview={`translator:review:${qidN}`}
              />
            )}
          </aside>
          <ResizeHandle storageKey={`translator:tree-width:${qidN}`} min={240} max={960} />
        </div>

        {/* Translation Workbench panel */}
        <section className="card flex-1 flex flex-col p-4 min-h-0 overflow-y-auto">
          {selectedId === null ? (
            <div className="flex h-full flex-col items-center justify-center text-sm text-slate-500">
              <p>Select a dialogue line on the left to start translating.</p>
              <p className="mt-1 text-[11px] text-slate-600">Press <kbd className="rounded border border-white/10 bg-bg-2 px-1 text-[10px] text-slate-300">/</kbd> to search dialogue, or <kbd className="rounded border border-white/10 bg-bg-2 px-1 text-[10px] text-slate-300">?</kbd> for shortcuts.</p>
            </div>
          ) : questQ.isLoading ? (
            <Skeleton variant="form" />
          ) : questQ.error ? (
            <div className="text-sm text-rose-400">Failed to load quest.</div>
          ) : selectedLine ? (
            <div className="flex h-full flex-col gap-3">
              <TranslatorForm
                line={selectedLine}
                originalLine={originalSelectedLine ?? selectedLine}
                qid={qidN}
                busy={submitQ.isPending}
                onPreview={previewLineEdit}
                onSubmit={(patch, note) => submitQ.mutate({ patch, note })}
                onSelectNext={(dir) => {
                  selectRelative(dir);
                }}
                allLines={previewLines}
              />
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
