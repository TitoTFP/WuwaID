import { useEffect, useRef, type ReactNode } from "react";

export type WorkbenchPane = "navigation" | "detail";

interface WorkbenchLayoutProps {
  idPrefix: string;
  pane: WorkbenchPane;
  onPaneChange: (pane: WorkbenchPane) => void;
  detailDisabled?: boolean;
  navigationLabel?: string;
  detailLabel?: string;
  navigation: ReactNode;
  detail: ReactNode;
}

export default function WorkbenchLayout({
  idPrefix,
  pane,
  onPaneChange,
  detailDisabled = false,
  navigationLabel = "Lines",
  detailLabel = "Translation",
  navigation,
  detail,
}: WorkbenchLayoutProps) {
  const detailTabRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (pane !== "detail" || !window.matchMedia("(max-width: 1023px)").matches) return;
    const frame = requestAnimationFrame(() =>
      detailTabRef.current?.focus({ preventScroll: true }),
    );
    return () => cancelAnimationFrame(frame);
  }, [pane]);

  const navigationId = `${idPrefix}-navigation-panel`;
  const detailId = `${idPrefix}-detail-panel`;

  return (
    <>
      <div className="workbench-tabs mb-2 grid grid-cols-2 lg:hidden" role="group" aria-label="Workbench panes">
        <button
          type="button"
          aria-pressed={pane === "navigation"}
          aria-controls={navigationId}
          className={`workbench-tab ${pane === "navigation" ? "is-active" : ""}`}
          onClick={() => onPaneChange("navigation")}
        >
          {navigationLabel}
        </button>
        <button
          ref={detailTabRef}
          type="button"
          aria-pressed={pane === "detail"}
          aria-controls={detailId}
          className={`workbench-tab ${pane === "detail" ? "is-active" : ""}`}
          disabled={detailDisabled}
          onClick={() => onPaneChange("detail")}
        >
          {detailLabel}
        </button>
      </div>

      <div className="workbench-layout">
        <div
          id={navigationId}
          className={`workbench-layout__navigation ${pane === "navigation" ? "is-visible" : "is-hidden"}`}
        >
          {navigation}
        </div>
        <section
          id={detailId}
          className={`workbench-layout__detail ${pane === "detail" ? "is-visible" : "is-hidden"}`}
        >
          {detail}
        </section>
      </div>
    </>
  );
}
