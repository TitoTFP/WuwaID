import { useEffect, useMemo, useRef, useState } from "react";
import type { DialogueLine, DialogueTreeNode, Lang, TreeDropPosition } from "../../lib/types";

type DragPayload = {
  id: string;
  kind: DialogueTreeNode["kind"];
  lineIds: number[];
};

export type TreeFilters = {
  editedOnly: boolean;
  pendingOnly: boolean;
  hasOptionsOnly: boolean;
  type: string | null;
};

const ROW_INNER = 34;
const DROP_PAD = 8;
const PREVIEW_GAP = 2;
const PREVIEW_HEIGHT = 15;
const ROW_GAP = 6;

const LINE_TYPE_TAG: Record<string, { tag: string; rail: string; tagClass: string }> = {
  Talk:         { tag: "TALK",   rail: "bg-accent-teal",   tagClass: "bg-accent-teal/15 text-accent-teal" },
  Option:       { tag: "OPTION", rail: "bg-accent-gold",   tagClass: "bg-accent-gold/15 text-accent-gold" },
  CenterText:   { tag: "CENTER", rail: "bg-accent-violet", tagClass: "bg-accent-violet/15 text-accent-violet" },
  PhoneMessage: { tag: "PHONE",  rail: "bg-accent-amber",  tagClass: "bg-accent-amber/20 text-accent-amber" },
  NoTextItem:   { tag: "MARKER", rail: "bg-accent-slate",  tagClass: "bg-accent-slate/20 text-accent-slate" },
  SystemOption: { tag: "SYSOPT", rail: "bg-accent-blue",   tagClass: "bg-accent-blue/15 text-accent-blue" },
};
const FALLBACK_TYPE = { tag: "?? TYPE", rail: "bg-slate-500", tagClass: "bg-white/10 text-slate-300" };
const PLOT_MODE_CINE = /^(BlackScreen|Level[A-Z])$/;

function rowHeight(row: { kind: DialogueTreeNode["kind"] }): number {
  return row.kind === "line"
    ? DROP_PAD + ROW_INNER + PREVIEW_GAP + PREVIEW_HEIGHT + DROP_PAD
    : DROP_PAD + ROW_INNER + DROP_PAD;
}

function allExpandableIds(nodes: DialogueTreeNode[]): string[] {
  const ids: string[] = [];
  for (const node of nodes) {
    if (node.kind !== "line") ids.push(node.id);
    if (node.children) ids.push(...allExpandableIds(node.children));
  }
  return ids;
}

function findParents(
  nodes: DialogueTreeNode[],
  selectedId: number | null,
  trail: string[] = [],
): string[] {
  if (selectedId === null) return [];
  for (const node of nodes) {
    if (node.kind === "line" && node.line?.id === selectedId) return trail;
    const found = findParents(node.children ?? [], selectedId, [...trail, node.id]);
    if (found.length) return found;
  }
  return [];
}

function isNoopDrop(payload: DragPayload, targetLineIds: number[]) {
  if (payload.id === "") return true;
  return targetLineIds.length > 0 && targetLineIds.every((id) => payload.lineIds.includes(id));
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

function highlight(value: string, query: string) {
  const q = query.trim();
  if (!q) return value;
  const index = value.toLowerCase().indexOf(q.toLowerCase());
  if (index < 0) return value;
  return (
    <>
      {value.slice(0, index)}
      <mark className="rounded bg-accent-gold/25 px-0.5 text-accent-gold">
        {value.slice(index, index + q.length)}
      </mark>
      {value.slice(index + q.length)}
    </>
  );
}

function dropAllowed(
  payload: DragPayload | null,
  target: DialogueTreeNode,
  position: TreeDropPosition,
) {
  if (!payload) return false;
  if (payload.id === target.id) return false;
  if (isNoopDrop(payload, target.lineIds)) return false;
  if (position === "inside") {
    if (target.kind === "line") return false;
    if (payload.kind === "flow") return false;
    if (payload.kind === "state" && target.kind !== "flow") return false;
    if (payload.kind === "line" && target.kind === "flow") return false;
    return true;
  }
  if (payload.kind === "flow") return target.kind === "flow";
  if (payload.kind === "state") return target.kind === "state" || target.kind === "flow";
  return target.kind === "line" || target.kind === "state";
}

type FlatRow = {
  id: string;
  kind: DialogueTreeNode["kind"];
  depth: number;
  label: string;
  line?: DialogueLine & { is_edited?: boolean };
  lineIds: number[];
  flowName?: string;
  stateKey?: string;
  plotMode?: string;
  localIndex?: number;
};

function flatten(
  nodes: DialogueTreeNode[],
  open: Set<string>,
  depth: number,
  out: FlatRow[],
): void {
  for (const node of nodes) {
    out.push({
      id: node.id,
      kind: node.kind,
      depth,
      label: node.label,
      line: node.line,
      lineIds: node.lineIds,
      flowName: node.flowName,
      stateKey: node.stateKey,
      plotMode: node.plotMode,
      localIndex: node.localIndex,
    });
    if (node.kind !== "line" && open.has(node.id) && node.children) {
      flatten(node.children, open, depth + 1, out);
    }
  }
}

function matchesFilters(node: DialogueTreeNode, filters: TreeFilters, pendingCounts: Record<number, number>): boolean {
  if (node.kind !== "line" || !node.line) {
    const children = node.children ?? [];
    if (children.length === 0) return false;
    return children.some((child) => matchesFilters(child, filters, pendingCounts));
  }
  const line = node.line;
  if (filters.editedOnly && !line.is_edited) return false;
  if (filters.pendingOnly && (pendingCounts[line.id] ?? 0) === 0) return false;
  if (filters.hasOptionsOnly && !(line.options && line.options.length > 0)) return false;
  if (filters.type && line.type !== filters.type) return false;
  return true;
}

export function applyFilters(nodes: DialogueTreeNode[], filters: TreeFilters, pendingCounts: Record<number, number>): DialogueTreeNode[] {
  return nodes
    .map((node) => {
      if (node.kind === "line") {
        return matchesFilters(node, filters, pendingCounts) ? node : null;
      }
      const filteredChildren = applyFilters(node.children ?? [], filters, pendingCounts);
      if (filteredChildren.length === 0) return null;
      return { ...node, children: filteredChildren, lineIds: filteredChildren.flatMap((c) => c.lineIds) };
    })
    .filter((node): node is DialogueTreeNode => node !== null);
}

function previewValueForLang(line: DialogueLine, lang: Lang): { speaker: string; text: string } {
  const speaker = (line[`speaker_${lang}` as keyof DialogueLine] as string) || line.speaker_en;
  const text = (line[`text_${lang}` as keyof DialogueLine] as string) || line.text_en;
  return { speaker: String(speaker ?? ""), text: String(text ?? "") };
}

export default function DialogueTreeView({
  nodes,
  selectedId,
  pendingCounts,
  searchQ,
  onSearchChange,
  searchMatchCount,
  totalLineCount,
  filters,
  onFiltersChange,
  types,
  onSelect,
  onMoveBlock,
  onJumpToLine,
  activeLang,
  selectedIds,
  onSelectMany,
  storageKeyOpen,
}: {
  nodes: DialogueTreeNode[];
  selectedId: number | null;
  pendingCounts: Record<number, number>;
  searchQ: string;
  onSearchChange: (value: string) => void;
  searchMatchCount: number;
  totalLineCount: number;
  filters: TreeFilters;
  onFiltersChange: (next: TreeFilters) => void;
  types: string[];
  onSelect: (id: number) => void;
  onMoveBlock?: (
    movedLineIds: number[],
    targetLineIds: number[],
    position: TreeDropPosition,
  ) => void;
  onJumpToLine?: (raw: string) => void;
  activeLang: Lang;
  selectedIds?: Set<number>;
  onSelectMany?: (ids: number[], replace: boolean) => void;
  storageKeyOpen: string;
}) {
  const expandable = useMemo(() => allExpandableIds(nodes), [nodes]);
  const [open, setOpen] = useState<Set<string>>(() => new Set(expandable));
  const [dragging, setDragging] = useState<DragPayload | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [jumpTo, setJumpTo] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(600);
  const initialised = useRef(false);
  const lastScrolledIdRef = useRef<number | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKeyOpen);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) {
          setOpen(new Set(arr.filter((v) => typeof v === "string")));
          initialised.current = true;
        }
      }
    } catch {
      // ignore
    }
  }, [storageKeyOpen]);

  useEffect(() => {
    if (!initialised.current) return;
    try {
      localStorage.setItem(storageKeyOpen, JSON.stringify(Array.from(open)));
    } catch {
      // ignore
    }
  }, [open, storageKeyOpen]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => setScrollTop(el.scrollTop);
    const onResize = () => setViewport(el.clientHeight);
    onResize();
    el.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
    return () => {
      el.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  useEffect(() => {
    setOpen((current) => {
      const next = new Set(current);
      if (searchQ.trim()) {
        for (const id of expandable) next.add(id);
      }
      for (const id of findParents(nodes, selectedId)) next.add(id);
      return next;
    });
  }, [expandable, nodes, searchQ, selectedId]);

  const flatRows = useMemo(() => {
    const rows: FlatRow[] = [];
    flatten(nodes, open, 0, rows);
    return rows;
  }, [nodes, open]);

  const totalRows = flatRows.length;
  const rowHeights = useMemo(() => flatRows.map(rowHeight), [flatRows]);
  const rowTops = useMemo(() => {
    const tops = new Array<number>(rowHeights.length);
    let y = 0;
    for (let i = 0; i < rowHeights.length; i++) {
      tops[i] = y;
      y += rowHeights[i] + ROW_GAP;
    }
    return tops;
  }, [rowHeights]);
  const totalHeight = rowTops.length
    ? rowTops[rowTops.length - 1] + rowHeights[rowHeights.length - 1]
    : 0;
  const overscan = 6;
  const startIndex = useMemo(() => {
    let start = 0;
    while (start < totalRows && rowTops[start] + rowHeights[start] < scrollTop) {
      start++;
    }
    return Math.max(0, start - overscan);
  }, [totalRows, rowTops, rowHeights, scrollTop, overscan]);

  const endIndex = useMemo(() => {
    let end = startIndex;
    while (end < totalRows && rowTops[end] < scrollTop + viewport) {
      end++;
    }
    return Math.min(totalRows, end + overscan);
  }, [totalRows, rowTops, startIndex, scrollTop, viewport, overscan]);
  const visibleRows = flatRows.slice(startIndex, endIndex);

  useEffect(() => {
    if (selectedId === null) {
      lastScrolledIdRef.current = null;
      return;
    }
    if (lastScrolledIdRef.current === selectedId) return;
    const el = scrollRef.current;
    if (!el) return;
    const idx = flatRows.findIndex((r) => r.kind === "line" && r.line?.id === selectedId);
    if (idx < 0) return;
    const rowTop = rowTops[idx];
    const rowBottom = rowTop + rowHeights[idx];
    const viewTop = el.scrollTop;
    const viewBottom = viewTop + el.clientHeight;
    if (rowTop < viewTop || rowBottom > viewBottom) {
      const maxScroll = el.scrollHeight - el.clientHeight;
      const centered = rowTop - (el.clientHeight - rowHeights[idx]) / 2;
      el.scrollTo({
        top: Math.max(0, Math.min(centered, maxScroll)),
        behavior: prefersReducedMotion() ? "auto" : "smooth",
      });
    }
    lastScrolledIdRef.current = selectedId;
  }, [selectedId, flatRows, rowTops, rowHeights]);

  function toggle(id: string) {
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function expandAll() {
    setOpen(new Set(expandable));
  }

  function collapseAll() {
    setOpen(new Set());
  }

  function updateFilter<K extends keyof TreeFilters>(key: K, value: TreeFilters[K]) {
    onFiltersChange({ ...filters, [key]: value });
  }

  function commitJump() {
    if (jumpTo.trim()) {
      onJumpToLine?.(jumpTo.trim());
      setJumpTo("");
    }
  }

  function rowClick(row: FlatRow, event: React.MouseEvent) {
    if (row.kind === "line" && row.line) {
      if (event.shiftKey && selectedIds && onSelectMany) {
        const ids = collectLineIdsInRange(nodes, selectedId ?? row.line.id, row.line.id);
        onSelectMany(ids, !event.metaKey && !event.ctrlKey);
        return;
      }
      if ((event.metaKey || event.ctrlKey) && selectedIds && onSelectMany) {
        onSelectMany([row.line.id], false);
        return;
      }
      onSelect(row.line.id);
    } else {
      toggle(row.id);
    }
  }

  function collectLineIdsInRange(nodes: DialogueTreeNode[], fromId: number, toId: number): number[] {
    const list: number[] = [];
    for (const n of nodes) {
      if (n.kind === "line" && n.line) list.push(n.line.id);
      else if (n.children) list.push(...collectLineIdsInRange(n.children, fromId, toId));
    }
    const a = list.indexOf(fromId);
    const b = list.indexOf(toId);
    if (a < 0 || b < 0) return [];
    const [lo, hi] = a < b ? [a, b] : [b, a];
    return list.slice(lo, hi + 1);
  }

  const dragDisabled = !!searchQ.trim() || !onMoveBlock;
  const showInside = (row: FlatRow) => row.kind !== "line";
  const totalCount = nodes.reduce((sum, node) => sum + node.lineIds.length, 0);

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="space-y-1.5">
        <div className="relative">
          <span
            aria-hidden="true"
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500"
          >
            ⌕
          </span>
          <input
            value={searchQ}
            onChange={(e) => onSearchChange(e.target.value)}
            className="input h-9 pl-7 pr-16 text-xs"
            placeholder="Search this quest..."
            type="search"
          />
          {searchQ ? (
            <button
              type="button"
              aria-label="Clear search"
              className="absolute right-2 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-slate-400 transition hover:bg-white/5 hover:text-slate-100"
              onClick={() => onSearchChange("")}
            >
              ×
            </button>
          ) : (
            <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-white/10 bg-bg-2 px-1 text-[10px] text-slate-500">
              esc
            </kbd>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <FilterChip
            label="edited"
            active={filters.editedOnly}
            onClick={() => updateFilter("editedOnly", !filters.editedOnly)}
          />
          <FilterChip
            label="pending"
            active={filters.pendingOnly}
            onClick={() => updateFilter("pendingOnly", !filters.pendingOnly)}
          />
          <FilterChip
            label="has options"
            active={filters.hasOptionsOnly}
            onClick={() => updateFilter("hasOptionsOnly", !filters.hasOptionsOnly)}
          />
          {types.length > 0 && (
            <select
              value={filters.type ?? ""}
              onChange={(e) => updateFilter("type", e.target.value || null)}
              className="rounded-md border border-white/10 bg-bg-2 px-2 py-0.5 text-[10px] font-medium text-slate-300 transition hover:border-white/20"
            >
              <option value="">any type</option>
              {types.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-white/5 px-1 pt-2">
        <div className="text-[11px] tabular-nums text-slate-500">
          {searchQ.trim() ? (
            <span>
              <span className="text-accent-gold">{searchMatchCount}</span>
              <span className="text-slate-600"> / {totalLineCount} match</span>
            </span>
          ) : (
            <span>
              <span className="text-slate-300">{totalCount}</span>
              <span className="text-slate-600"> lines · {nodes.length} flow</span>
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <input
            value={jumpTo}
            onChange={(e) => setJumpTo(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitJump();
              }
            }}
            placeholder="#id / state"
            aria-label="Jump to line or state"
            className="h-6 w-24 rounded-md border border-white/10 bg-bg-1 px-1.5 text-center font-mono text-[10px] text-slate-200 outline-none transition focus:border-accent-gold/60"
          />
          <button
            type="button"
            className="btn h-6 px-2 text-[10px] disabled:opacity-40"
            onClick={commitJump}
            disabled={!jumpTo.trim()}
            aria-label="Jump"
          >
            go
          </button>
          <span className="mx-0.5 h-3 w-px bg-white/10" aria-hidden="true" />
          <button
            type="button"
            className="btn h-6 px-2 text-[10px]"
            onClick={expandAll}
            aria-label="Expand all groups"
          >
            +
          </button>
          <button
            type="button"
            className="btn h-6 px-2 text-[10px]"
            onClick={collapseAll}
            aria-label="Collapse all groups"
          >
            −
          </button>
        </div>
      </div>
      {totalRows === 0 ? (
        <div className="rounded-lg border border-dashed border-white/10 px-4 py-6 text-center">
          <div className="text-base text-slate-600" aria-hidden="true">⌕</div>
          <div className="mt-1 text-xs text-slate-400">No matches in this quest.</div>
          {searchQ && (
            <button
              type="button"
              className="mt-2 text-[10px] text-accent-teal hover:text-accent-gold"
              onClick={() => onSearchChange("")}
            >
              clear search
            </button>
          )}
        </div>
      ) : (
        <div
          ref={scrollRef}
          className="relative flex-1 min-h-0 overflow-auto overscroll-contain"
          style={{ minHeight: "200px" }}
        >
          <div style={{ height: totalHeight, position: "relative" }}>
            {visibleRows.map((row, idx) => {
              const actualIndex = startIndex + idx;
              return (
                <Row
                  key={row.id}
                  row={row}
                  top={rowTops[actualIndex]}
                  height={rowHeights[actualIndex]}
                  isOpen={open.has(row.id)}
                  selected={row.kind === "line" && row.line?.id === selectedId}
                  multiSelected={row.kind === "line" && !!row.line && !!selectedIds?.has(row.line.id)}
                  pending={row.kind === "line" && row.line ? pendingCounts[row.line.id] ?? 0 : 0}
                  searchQ={searchQ}
                  activeLang={activeLang}
                  dropTarget={dropTarget}
                  dragging={dragging}
                  dragDisabled={dragDisabled}
                  showInside={showInside(row)}
                  onClick={(event) => rowClick(row, event)}
                  onDragStart={(event) => {
                    if (dragDisabled) {
                      event.preventDefault();
                      return;
                    }
                    const payload = { id: row.id, kind: row.kind, lineIds: row.lineIds };
                    setDragging(payload);
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("application/json", JSON.stringify(payload));
                  }}
                  onDragEnd={() => {
                    setDragging(null);
                    setDropTarget(null);
                  }}
                  onDropTargetChange={(key) => setDropTarget(key)}
                  onDrop={(lineIds, position) => onMoveBlock?.(lineIds, row.lineIds, position)}
                  draggingPayload={dragging}
                />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "rounded-md border px-2 py-0.5 text-[10px] font-medium transition",
        active
          ? "border-accent-gold/60 bg-accent-gold/10 text-accent-gold"
          : "border-white/10 bg-bg-2 text-slate-400 hover:border-white/20 hover:text-slate-200",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

function Row({
  row,
  top,
  height,
  isOpen,
  selected,
  multiSelected,
  pending,
  searchQ,
  activeLang,
  dropTarget,
  dragging,
  dragDisabled,
  showInside,
  onClick,
  onDragStart,
  onDragEnd,
  onDropTargetChange,
  onDrop,
  draggingPayload,
}: {
  row: FlatRow;
  top: number;
  height: number;
  isOpen: boolean;
  selected: boolean;
  multiSelected: boolean;
  pending: number;
  searchQ: string;
  activeLang: Lang;
  dropTarget: string | null;
  dragging: DragPayload | null;
  dragDisabled: boolean;
  showInside: boolean;
  onClick: (event: React.MouseEvent) => void;
  onDragStart: (event: React.DragEvent) => void;
  onDragEnd: () => void;
  onDropTargetChange: (key: string | null | ((current: string | null) => string | null)) => void;
  onDrop: (lineIds: number[], position: TreeDropPosition) => void;
  draggingPayload: DragPayload | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const isLine = row.kind === "line";
  const beforeKey = `${row.id}:before`;
  const afterKey = `${row.id}:after`;
  const insideKey = `${row.id}:inside`;

  function handleDragOverBefore(event: React.DragEvent) {
    const allowed = dropAllowed(dragging, { id: row.id, kind: row.kind, label: "", lineIds: row.lineIds }, "before");
    if (!allowed) return;
    event.preventDefault();
    onDropTargetChange(beforeKey);
  }
  function handleDragOverAfter(event: React.DragEvent) {
    const target = { id: row.id, kind: row.kind, label: "", lineIds: row.lineIds };
    const allowed = dropAllowed(dragging, target, "after");
    if (!allowed) return;
    event.preventDefault();
    onDropTargetChange(afterKey);
  }
  function handleDragOverInside(event: React.DragEvent) {
    if (!showInside) return;
    const target = { id: row.id, kind: row.kind, label: "", lineIds: row.lineIds };
    if (!dropAllowed(dragging, target, "inside")) return;
    event.preventDefault();
    onDropTargetChange(insideKey);
  }
  function handleDrop(event: React.DragEvent, position: TreeDropPosition) {
    event.preventDefault();
    if (!draggingPayload) return;
    onDrop(draggingPayload.lineIds, position);
    onDropTargetChange(null);
  }

  const activeInside = dropTarget === insideKey;
  const activeBefore = dropTarget === beforeKey;
  const activeAfter = dropTarget === afterKey;
  const preview = isLine && row.line ? previewValueForLang(row.line, activeLang) : null;
  const cine = isLine && row.line && PLOT_MODE_CINE.test(row.plotMode ?? "");
  const typeInfo = !isLine || !row.line
    ? null
    : cine
      ? { tag: "CINE", rail: "bg-accent-slate", tagClass: "border border-accent-slate/50 bg-transparent text-accent-slate" }
      : LINE_TYPE_TAG[row.line.type] ?? FALLBACK_TYPE;

  return (
    <div
      ref={ref}
      style={{ position: "absolute", top, left: 0, right: 0, height, paddingLeft: 4, paddingRight: 4 }}
    >
      <div
        onDragOver={handleDragOverBefore}
        onDragLeave={() => onDropTargetChange((cur) => (cur === beforeKey ? null : cur))}
        onDrop={(e) => handleDrop(e, "before")}
        className={[
          "h-2 rounded-full transition-colors",
          activeBefore ? "bg-accent-gold shadow-[0_0_0_2px_rgba(214,182,107,0.18)]" : "bg-transparent",
        ].join(" ")}
      />
      <div
        draggable={!dragDisabled}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragOver={handleDragOverInside}
        onDragLeave={() => onDropTargetChange((cur) => (cur === insideKey ? null : cur))}
        onDrop={(e) => handleDrop(e, "inside")}
        className={[
          "group flex h-[34px] items-center gap-2 rounded-md border px-2 text-xs transition-colors",
          selected
            ? "border-accent-gold/50 bg-accent-gold/10"
            : multiSelected
              ? "border-accent-teal/50 bg-accent-teal/10"
              : activeInside
                ? "border-accent-gold/40 bg-accent-gold/5"
                : "border-transparent hover:border-white/10 hover:bg-white/[0.03]",
        ].join(" ")}
        style={{ marginLeft: row.depth * 12 }}
      >
        {isLine ? (
          <button
            type="button"
            onClick={onClick}
            className="flex w-full items-center gap-1.5 overflow-hidden text-left"
          >
            {typeInfo && <span className={`self-stretch w-[3px] shrink-0 rounded-sm ${typeInfo.rail}`} />}
            <span className={dragDisabled ? "text-slate-700" : "cursor-grab text-slate-600 active:cursor-grabbing"}>
              ::
            </span>
            <span className="shrink-0 font-mono text-[10px] text-slate-500">#{row.line!.id}</span>
            {typeInfo && (
              <span className={`inline-block min-w-[50px] rounded-sm px-1.5 py-0.5 text-center text-[9px] font-bold tracking-wider ${typeInfo.tagClass}`}>
                {typeInfo.tag}
              </span>
            )}
            {preview?.speaker && (
              <span className="truncate font-sans text-[11px] text-slate-300">{highlight(preview.speaker, searchQ)}</span>
            )}
            <div className="ml-auto flex items-center gap-1">
              {(() => {
                const pills: { label: string; cls: string; title: string }[] = [];
                if (row.line?.is_edited) pills.push({ label: "EDITED", cls: "bg-accent-gold/15 text-accent-gold", title: "Has approved edits" });
                if (pending > 0) pills.push({ label: `${pending} ${pending === 1 ? "DRAFT" : "DRAFTS"}`, cls: "bg-accent-ember/15 text-accent-ember", title: `${pending} pending draft(s)` });
                const optCount = row.line?.options?.length ?? 0;
                if (optCount > 0) pills.push({ label: `${optCount} opts`, cls: "bg-accent-teal/15 text-accent-teal", title: `${optCount} option(s)` });
                const visible = pills.slice(0, 2);
                const overflow = pills.length - visible.length;
                return (
                  <>
                    {visible.map((p) => (
                      <span key={p.label} className={`inline-flex items-center rounded-sm px-1.5 py-0.5 text-[9px] font-semibold tracking-wider ${p.cls}`} title={p.title} aria-label={p.title}>
                        {p.label}
                      </span>
                    ))}
                    {overflow > 0 && <span className="text-[9px] text-slate-500">+{overflow}</span>}
                  </>
                );
              })()}
            </div>
          </button>
        ) : (
          <button
            type="button"
            onClick={onClick}
            className="flex w-full items-center gap-2 text-left"
            draggable={!dragDisabled}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
          >
            <span className="w-3 text-slate-500">{isOpen ? "-" : "+"}</span>
            <span className={dragDisabled ? "font-mono text-slate-700" : "cursor-grab font-mono text-slate-600 active:cursor-grabbing"}>
              ::
            </span>
            {row.kind === "flow" ? (
              <>
                <span className="inline-block rounded-sm bg-accent-teal px-1.5 py-0.5 text-[9px] font-bold tracking-wider text-bg-0">FLOW</span>
                <span className="truncate text-[12px] font-semibold text-slate-100">{row.label}</span>
                <span className="ml-auto text-[10px] text-slate-500">{row.lineIds.length} lines</span>
              </>
            ) : (
              <>
                <span className="inline-block rounded-sm border border-accent-gold/60 bg-transparent px-1.5 py-0.5 text-[9px] font-bold tracking-wider text-accent-gold">STATE</span>
                <span className="truncate text-[11px] font-medium text-slate-300">{row.label}</span>
                {row.localIndex !== undefined && <span className="ml-1 text-slate-500">[{row.localIndex}]</span>}
                <span className="ml-auto text-[10px] text-slate-500">
                  {(() => {
                    const mode = row.plotMode && row.plotMode !== "Normal" ? row.plotMode : null;
                    return [mode, `${row.lineIds.length} lines`].filter(Boolean).join(" · ");
                  })()}
                </span>
              </>
            )}
            {pending > 0 && (
              <span className="rounded bg-accent-ember/20 px-1 py-0.5 text-[9px] font-medium text-accent-ember">*{pending}</span>
            )}
          </button>
        )}
      </div>
      {isLine && preview && (
        <div
          className="truncate pl-7 font-sans text-[10px] italic text-slate-500"
          style={{ marginLeft: row.depth * 12, marginTop: PREVIEW_GAP }}
        >
          {preview.text ? highlight(preview.text, searchQ) : <em className="opacity-50">-</em>}
        </div>
      )}
      <div
        onDragOver={handleDragOverAfter}
        onDragLeave={() => onDropTargetChange((cur) => (cur === afterKey ? null : cur))}
        onDrop={(e) => handleDrop(e, "after")}
        className={[
          "h-2 rounded-full transition-colors",
          activeAfter ? "bg-accent-gold shadow-[0_0_0_2px_rgba(214,182,107,0.18)]" : "bg-transparent",
        ].join(" ")}
      />
    </div>
  );
}
