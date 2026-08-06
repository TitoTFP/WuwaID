import { forwardRef, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type HTMLAttributes, type ReactNode } from "react";
import { VariableSizeList as List, type ListChildComponentProps } from "react-window";
import DialogueLine, { type LineIndex } from "./DialogueLine";
import ErrorBoundary from "./ErrorBoundary";
import type { DialogueLine as DialogueLineT, Lang } from "../lib/types";

export type QuestRow =
  | {
      kind: "header";
      key: string;
      flow_name: string;
      state_id: number;
      plot_mode: string;
    }
  | {
      kind: "line";
      key: string;
      line: DialogueLineT;
      plot_mode: string;
    };

const HEADER_HEIGHT = 40;
const LINE_HEIGHT = 96;

type RowData = {
  rows: QuestRow[];
  primary: Lang;
  highlightQ: string | null;
  lineIndex: LineIndex;
  setSize: (index: number, size: number) => void;
};

interface RowWrapperProps {
  index: number;
  style: CSSProperties;
  setSize: (index: number, size: number) => void;
  children: ReactNode;
}

function RowWrapper({ index, style, setSize, children }: RowWrapperProps) {
  const rowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!rowRef.current) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        const height = entry.target.getBoundingClientRect().height;
        if (height > 0) setSize(index, height);
      }
    });

    observer.observe(rowRef.current);
    return () => observer.disconnect();
  }, [index, setSize]);

  return (
    <div style={style}>
      <div ref={rowRef} className="w-full">
        {children}
      </div>
    </div>
  );
}

const ReaderListOuter = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function ReaderListOuter({ children, ...props }, ref) {
    return (
      <div {...props} ref={ref} tabIndex={0} aria-label="Dialogue lines">
        {children}
      </div>
    );
  },
);

function Row({ index, style, data }: ListChildComponentProps<RowData>) {
  const row = data.rows[index];
  if (!row) return null;

  if (row.kind === "header") {
    return (
      <RowWrapper index={index} style={style} setSize={data.setSize}>
        <div className="reader-stream__header flex min-h-10 items-center gap-3 px-1 pt-2 font-mono text-[10px] sm:px-3">
          <span className="reader-stream__label shrink-0">
            {row.flow_name || "scene"} · state {row.state_id || "—"}
          </span>
          {row.plot_mode && row.plot_mode !== "Normal" && (
            <span className="reader-stream__mode shrink-0">{row.plot_mode}</span>
          )}
          <span className="h-px min-w-4 flex-1 bg-white/10" aria-hidden="true" />
        </div>
      </RowWrapper>
    );
  }

  return (
    <RowWrapper index={index} style={style} setSize={data.setSize}>
      <DialogueLine
        line={row.line}
        primary={data.primary}
        highlightQ={data.highlightQ}
        plotMode={row.plot_mode}
        lineIndex={data.lineIndex}
      />
    </RowWrapper>
  );
}

interface DialogueStreamProps {
  rows: QuestRow[];
  primary: Lang;
  highlightQ: string | null;
  lineIndex: LineIndex;
  resetKey: string;
  anchorLineId: number | null;
}

export default function DialogueStream({
  rows,
  primary,
  highlightQ,
  lineIndex,
  resetKey,
  anchorLineId,
}: DialogueStreamProps) {
  const listRef = useRef<List>(null);
  const scrolledRef = useRef(false);
  const sizeMap = useRef<Record<number, number>>({});
  const [, forceUpdate] = useState(0);
  const [listHeight, setListHeight] = useState(600);
  const containerRef = useRef<HTMLDivElement>(null);

  const setSize = useCallback((index: number, size: number) => {
    if (sizeMap.current[index] === size) return;
    sizeMap.current[index] = size;
    listRef.current?.resetAfterIndex(index, false);
    forceUpdate((count) => count + 1);
  }, []);

  useEffect(() => {
    scrolledRef.current = false;
    sizeMap.current = {};
    listRef.current?.resetAfterIndex(0, false);
  }, [resetKey]);

  useLayoutEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) setListHeight(entry.contentRect.height);
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (anchorLineId == null || scrolledRef.current) return;
    const index = rows.findIndex(
      (row) => row.kind === "line" && row.line.id === anchorLineId,
    );
    if (index < 0 || !listRef.current) return;

    scrolledRef.current = true;
    let settleTimer = 0;
    let highlightTimer = 0;
    let clearTimer = 0;
    const initialTimer = window.setTimeout(() => {
      listRef.current?.scrollToItem(index, "center");
      settleTimer = window.setTimeout(() => {
        listRef.current?.scrollToItem(index, "center");
        highlightTimer = window.setTimeout(() => {
          const element = document.getElementById(`L${anchorLineId}`);
          if (!element) return;
          element.classList.add("is-highlighted");
          clearTimer = window.setTimeout(
            () => element.classList.remove("is-highlighted"),
            3000,
          );
        }, 50);
      }, 100);
    }, 100);

    return () => {
      window.clearTimeout(initialTimer);
      window.clearTimeout(settleTimer);
      window.clearTimeout(highlightTimer);
      window.clearTimeout(clearTimer);
    };
  }, [anchorLineId, rows]);

  const rowData = useMemo<RowData>(
    () => ({ rows, primary, highlightQ, lineIndex, setSize }),
    [rows, primary, highlightQ, lineIndex, setSize],
  );

  const getItemSize = useCallback(
    (index: number) =>
      sizeMap.current[index] ??
      (rows[index]?.kind === "header" ? HEADER_HEIGHT : LINE_HEIGHT),
    [rows],
  );

  return (
    <div
      ref={containerRef}
      className="reader-stream min-h-0 w-full flex-1"
      role="region"
      aria-label="Quest dialogue"
    >
      <ErrorBoundary>
        <List
          ref={listRef}
          height={listHeight}
          itemCount={rows.length}
          itemSize={getItemSize}
          width="100%"
          outerElementType={ReaderListOuter}
          overscanCount={4}
          estimatedItemSize={LINE_HEIGHT}
          itemData={rowData}
          itemKey={(index, data) => data.rows[index]?.key ?? String(index)}
        >
          {Row}
        </List>
      </ErrorBoundary>
    </div>
  );
}
