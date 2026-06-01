import type { LineSummary } from "../../lib/types";

export default function LineList({
  lines,
  selectedId,
  onSelect,
  pendingCounts,
}: {
  lines: LineSummary[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  pendingCounts: Record<number, number>;
}) {
  return (
    <div className="space-y-0.5">
      {lines.map((l) => {
        const pending = pendingCounts[l.id] ?? 0;
        const isSelected = l.id === selectedId;
        return (
          <button
            key={l.id}
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
                  ✎{pending}
                </span>
              )}
            </div>
            <div className="text-slate-500 text-[10px] truncate pl-7">
              {l.text_en || <em className="opacity-50">—</em>}
            </div>
          </button>
        );
      })}
    </div>
  );
}
