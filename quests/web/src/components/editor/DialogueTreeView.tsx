import { useEffect, useMemo, useState } from "react";
import type { DialogueTreeNode, TreeDropPosition } from "../../lib/types";

type DragPayload = {
  id: string;
  kind: DialogueTreeNode["kind"];
  lineIds: number[];
};

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

export default function DialogueTreeView({
  nodes,
  selectedId,
  pendingCounts,
  searchQ,
  onSearchChange,
  searchMatchCount,
  totalLineCount,
  onSelect,
  onMoveBlock,
}: {
  nodes: DialogueTreeNode[];
  selectedId: number | null;
  pendingCounts: Record<number, number>;
  searchQ: string;
  onSearchChange: (value: string) => void;
  searchMatchCount: number;
  totalLineCount: number;
  onSelect: (id: number) => void;
  onMoveBlock?: (
    movedLineIds: number[],
    targetLineIds: number[],
    position: TreeDropPosition,
  ) => void;
}) {
  const expandable = useMemo(() => allExpandableIds(nodes), [nodes]);
  const [open, setOpen] = useState<Set<string>>(() => new Set(expandable));
  const [dragging, setDragging] = useState<DragPayload | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

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

  function renderDropZone(node: DialogueTreeNode, position: TreeDropPosition) {
    const key = `${node.id}:${position}`;
    const allowed = dropAllowed(dragging, node, position);
    return (
      <div
        onDragOver={(e) => {
          if (!allowed) return;
          e.preventDefault();
          setDropTarget(key);
        }}
        onDragLeave={() => setDropTarget((current) => (current === key ? null : current))}
        onDrop={(e) => {
          e.preventDefault();
          if (!allowed || !dragging) return;
          setDropTarget(null);
          onMoveBlock?.(dragging.lineIds, node.lineIds, position);
        }}
        className={[
          "mx-2 h-1 rounded-full transition-colors",
          allowed && dropTarget === key ? "bg-accent-gold/80" : "bg-transparent",
        ].join(" ")}
      />
    );
  }

  function renderNode(node: DialogueTreeNode, depth = 0) {
    const isLine = node.kind === "line";
    const isOpen = open.has(node.id);
    const selected = isLine && node.line?.id === selectedId;
    const pending = isLine && node.line ? pendingCounts[node.line.id] ?? 0 : 0;
    const canNestInto = node.kind !== "line";
    const dragDisabled = !!searchQ.trim();

    return (
      <div key={node.id}>
        {renderDropZone(node, "before")}
        <div
          draggable={!dragDisabled}
          onDragStart={(e) => {
            if (dragDisabled) {
              e.preventDefault();
              return;
            }
            const payload = { id: node.id, kind: node.kind, lineIds: node.lineIds };
            setDragging(payload);
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("application/json", JSON.stringify(payload));
          }}
          onDragEnd={() => {
            setDragging(null);
            setDropTarget(null);
          }}
          onDragOver={(e) => {
            if (!canNestInto || !dropAllowed(dragging, node, "inside")) return;
            e.preventDefault();
            setDropTarget(`${node.id}:inside`);
          }}
          onDragLeave={() =>
            setDropTarget((current) => (current === `${node.id}:inside` ? null : current))
          }
          onDrop={(e) => {
            e.preventDefault();
            if (!canNestInto || !dropAllowed(dragging, node, "inside") || !dragging) return;
            setDropTarget(null);
            onMoveBlock?.(dragging.lineIds, node.lineIds, "inside");
          }}
          className={[
            "group rounded-lg border transition-colors",
            selected
              ? "border-accent-gold/40 bg-accent-gold/10"
              : dropTarget === `${node.id}:inside`
                ? "border-accent-gold/50 bg-accent-gold/5"
                : "border-transparent hover:border-white/10 hover:bg-white/[0.03]",
          ].join(" ")}
          style={{ marginLeft: depth * 12 }}
        >
          {isLine && node.line ? (
            <div className="rounded-lg">
              <button
                type="button"
                onClick={() => onSelect(node.line!.id)}
                className="w-full px-2 py-1.5 text-left"
              >
                <div className="flex min-w-0 items-center gap-1.5 text-xs font-mono">
                  <span className={dragDisabled ? "text-slate-700" : "cursor-grab text-slate-600 active:cursor-grabbing"}>::</span>
                  <span className="text-slate-500">#{node.line.id}</span>
                  <span className={selected ? "text-accent-gold" : "text-slate-400"}>
                    {highlight(String(node.line.type), searchQ)}
                  </span>
                  {node.line.speaker_en && (
                    <span className="truncate text-slate-500">
                      {highlight(node.line.speaker_en, searchQ)}
                    </span>
                  )}
                  {node.line.is_edited && (
                    <span className="ml-auto rounded bg-accent-gold/20 px-1 py-0.5 text-[9px] text-accent-gold">
                      edited
                    </span>
                  )}
                  {pending > 0 && (
                    <span className="rounded bg-violet-500/20 px-1 py-0.5 text-[9px] text-violet-300">
                      *{pending}
                    </span>
                  )}
                </div>
                <div className="truncate pl-6 text-[10px] text-slate-500">
                  {node.line.text_en ? highlight(node.line.text_en, searchQ) : <em className="opacity-50">-</em>}
                </div>
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => toggle(node.id)}
              className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs"
            >
              <span className="w-3 text-slate-500">{isOpen ? "-" : "+"}</span>
              <span className={dragDisabled ? "font-mono text-slate-700" : "cursor-grab font-mono text-slate-600 active:cursor-grabbing"}>::</span>
              <span className={node.kind === "flow" ? "font-medium text-slate-200" : "text-slate-300"}>
                {node.label}
              </span>
              <span className="ml-auto text-[10px] text-slate-600">{node.lineIds.length}</span>
              {node.plotMode && node.plotMode !== "Normal" && (
                <span className="rounded border border-white/10 bg-bg-2 px-1.5 py-0.5 text-[9px] text-slate-400">
                  {node.plotMode}
                </span>
              )}
            </button>
          )}
        </div>
        {node.kind !== "line" && isOpen && node.children && (
          <div className="mt-0.5 space-y-0.5">
            {node.children.map((child) => renderNode(child, depth + 1))}
          </div>
        )}
        {renderDropZone(node, "after")}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="space-y-1">
        <div className="relative">
          <input
            value={searchQ}
            onChange={(e) => onSearchChange(e.target.value)}
            className="input h-9 pr-16 text-xs"
            placeholder="Search this quest..."
            type="search"
          />
          {searchQ && (
            <button
              type="button"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-500 transition hover:text-slate-200"
              onClick={() => onSearchChange("")}
            >
              clear
            </button>
          )}
        </div>
        <div className="px-1 text-[10px] text-slate-600">
          {searchQ.trim()
            ? `${searchMatchCount} of ${totalLineCount} lines match · clear search to reorder`
            : `Local search across ${totalLineCount} lines`}
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 px-1">
        <div className="text-[10px] uppercase tracking-widest text-slate-600">
          Tree · {nodes.reduce((sum, node) => sum + node.lineIds.length, 0)} lines
        </div>
        <div className="flex gap-1">
          <button type="button" className="btn px-2 py-0.5 text-[10px]" onClick={expandAll}>expand</button>
          <button type="button" className="btn px-2 py-0.5 text-[10px]" onClick={collapseAll}>collapse</button>
        </div>
      </div>
      {nodes.length > 0 ? (
        <div className="space-y-0.5">{nodes.map((node) => renderNode(node))}</div>
      ) : (
        <div className="rounded-lg border border-dashed border-white/10 p-4 text-center text-xs text-slate-500">
          No local matches.
        </div>
      )}
    </div>
  );
}
