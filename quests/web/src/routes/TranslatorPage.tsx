import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
import { canEdit, useMe } from "../lib/auth";
import { getAuthorLabel } from "../lib/session";
import type { DialogueLine, DialogueTreeNode, Draft, DraftPatch, LineSummary } from "../lib/types";
import DialogueTreeView, { applyFilters, type TreeFilters } from "../components/editor/DialogueTreeView";
import TranslatorForm from "../components/editor/TranslatorForm";
import DraftBanner from "../components/editor/DraftBanner";
import ShortcutsHelp from "../components/editor/ShortcutsHelp";
import ResizeHandle from "../components/editor/ResizeHandle";
import Skeleton from "../components/editor/Skeleton";
import { useGlobalHotkeys } from "../lib/keyboard";
import { useToast } from "../components/Toast";
import { useUnsavedGuard } from "../lib/useUnsavedGuard";
import { listLocalDraftLineIds, LOCAL_DRAFT_EVENT } from "../lib/useLocalDraft";
import {
  applyDraftPatch,
  dialogueContext,
  isTranslationComplete,
  lineNeedsTranslation,
  nextActionableLineId,
  parseDraftPatch,
  translationStats,
} from "../lib/translatorWorkflow";

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
  const mainMatch = [
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

  if (mainMatch) return true;

  if (line.options && line.options.length > 0) {
    return line.options.some((opt) => [
      opt.text_key,
      opt.text_en,
      opt["text_zh-Hans"],
      opt.text_ja,
      opt.text_id,
    ].some((value) => String(value ?? "").toLowerCase().includes(q)));
  }

  return false;
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
    localDraftOnly: false,
    type: null,
  });
  const [showHelp, setShowHelp] = useState(false);
  const [mobilePane, setMobilePane] = useState<"lines" | "translation">("lines");
  const [localDraftIds, setLocalDraftIds] = useState<Set<number>>(() => listLocalDraftLineIds(qidN));
  const detailTabRef = useRef<HTMLButtonElement>(null);
  const queryClient = useQueryClient();
  const meQ = useMe();
  const role = meQ.data?.role ?? "anon";
  const authorLabel = getAuthorLabel();
  const toast = useToast();

  useEffect(() => {
    if (mobilePane !== "translation" || !window.matchMedia("(max-width: 1023px)").matches) return;
    const frame = requestAnimationFrame(() => detailTabRef.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [mobilePane]);

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
    mutationFn: async (params: { patch: DraftPatch; note: string; draftId?: number }) => {
      if (params.draftId) {
        await api.updateDraft(params.draftId, params.patch, params.note || null, canEdit(role) ? null : authorLabel);
      } else {
        await api.createDraft(
          { qid: qidN, line_id: selectedId!, patch: params.patch, note: params.note || undefined },
          authorLabel,
        );
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["drafts"] });
      toast.success("Draft saved");
    },
    onError: () => toast.error("Failed to save draft"),
  });

  const draftsQ = useQuery({
    queryKey: ["drafts", canEdit(role) ? "editor" : authorLabel],
    queryFn: () => api.listDrafts(canEdit(role) ? null : authorLabel),
    enabled: !!meQ.data,
  });

  useEffect(() => {
    setPreviewLines(questQ.data?.all_lines ?? []);
    setSelectedId(null);
    setSearchQ("");
    setMobilePane("lines");
  }, [qidN, questQ.data?.quest_id, questQ.data?.all_lines]);

  useEffect(() => {
    setLocalDraftIds(listLocalDraftLineIds(qidN));
    const onChange = (event: Event) => {
      const detail = (event as CustomEvent<{ qid: number; lineId: number; hasDraft: boolean }>).detail;
      if (!detail || detail.qid !== qidN) return;
      setLocalDraftIds((current) => {
        const next = new Set(current);
        if (detail.hasDraft) next.add(detail.lineId);
        else next.delete(detail.lineId);
        return next;
      });
    };
    window.addEventListener(LOCAL_DRAFT_EVENT, onChange);
    return () => window.removeEventListener(LOCAL_DRAFT_EVENT, onChange);
  }, [qidN]);

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

  const ownPendingByLine = useMemo(() => {
    const map = new Map<number, Draft>();
    for (const draft of draftsQ.data ?? []) {
      if (draft.qid !== qidN || draft.status !== "pending" || draft.line_id === undefined) continue;
      if (draft.author_label !== authorLabel) continue;
      if (!map.has(draft.line_id)) map.set(draft.line_id, draft);
    }
    return map;
  }, [authorLabel, draftsQ.data, qidN]);
  const selectedPendingDraft = selectedId === null ? undefined : ownPendingByLine.get(selectedId);

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
      if (draft.qid !== qidN || draft.status !== "pending" || draft.line_id === undefined) continue;
      acc[draft.line_id] = (acc[draft.line_id] ?? 0) + 1;
    }
    return acc;
  }, [draftsQ.data, qidN]);

  const filteredTree = useMemo(
    () => applyFilters(searchedTree, filters, pendingCountsById, localDraftIds),
    [searchedTree, filters, pendingCountsById, localDraftIds],
  );
  const searchMatchCount = useMemo(() => countTreeLines(searchedTree), [searchedTree]);
  const allLineIds = useMemo(() => collectLineIds(tree), [tree]);
  const lineIdIndex = useMemo(() => {
    const map = new Map<number, number>();
    allLineIds.forEach((id, idx) => map.set(id, idx));
    return map;
  }, [allLineIds]);

  const effectiveLineMap = useMemo(() => {
    const map = new Map(originalLineMap);
    for (const [lineId, draft] of ownPendingByLine) {
      const line = map.get(lineId);
      if (line) map.set(lineId, applyDraftPatch(line, parseDraftPatch(draft)));
    }
    for (const line of previewLines) {
      if (line.id === selectedId) map.set(line.id, line);
    }
    return map;
  }, [originalLineMap, ownPendingByLine, previewLines, selectedId]);

  const selectedContext = useMemo(
    () => selectedId === null ? { previous: null, next: null } : dialogueContext(allLineIds, selectedId, effectiveLineMap),
    [allLineIds, effectiveLineMap, selectedId],
  );

  const pendingLineIds = useMemo(() => new Set(Object.keys(pendingCountsById).map(Number)), [pendingCountsById]);
  const actionableRemaining = useMemo(
    () => allLineIds.filter((id) => {
      const line = originalLineMap.get(id);
      return line && !pendingLineIds.has(id) && lineNeedsTranslation(line) && !isTranslationComplete(line);
    }).length,
    [allLineIds, originalLineMap, pendingLineIds],
  );

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
      setMobilePane("translation");
    },
    [],
  );

  const selectNextActionable = useCallback(() => {
    if (selectedId === null) return;
    const next = nextActionableLineId(allLineIds, selectedId, originalLineMap, pendingLineIds);
    if (next === null) {
      toast.success("No actionable lines remaining");
      return;
    }
    selectById(next);
  }, [allLineIds, originalLineMap, pendingLineIds, selectById, selectedId, toast]);

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
          return;
        }
      }

      const lineId = Number(clean);
      if (Number.isInteger(lineId) && allLineIds.includes(lineId)) {
        selectById(lineId);
      } else {
        toast.error(`Line/state "${raw}" not found in this quest`);
      }
    },
    [allLineIds, stateKeyIndex, selectById, toast],
  );

  const stats = useMemo(() => translationStats(questQ.data?.all_lines ?? []), [questQ.data]);

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
    <div className="container-wide flex min-h-0 flex-1 flex-col overflow-hidden pb-2">
      <header className="mb-3 border-b border-white/10 pb-3">
        <div className="flex flex-wrap items-center gap-2 border-b border-white/5 pb-2">
          <Link
            to={qidN ? `/quests/${qidN}` : "/"}
            className="link inline-flex min-h-11 items-center whitespace-nowrap text-xs"
          >
            ← Viewer
          </Link>
          <span className="hidden h-4 w-px bg-white/10 sm:block" aria-hidden="true" />
          <div className="flex min-w-0 flex-1 items-baseline gap-2">
            <h1 className="truncate font-serif text-xl text-slate-100 sm:text-2xl">
              Indonesian translator
            </h1>
            <span className="shrink-0 font-mono text-[11px] text-accent-gold">Q{qidN}</span>
            <span className="hidden truncate text-xs text-slate-500 md:inline">
              {questQ.data?.quest_name ?? "Loading quest…"}
            </span>
          </div>
          <nav className="flex gap-1" aria-label="Editor mode">
            <Link
              to={`/editor/${qidN}`}
              className="btn whitespace-nowrap bg-bg-2 text-xs hover:bg-white/5"
              title="Edit quest dialogue metadata and ordering flow"
            >
              Structure
            </Link>
            <span className="btn btn-active whitespace-nowrap border-accent-gold/45 text-xs text-accent-gold" aria-current="page">
              Translation
            </span>
          </nav>
          <button
            type="button"
            className="btn min-w-11 px-0 text-xs"
            onClick={() => setShowHelp(true)}
            title="Show keyboard shortcuts"
            aria-label="Show keyboard shortcuts"
          >
            ?
          </button>
        </div>

        <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
          {questQ.data && (
            <div className="flex min-w-[15rem] flex-1 items-center gap-3 text-xs">
              <span className="shrink-0 font-medium text-slate-400">Quest progress</span>
              <div
                className="relative h-1.5 min-w-16 flex-1 overflow-hidden rounded-sm bg-slate-800"
                role="progressbar"
                aria-label="Translation progress"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={stats.percentage}
              >
              <div
                className="h-full bg-accent-gold"
                style={{ width: `${stats.percentage}%` }}
              />
              </div>
              <span className="shrink-0 select-none font-mono text-slate-500">
                <strong className="font-semibold text-accent-gold">{stats.percentage}%</strong>
                <span className="hidden sm:inline"> · {stats.count}/{stats.total}</span>
              </span>
            </div>
          )}

          {breadcrumb && (
            <div className="min-w-0 flex-1 truncate text-right font-mono text-[11px] text-slate-600" aria-label="Current translator location">
              <span>{breadcrumb.flow}</span>
              <span className="mx-1 text-slate-700">/</span>
              <span>{breadcrumb.state}</span>
              <span className="mx-1 text-slate-700">/</span>
              <span className="text-slate-400">line #{breadcrumb.line}</span>
            </div>
          )}
        </div>

        <div className="mt-2"><DraftBanner qid={qidN} /></div>
      </header>

      <div className="mb-2 grid grid-cols-2 border border-white/10 lg:hidden" role="group" aria-label="Translator workspace panes">
        <button
          id="translator-lines-tab"
          type="button"
          aria-pressed={mobilePane === "lines"}
          aria-controls="translator-lines-panel"
          className={["min-h-11 border-r border-white/10 px-3 text-xs font-semibold", mobilePane === "lines" ? "bg-accent-gold/10 text-accent-gold" : "text-slate-400"].join(" ")}
          onClick={() => setMobilePane("lines")}
        >
          Lines
        </button>
        <button
          ref={detailTabRef}
          id="translator-detail-tab"
          type="button"
          aria-pressed={mobilePane === "translation"}
          aria-controls="translator-detail-panel"
          className={["min-h-11 px-3 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-40", mobilePane === "translation" ? "bg-accent-gold/10 text-accent-gold" : "text-slate-400"].join(" ")}
          disabled={selectedId === null}
          onClick={() => setMobilePane("translation")}
        >
          Translation
        </button>
      </div>

      <div className="flex min-h-0 flex-1 gap-0 lg:gap-3">
        {/* Dialogue line tree sidebar */}
        <div
          id="translator-lines-panel"
          className={["relative w-full max-w-full shrink-0 lg:w-[23rem]", mobilePane === "lines" ? "flex" : "hidden", "lg:flex"].join(" ")}
        >
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
                localDraftIds={localDraftIds}
              />
            )}
          </aside>
          <ResizeHandle storageKey={`translator:tree-width:${qidN}`} min={240} max={960} />
        </div>

        {/* Translation Workbench panel */}
        <section
          id="translator-detail-panel"
          className={["card min-h-0 min-w-0 flex-1 flex-col overflow-y-auto", mobilePane === "translation" ? "flex" : "hidden", "lg:flex"].join(" ")}
        >
          {selectedId === null ? (
            <div className="flex h-full flex-col items-center justify-center px-6 text-center text-sm text-slate-500">
              <p className="font-serif text-xl text-slate-300">Choose a line to translate</p>
              <p className="mt-2 max-w-md text-xs leading-relaxed text-slate-600">Use dialogue navigator, press <kbd className="rounded-sm border border-white/10 bg-bg-2 px-1.5 py-0.5 text-[10px] text-slate-300">/</kbd> to search, or navigate with <kbd className="rounded-sm border border-white/10 bg-bg-2 px-1.5 py-0.5 text-[10px] text-slate-300">J</kbd> and <kbd className="rounded-sm border border-white/10 bg-bg-2 px-1.5 py-0.5 text-[10px] text-slate-300">K</kbd>.</p>
            </div>
          ) : questQ.isLoading ? (
            <Skeleton variant="form" />
          ) : questQ.error ? (
            <div className="text-sm text-rose-400">Failed to load quest.</div>
          ) : selectedLine ? (
            <div className="flex h-full flex-col gap-3">
              <TranslatorForm
                key={selectedLine.id}
                line={selectedLine}
                originalLine={originalSelectedLine ?? selectedLine}
                qid={qidN}
                busy={submitQ.isPending}
                pendingDraft={selectedPendingDraft}
                context={selectedContext}
                actionableRemaining={actionableRemaining}
                onPreview={previewLineEdit}
                onSubmit={(patch, note) => submitQ.mutateAsync({ patch, note, draftId: selectedPendingDraft?.id }).then(() => undefined)}
                onSelectLine={selectById}
                onSelectActionable={selectNextActionable}
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
