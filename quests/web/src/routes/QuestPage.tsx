import { Link, useParams, useSearchParams } from "react-router-dom";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useToast } from "../components/Toast";
import ExportDialog from "../components/editor/ExportDialog";
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
        <div className="flex items-center gap-2 px-1 text-[10px] uppercase tracking-widest text-slate-600">
          <span>{r.flow_name || "scene"} · state {r.state_id || "—"}</span>
          {r.plot_mode && r.plot_mode !== "Normal" && (
            <span className="rounded border border-white/10 bg-bg-2 px-1.5 py-0.5 text-[9px] normal-case tracking-normal text-slate-400">
              {r.plot_mode}
            </span>
          )}
        </div>
      </RowWrapper>
    );
  }
  return (
    <RowWrapper index={index} style={style} setSize={data.setSize}>
      <div className="pb-2">
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

  const exportMutation = useMutation({
    mutationFn: (onlyUntranslated: boolean) =>
      api.exportTranslations({ quest_ids: [qidN], only_untranslated: onlyUntranslated }),
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

  const scrolledRef = useRef(false);
  useEffect(() => {
    if (!quest || scrolledRef.current) return;
    const m = window.location.hash.match(/^#L(\d+)$/);
    if (!m) return;
    const targetId = Number(m[1]);
    const idx = rows.findIndex((r) => r.kind === "line" && r.line.id === targetId);
    if (idx >= 0 && listRef.current) {
      listRef.current.scrollToItem(idx, "center");
      scrolledRef.current = true;
      setTimeout(() => {
        const el = document.getElementById(`L${targetId}`);
        if (el) {
          el.classList.add("is-highlighted");
          setTimeout(() => el.classList.remove("is-highlighted"), 3000);
        }
      }, 250);
    }
  }, [quest, rows]);

  if (isLoading) return <div className="container-narrow text-sm text-slate-500">Loading quest…</div>;
  if (error || !quest) return <div className="container-narrow text-sm text-rose-400">Quest {qid} not found.</div>;

  return (
    <div className="container-narrow flex-1 flex flex-col overflow-hidden space-y-5">
      <div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link to={quest.side === 1 ? "/side-quests" : `/chapters/${quest.chapter_id ?? 0}`} className="link text-xs">
            ← {quest.side === 1 ? "side quests" : (quest.chapter_name ?? "chapter")}
          </Link>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowExportModal(true)}
              className="btn text-xs btn-active"
            >
              Export to SQLite
            </button>
            <Link to={`/editor/${quest.quest_id}`} className="btn text-xs">
              Edit
            </Link>
          </div>
        </div>
        <h1 className="mt-1 font-serif text-2xl text-slate-100">
          {quest.quest_name}
        </h1>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <span className="font-mono">#{quest.quest_id}</span>
          {quest.chapter_name && quest.side === 0 && (
            <span className="text-accent-teal">{quest.chapter_name}</span>
          )}
          <span>{quest.total_lines} lines</span>
        </div>
      </div>

      <div
        ref={containerRef}
        className="flex-1 w-full min-h-0"
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
        onConfirm={(onlyUntranslated) => exportMutation.mutate(onlyUntranslated)}
      />
    </div>
  );
}
