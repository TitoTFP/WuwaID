import { useEffect, useRef } from "react";

interface Shortcut {
  keys: string;
  description: string;
}

const SHORTCUTS: Shortcut[] = [
  { keys: "j", description: "Select next line in tree" },
  { keys: "k", description: "Select previous line in tree" },
  { keys: "Ctrl/⌘ + S", description: "Save current draft" },
  { keys: "Esc", description: "Close dialog or clear search" },
  { keys: "?", description: "Toggle this help" },
];

export default function ShortcutsHelp({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      closeRef.current?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      className="fixed inset-0 m-auto max-h-[calc(100dvh-1.5rem)] w-[calc(100%_-_1.5rem)] max-w-md border border-white/15 bg-bg-2 p-0 text-slate-100 backdrop:bg-black/70"
      aria-label="Keyboard shortcuts"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="w-full bg-bg-2 p-4 sm:p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-serif text-lg text-slate-100">Keyboard shortcuts</h2>
          <button
            ref={closeRef}
            type="button"
            className="grid min-h-11 min-w-11 place-items-center text-sm text-slate-400 hover:text-slate-200"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <ul className="space-y-2 text-sm">
          {SHORTCUTS.map((shortcut) => (
            <li key={shortcut.keys} className="flex items-center justify-between gap-3">
              <span className="text-slate-300">{shortcut.description}</span>
              <kbd className="rounded-sm border border-white/10 bg-bg-1 px-2 py-1 font-mono text-xs text-slate-200">
                {shortcut.keys}
              </kbd>
            </li>
          ))}
        </ul>
        <div className="mt-3 text-right">
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </dialog>
  );
}
