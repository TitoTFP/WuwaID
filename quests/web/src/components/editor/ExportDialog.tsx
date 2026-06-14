import { useState } from "react";

export interface ExportDialogProps {
  open: boolean;
  title: string;
  onConfirm: (onlyUntranslated: boolean) => void;
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
  const [option, setOption] = useState<"full" | "untranslated">("full");

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
      <div className="w-full max-w-sm rounded-lg border border-white/10 bg-bg-2 p-5 shadow-xl space-y-4">
        <h2 className="font-serif text-lg text-slate-100">{title}</h2>
        
        <div className="space-y-3">
          <label className="flex items-center gap-3 cursor-pointer text-sm text-slate-300 hover:text-slate-100 transition-colors">
            <input
              type="radio"
              name="export-option"
              checked={option === "full"}
              onChange={() => setOption("full")}
              className="h-4 w-4 accent-accent-gold"
            />
            <div className="flex flex-col">
              <span className="font-medium">Full export</span>
              <span className="text-xs text-slate-500">Export all keys (translated and untranslated)</span>
            </div>
          </label>
          
          <label className="flex items-center gap-3 cursor-pointer text-sm text-slate-300 hover:text-slate-100 transition-colors">
            <input
              type="radio"
              name="export-option"
              checked={option === "untranslated"}
              onChange={() => setOption("untranslated")}
              className="h-4 w-4 accent-accent-gold"
            />
            <div className="flex flex-col">
              <span className="font-medium">Only untranslated</span>
              <span className="text-xs text-slate-500">Export only lines that haven't been translated yet (with English fallback)</span>
            </div>
          </label>
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-white/5">
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
            onClick={() => onConfirm(option === "untranslated")}
            disabled={isPending}
          >
            {isPending ? "Exporting..." : "Export"}
          </button>
        </div>
      </div>
    </div>
  );
}
