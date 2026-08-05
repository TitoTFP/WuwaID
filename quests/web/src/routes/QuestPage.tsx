import { Link, useParams, useSearchParams } from "react-router-dom";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "../components/Toast";
import ExportDialog, { type ExportMode } from "../components/editor/ExportDialog";
import ConfirmDialog from "../components/editor/ConfirmDialog";
import { canEdit, useMe } from "../lib/auth";
import { VariableSizeList as List, type ListChildComponentProps } from "react-window";
import { api } from "../lib/api";
import DialogueLine, { type LineIndex } from "../components/DialogueLine";
import ErrorBoundary from "../components/ErrorBoundary";
import type { DialogueLine as DialogueLineT, Lang } from "../lib/types";

type HeaderRow = {
  kind: "header";
  key: string;
  flow_name: string;
  state_id: number;
  plot_mode: string;
};

type LineRow = {
  kind: "line";
  key: string;
  line: DialogueLineT;
  plot_mode: string;
};

type Row = HeaderRow | LineRow;

const HEADER_HEIGHT = 40;
const LINE_HEIGHT = 96;

type RowData = {
  rows: Row[];
  primary: Lang;
  highlightQ: string | null;
  lineIndex: LineIndex;
  setSize: (index: number, size: number) => void;
};

interface RowWrapperProps {
  index: number;
  style: React.CSSProperties;
  setSize: (index: number, size: number) => void;
  children: React.ReactNode;
}

function RowWrapper({ index, style, setSize, children }: RowWrapperProps) {
  const rowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!rowRef.current) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        const height = entry.target.getBoundingClientRect().height;
        if (height > 0) {
          setSize(index, height);
        }
      }
    });

    observer.observe(rowRef.current);
    return () => {
      observer.disconnect();
    };
  }, [index, setSize]);

  return (
    <div style={style}>
      <div ref={rowRef} className="w-full">
        {children}
      </div>
    </div>
  );
}

function Row({ index, style, data }: ListChildComponentProps<RowData>) {
  const r = data.rows[index];
  if (!r) return null;
  if (r.kind === "header") {
    return (
      <RowWrapper index={index} style={style} setSize={data.setSize}>
        <div className="flex min-h-10 items-center gap-3 px-1 pt-2 font-mono text-[10px] text-slate-500 sm:px-3">
          <span className="shrink-0">{r.flow_name || "scene"} · state {r.state_id || "—"}</span>
          {r.plot_mode && r.plot_mode !== "Normal" && (
            <span className="shrink-0 text-slate-400">{r.plot_mode}</span>
          )}
          <span className="h-px min-w-4 flex-1 bg-white/10" aria-hidden="true" />
        </div>
      </RowWrapper>
    );
  }
  return (
    <RowWrapper index={index} style={style} setSize={data.setSize}>
      <div>
        <DialogueLine
          line={r.line}
          primary={data.primary}
          highlightQ={data.highlightQ}
          plotMode={r.plot_mode}
          lineIndex={data.lineIndex}
        />
      </div>
    </RowWrapper>
  );
}

export default function QuestPage() {
  const { qid = "0" } = useParams();
  const qidN = Number(qid);
  const [params] = useSearchParams();
  const primary = (params.get("lang") ?? "en") as Lang;
  const highlightQ = params.get("q");

  const toast = useToast();
  const [showExportModal, setShowExportModal] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const meQ = useMe();
  const role = meQ.data?.role ?? "anon";
  const queryClient = useQueryClient();

  const deleteMutation = useMutation({
    mutationFn: () => api.deleteQuestTranslation(qidN),
    onSuccess: () => {
      setConfirmDelete(false);
      queryClient.invalidateQueries({ queryKey: ["quest", qidN] });
    },
    onError: (err: any) => {
      toast.error(`Delete failed: ${err.message || err}`);
    }
  });

  const exportMutation = useMutation({
    mutationFn: (mode: ExportMode) =>
      api.exportTranslations({
        quest_ids: [qidN],
        export_mode: mode,
        only_untranslated: mode === "untranslated",
      }),
    onSuccess: (res) => {
      setShowExportModal(false);
      const file = res.files?.[0];
      if (file) {
        toast.success(`Quest successfully exported to output_db/id/${file}!`);
      } else {
        toast.success("Quest successfully exported to output_db/id!");
      }
    },
    onError: (err: any) => {
      toast.error(`Export failed: ${err.message || err}`);
    }
  });

  const listRef = useRef<List>(null);
  const scrolledRef = useRef(false);
  const sizeMap = useRef<Record<number, number>>({});
  const [, forceUpdate] = useState(0);

  const setSize = useCallback((index: number, size: number) => {
    if (sizeMap.current[index] !== size) {
      sizeMap.current[index] = size;
      listRef.current?.resetAfterIndex(index, false);
      forceUpdate((c) => c + 1);
    }
  }, []);

  useEffect(() => {
    scrolledRef.current = false;
    sizeMap.current = {};
    listRef.current?.resetAfterIndex(0, false);
  }, [qid]);

  const { data: quest, isLoading, error } = useQuery({
    queryKey: ["quest", qidN],
    queryFn: () => api.quest(qidN),
    enabled: !!qidN,
  });

  const groups = useMemo(() => {
    if (!quest) return [];
    const plotModeByKey = quest.plot_mode_by_state;
    const lines = quest.all_lines;
    const g: { flow_name: string; state_id: number; plot_mode: string; lines: typeof lines }[] = [];
    let cur: { flow_name: string; state_id: number; plot_mode: string; lines: typeof lines } | null = null;
    for (const l of lines) {
      const m = (l.state_key ?? "").match(/^(.*)_(\d+)_(\d+)$/);
      if (!m) continue;
      const flow_name = m[1];
      const state_id = Number(m[2]);
      const pm = plotModeByKey[l.state_key ?? ""] ?? "Normal";
      if (!cur || cur.flow_name !== flow_name || cur.state_id !== state_id) {
        cur = { flow_name, state_id, plot_mode: pm, lines: [] };
        g.push(cur);
      }
      cur.lines.push(l);
    }
    return g;
  }, [quest]);

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    for (const g of groups) {
      out.push({
        kind: "header",
        key: `h-${g.flow_name}-${g.state_id}`,
        flow_name: g.flow_name,
        state_id: g.state_id,
        plot_mode: g.plot_mode,
      });
      for (const l of g.lines) {
        out.push({ kind: "line", key: `l-${l.id}`, line: l, plot_mode: g.plot_mode });
      }
    }
    return out;
  }, [groups]);

  const lineIndex = useMemo(() => {
    const byKey = new Map<string, number>();
    const byId = new Map<number, DialogueLineT>();
    for (const l of quest?.all_lines ?? []) {
      byId.set(l.id, l);
      if (l.plot_line_key) byKey.set(l.plot_line_key, l.id);
      if (l.text_key) byKey.set(l.text_key, l.id);
    }
    return { byKey, byId };
  }, [quest]);

  const rowData = useMemo<RowData>(
    () => ({ rows, primary, highlightQ, lineIndex, setSize }),
    [rows, primary, highlightQ, lineIndex, setSize],
  );

  const getItemSize = useCallback((idx: number) => {
    return sizeMap.current[idx] || (rows[idx]?.kind === "header" ? HEADER_HEIGHT : LINE_HEIGHT);
  }, [rows]);

  const containerRef = useRef<HTMLDivElement>(null);
  const [listHeight, setListHeight] = useState(600);
  useLayoutEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setListHeight(e.contentRect.height);
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!quest || scrolledRef.current) return;
    const m = window.location.hash.match(/^#L(\d+)$/);
    if (!m) return;
    const targetId = Number(m[1]);
    const idx = rows.findIndex((r) => r.kind === "line" && r.line.id === targetId);
    if (idx >= 0 && listRef.current) {
      scrolledRef.current = true;
      let settleTimer = 0;
      let highlightTimer = 0;
      let clearTimer = 0;
      const initialTimer = window.setTimeout(() => {
        listRef.current?.scrollToItem(idx, "center");
        settleTimer = window.setTimeout(() => {
          listRef.current?.scrollToItem(idx, "center");
          highlightTimer = window.setTimeout(() => {
            const el = document.getElementById(`L${targetId}`);
            if (!el) return;
            el.classList.add("is-highlighted");
            clearTimer = window.setTimeout(() => el.classList.remove("is-highlighted"), 3000);
          }, 50);
        }, 100);
      }, 100);
      return () => {
        window.clearTimeout(initialTimer);
        window.clearTimeout(settleTimer);
        window.clearTimeout(highlightTimer);
        window.clearTimeout(clearTimer);
      };
    }
  }, [quest, rows]);

  if (isLoading) return <div className="container-narrow py-6 text-sm text-slate-500">Loading quest…</div>;
  if (error || !quest) return <div className="container-narrow py-6 text-sm text-rose-400">Quest {qid} not found.</div>;

  return (
    <div className="container-narrow flex flex-1 flex-col gap-4 overflow-hidden pb-2">
      <header className="shrink-0 border-b border-white/10 pb-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <Link
              to={quest.side === 1 ? "/side-quests" : `/chapters/${quest.chapter_id ?? 0}`}
              className="link inline-flex min-h-11 items-center whitespace-nowrap text-xs"
            >
              ← {quest.side === 1 ? "Side quests" : "Chapter"}
            </Link>
            <h1 className="min-w-0 [overflow-wrap:anywhere] font-serif text-2xl leading-tight text-slate-100 sm:text-3xl">
              {quest.quest_name}
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] text-slate-500 tabular-nums sm:text-xs">
              <span>#{quest.quest_id}</span>
              {quest.chapter_name && quest.side === 0 && (
                <span className="text-accent-signal">{quest.chapter_name}</span>
              )}
              <span>{quest.total_lines} lines</span>
            </div>
          </div>
          <nav className="flex flex-wrap items-center gap-2" aria-label="Quest actions">
            <button
              type="button"
              onClick={() => setShowExportModal(true)}
              className="btn btn-active whitespace-nowrap text-xs"
            >
              Export SQLite
            </button>
            <Link
              to={`/editor/${quest.quest_id}`}
              className="btn whitespace-nowrap text-xs hover:border-slate-400"
              title="Edit quest structure and settings"
            >
              Edit Flow
            </Link>
            {canEdit(role) && (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="btn whitespace-nowrap border-rose-400/40 text-xs text-rose-300 hover:bg-rose-500/10"
                title="Delete Indonesian translation locally"
              >
                Delete ID
              </button>
            )}
            <Link
              to={`/translator/${quest.quest_id}`}
              className="btn whitespace-nowrap border-accent-signal/45 text-xs text-accent-signal hover:bg-accent-signal/5"
              title="Translate dialogue to Indonesian"
            >
              Translate
            </Link>
          </nav>
        </div>
      </header>

      <div
        ref={containerRef}
        className="min-h-0 w-full flex-1 border-y border-white/10"
      >
        <ErrorBoundary>
          <List
            ref={listRef}
            height={listHeight}
            itemCount={rows.length}
            itemSize={getItemSize}
            width="100%"
            overscanCount={4}
            estimatedItemSize={LINE_HEIGHT}
            itemData={rowData}
            itemKey={(idx, d) => d.rows[idx]?.key ?? String(idx)}
          >
            {Row}
          </List>
        </ErrorBoundary>
      </div>
      <ExportDialog
        open={showExportModal}
        title="Export Quest to SQLite"
        isPending={exportMutation.isPending}
        onCancel={() => setShowExportModal(false)}
        onConfirm={(mode) => exportMutation.mutate(mode)}
      />
      <ConfirmDialog
        open={confirmDelete}
        title="Delete Indonesian Translation?"
        message="This will permanently delete all Indonesian translation data (including edits, drafts, and cache) for this quest. This action cannot be undone."
        confirmLabel={deleteMutation.isPending ? "Deleting…" : "Delete"}
        destructive
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => deleteMutation.mutate()}
      />
    </div>
  );
}
