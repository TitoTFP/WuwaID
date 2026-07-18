import { useCallback, useEffect, useRef, useState } from "react";

export default function ResizeHandle({
  storageKey,
  min = 240,
  max = 720,
  onChange,
}: {
  storageKey: string;
  min?: number;
  max?: number;
  onChange?: (width: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);
  const storedWidthRef = useRef<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const [currentWidth, setCurrentWidth] = useState(min);

  const clampWidth = useCallback((requested: number) => {
    const sidebar = ref.current?.parentElement;
    const workspace = sidebar?.parentElement;
    if (!workspace) return Math.min(max, Math.max(min, requested));
    const gap = Number.parseFloat(window.getComputedStyle(workspace).columnGap) || 0;
    const available = Math.max(min, workspace.clientWidth - gap - min);
    return Math.min(max, available, Math.max(min, requested));
  }, [max, min]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const parent = ref.current?.parentElement;
    if (!parent) return;
    parent.style.removeProperty("width");
    const raw = window.localStorage.getItem(storageKey);
    const parsed = raw ? Number(raw) : Number.NaN;
    storedWidthRef.current = Number.isFinite(parsed)
      ? Math.min(max, Math.max(min, parsed))
      : null;

    const desktop = window.matchMedia("(min-width: 1024px)");
    const syncWidth = () => {
      if (!desktop.matches) {
        parent.style.removeProperty("width");
        return;
      }
      const preferred = storedWidthRef.current ?? parent.getBoundingClientRect().width;
      const width = clampWidth(preferred);
      parent.style.width = `${width}px`;
      setCurrentWidth(width);
      onChange?.(width);
    };
    syncWidth();
    const workspace = parent.parentElement;
    const observer = workspace ? new ResizeObserver(syncWidth) : null;
    if (workspace) observer?.observe(workspace);
    desktop.addEventListener("change", syncWidth);
    return () => {
      observer?.disconnect();
      desktop.removeEventListener("change", syncWidth);
    };
  }, [storageKey, min, max, onChange, clampWidth]);

  const persist = useCallback(
    (width: number) => {
      try {
        window.localStorage.setItem(storageKey, String(width));
      } catch {
        // ignore
      }
    },
    [storageKey],
  );

  const onMouseDown = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    const parent = ref.current?.parentElement;
    if (!parent) return;
    startXRef.current = event.clientX;
    startWidthRef.current = parent.getBoundingClientRect().width;
    setDragging(true);
  }, []);

  useEffect(() => {
    if (!dragging) return;
    function onMove(event: MouseEvent) {
      const parent = ref.current?.parentElement;
      if (!parent) return;
      const delta = event.clientX - startXRef.current;
      const next = clampWidth(startWidthRef.current + delta);
      parent.style.width = `${next}px`;
      storedWidthRef.current = next;
      setCurrentWidth(next);
      onChange?.(next);
    }
    function onUp() {
      setDragging(false);
      const parent = ref.current?.parentElement;
      if (!parent) return;
      const final = parent.getBoundingClientRect().width;
      persist(final);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [dragging, clampWidth, onChange, persist]);

  const onKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const parent = ref.current?.parentElement;
    if (!parent) return;
    const delta = event.key === "ArrowLeft" ? -16 : 16;
    const next = clampWidth(parent.getBoundingClientRect().width + delta);
    parent.style.width = `${next}px`;
    storedWidthRef.current = next;
    setCurrentWidth(next);
    persist(next);
    onChange?.(next);
  }, [clampWidth, onChange, persist]);

  return (
    <div
      ref={ref}
      role="separator"
      tabIndex={0}
      aria-label="Resize line list"
      aria-orientation="vertical"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Math.round(currentWidth)}
      onMouseDown={onMouseDown}
      onKeyDown={onKeyDown}
      className={[
        "group relative hidden w-1 shrink-0 cursor-col-resize transition-colors focus-visible:bg-accent-gold/60 lg:block",
        dragging ? "bg-accent-gold/60" : "bg-transparent hover:bg-accent-gold/30",
      ].join(" ")}
      title="Drag to resize"
    >
      <span className="pointer-events-none absolute inset-y-0 -left-1 -right-1" />
    </div>
  );
}
