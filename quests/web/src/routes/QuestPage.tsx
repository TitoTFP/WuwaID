import { Link, useParams, useSearchParams } from "react-router-dom";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FixedSizeList as List, type ListChildComponentProps } from "react-window";
import { api } from "../lib/api";
import DialogueLine from "../components/DialogueLine";
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

export default function QuestPage() {
  const { qid = "0" } = useParams();
  const qidN = Number(qid);
  const [params] = useSearchParams();
  const primary = (params.get("lang") ?? "en") as Lang;
  const highlightQ = params.get("q");

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
      // State keys are "<FlowListName>_<StateId>_<SubId>". The FlowListName
      // itself can contain underscores (e.g. "剧情_3_3_拉海洛主线_下半"), so a
      // naive split("_") would shred it. Match the exporter's parse:
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

  // Flatten groups into a single list of rows for react-window. Each group
  // emits a header row followed by one row per line. This lets us virtualize
  // 45k+ lines while preserving section structure.
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

  // Build a Map<plot_line_key|text_key, lineId> and Map<id, line> once so
  // DialogueLine.resolveTargetId is O(1) instead of O(N) Array.find.
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

  const getItemSize = (idx: number) => (rows[idx]?.kind === "header" ? HEADER_HEIGHT : LINE_HEIGHT);

  // Resize observer for the scroll container so the list fills available height.
  const listRef = useRef<List>(null);
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

  // Scroll to the line indicated by #L<id> in the URL hash. Use listRef so we
  // account for the virtualized layout (DOM nodes outside the viewport are
  // unmounted, so document.getElementById may be null at the time of the
  // effect).
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
      // Highlight once the row is mounted; scrollToItem is async-ish.
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

  const Row = ({ index, style }: ListChildComponentProps) => {
    const r = rows[index];
    if (r.kind === "header") {
      return (
        <div
          style={style}
          className="flex items-center gap-2 px-1 text-[10px] uppercase tracking-widest text-slate-600"
        >
          <span>{r.flow_name || "scene"} · state {r.state_id || "—"}</span>
          {r.plot_mode && r.plot_mode !== "Normal" && (
            <span className="rounded border border-white/10 bg-bg-2 px-1.5 py-0.5 text-[9px] normal-case tracking-normal text-slate-400">
              {r.plot_mode}
            </span>
          )}
        </div>
      );
    }
    return (
      <div style={style} className="pb-2">
        <DialogueLine
          line={r.line}
          primary={primary}
          highlightQ={highlightQ}
          plotMode={r.plot_mode}
          lineIndex={lineIndex}
        />
      </div>
    );
  };

  return (
    <div className="container-narrow space-y-5">
      <div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link to={quest.side === 1 ? "/side-quests" : `/chapters/${quest.chapter_id ?? 0}`} className="link text-xs">
            ← {quest.side === 1 ? "side quests" : (quest.chapter_name ?? "chapter")}
          </Link>
          <Link to={`/editor/${quest.quest_id}`} className="btn text-xs">
            Edit
          </Link>
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
        style={{ height: "calc(100vh - 220px)", minHeight: 400 }}
      >
        <List
          ref={listRef}
          height={listHeight}
          itemCount={rows.length}
          itemSize={getItemSize}
          width="100%"
          overscanCount={4}
        >
          {Row}
        </List>
      </div>
    </div>
  );
}
