import { useEffect, useId, useRef, useState } from "react";

export type ExportMode = "full" | "untranslated" | "english_full";

export interface ExportDialogProps {
  open: boolean;
  title: string;
  onConfirm: (mode: ExportMode) => void;
  onCancel: () => void;
  isPending?: boolean;
}

export default function ExportDialog({
  open,
  title,
  onConfirm,
  onCancel,
  isPending = false,
}: ExportDialogProps) {
  const [option, setOption] = useState<ExportMode>("full");
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const firstOptionRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      firstOptionRef.current?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      className="fixed inset-0 m-auto max-h-[calc(100dvh-1.5rem)] w-[calc(100%_-_1.5rem)] max-w-sm border border-white/15 bg-bg-2 p-0 text-slate-100 backdrop:bg-black/70"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={(event) => {
        event.preventDefault();
        if (!isPending) onCancel();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && !isPending) onCancel();
      }}
    >
      <div
        className="w-full space-y-4 bg-bg-2 p-4 sm:p-5"
        onClick={(event) => event.stopPropagation()}
      >
        <div>
          <h2 id={titleId} className="font-serif text-xl text-slate-100">{title}</h2>
          <p id={descriptionId} className="mt-1 text-base text-slate-500">Choose which source rows to include.</p>
        </div>
        
        <div className="divide-y divide-white/10 border-y border-white/10">
          <label className="flex min-h-14 cursor-pointer items-center gap-3 py-3 text-sm text-slate-300 transition-colors hover:text-slate-100">
            <input
              ref={firstOptionRef}
              type="radio"
              name="export-option"
              checked={option === "full"}
              onChange={() => setOption("full")}
              className="h-4 w-4 accent-accent-signal"
            />
            <div className="flex flex-col">
              <span className="font-medium">Full export</span>
              <span className="text-xs text-slate-500">Export all keys with Indonesian translations over English fallback</span>
            </div>
          </label>
          
          <label className="flex min-h-14 cursor-pointer items-center gap-3 py-3 text-sm text-slate-300 transition-colors hover:text-slate-100">
            <input
              type="radio"
              name="export-option"
              checked={option === "untranslated"}
              onChange={() => setOption("untranslated")}
              className="h-4 w-4 accent-accent-signal"
            />
            <div className="flex flex-col">
              <span className="font-medium">Only untranslated</span>
              <span className="text-xs text-slate-500">Export only lines that haven't been translated yet (with English fallback)</span>
            </div>
          </label>

          <label className="flex min-h-14 cursor-pointer items-center gap-3 py-3 text-sm text-slate-300 transition-colors hover:text-slate-100">
            <input
              type="radio"
              name="export-option"
              checked={option === "english_full"}
              onChange={() => setOption("english_full")}
              className="h-4 w-4 accent-accent-signal"
            />
            <div className="flex flex-col">
              <span className="font-medium">Full English export</span>
              <span className="text-xs text-slate-500">Export all keys from the English source database</span>
            </div>
          </label>
        </div>

        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <button
            type="button"
            className="btn text-xs"
            onClick={onCancel}
            disabled={isPending}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-active text-xs"
            onClick={() => onConfirm(option)}
            disabled={isPending}
          >
            {isPending ? "Exporting…" : "Export"}
          </button>
        </div>
      </div>
    </dialog>
  );
}
