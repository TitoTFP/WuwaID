import type { LineSummary } from "../../lib/types";

export default function LineList({
  lines,
  selectedId,
  onSelect,
  pendingCounts,
  onMoveUp,
  onMoveDown,
  onInsertAfter,
}: {
  lines: LineSummary[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  pendingCounts: Record<number, number>;
  onMoveUp?: (id: number) => void;
  onMoveDown?: (id: number) => void;
  onInsertAfter?: (id: number) => void;
}) {
  return (
    <div className="space-y-0.5">
      {lines.map((l) => {
        const pending = pendingCounts[l.id] ?? 0;
        const isSelected = l.id === selectedId;
        return (
          <div key={l.id} className="group rounded">
            <button
              type="button"
              onClick={() => onSelect(l.id)}
              className={[
                "w-full text-left px-2 py-1.5 rounded text-xs font-mono transition-colors",
                isSelected
                  ? "bg-accent-gold/10 text-accent-gold"
                  : "text-slate-300 hover:bg-white/5",
              ].join(" ")}
            >
              <div className="flex items-center gap-1.5">
                <span className="text-slate-500">#{l.id}</span>
                <span className="text-slate-400">{l.type}</span>
                {l.speaker_en && (
                  <span className="text-slate-500 truncate flex-1">{l.speaker_en}</span>
                )}
                {l.is_edited && (
                  <span
                    className="text-[9px] px-1 py-0.5 rounded bg-accent-gold/20 text-accent-gold"
                    title="Has approved edits"
                  >
                    edited
                  </span>
                )}
                {pending > 0 && (
                  <span
                    className="text-[9px] px-1 py-0.5 rounded bg-violet-500/20 text-violet-300"
                    title="Pending draft(s) for this line"
                  >
                    *{pending}
                  </span>
                )}
              </div>
              <div className="text-slate-500 text-[10px] truncate pl-7">
                {l.text_en || <em className="opacity-50">-</em>}
              </div>
            </button>
            {(onMoveUp || onMoveDown || onInsertAfter) && (
              <div className="hidden group-hover:flex gap-1 px-2 pb-1">
                <button type="button" className="btn px-1.5 py-0.5 text-[10px]" onClick={() => onMoveUp?.(l.id)}>up</button>
                <button type="button" className="btn px-1.5 py-0.5 text-[10px]" onClick={() => onMoveDown?.(l.id)}>down</button>
                <button type="button" className="btn px-1.5 py-0.5 text-[10px]" onClick={() => onInsertAfter?.(l.id)}>insert</button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
