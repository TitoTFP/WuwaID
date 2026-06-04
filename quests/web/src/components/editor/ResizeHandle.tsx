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
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return;
    const parent = ref.current?.parentElement;
    if (!parent) return;
    const clamped = Math.min(max, Math.max(min, parsed));
    parent.style.width = `${clamped}px`;
    onChange?.(clamped);
  }, [storageKey, min, max, onChange]);

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
      const next = Math.min(max, Math.max(min, startWidthRef.current + delta));
      parent.style.width = `${next}px`;
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
  }, [dragging, max, min, onChange, persist]);

  return (
    <div
      ref={ref}
      role="separator"
      aria-orientation="vertical"
      aria-valuemin={min}
      aria-valuemax={max}
      onMouseDown={onMouseDown}
      className={[
        "group relative w-1 shrink-0 cursor-col-resize transition-colors",
        dragging ? "bg-accent-gold/60" : "bg-transparent hover:bg-accent-gold/30",
      ].join(" ")}
      title="Drag to resize"
    >
      <span className="pointer-events-none absolute inset-y-0 -left-1 -right-1" />
    </div>
  );
}
