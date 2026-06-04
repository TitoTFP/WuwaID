interface Shortcut {
  keys: string;
  description: string;
}

const SHORTCUTS: Shortcut[] = [
  { keys: "j", description: "Select next line in tree" },
  { keys: "k", description: "Select previous line in tree" },
  { keys: "Ctrl/⌘ + S", description: "Save current draft" },
  { keys: "1 / 2 / 3", description: "Switch to EN / ZH-Hans / JA tab" },
  { keys: "4", description: "Switch to META tab" },
  { keys: "[ / ]", description: "Previous / next tab" },
  { keys: "e", description: "Focus selected line in tree" },
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
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg border border-white/10 bg-bg-2 p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-serif text-lg text-slate-100">Keyboard shortcuts</h2>
          <button
            type="button"
            className="text-xs text-slate-400 hover:text-slate-200"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <ul className="space-y-1.5 text-sm">
          {SHORTCUTS.map((shortcut) => (
            <li key={shortcut.keys} className="flex items-center justify-between gap-3">
              <span className="text-slate-300">{shortcut.description}</span>
              <kbd className="rounded border border-white/10 bg-bg-1 px-2 py-0.5 font-mono text-xs text-slate-200">
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
    </div>
  );
}
