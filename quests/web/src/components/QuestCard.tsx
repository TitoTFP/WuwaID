import { Link } from "react-router-dom";
import type { QuestListItem } from "../lib/types";

const TYPE_LABEL: Record<number, string> = {
  1: "Main",
  2: "World",
  3: "Companion",
  4: "Story",
  7: "Event",
  9: "Daily",
  10: "Tutorial",
  11: "Challenge",
  14: "Chain",
  100: "Activity",
};

export default function QuestCard({
  q,
  dupIndex,
  dupTotal,
}: {
  q: QuestListItem;
  dupIndex?: number;
  dupTotal?: number;
}) {
  const isDup = (dupTotal ?? 0) > 1;
  return (
    <Link
      to={`/quests/${q.qid}`}
      className={`card group block p-3 sm:p-4 transition hover:border-accent-gold/30 hover:bg-bg-2 ${
        isDup ? "border-l-2 border-l-accent-gold/60" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[10px] text-slate-500">
            <span className="font-mono">#{q.qid}</span>
            {isDup && (
              <span className="text-accent-gold">
                {dupIndex}/{dupTotal}
              </span>
            )}
            {q.side === 1 && <span className="text-accent-teal">side</span>}
          </div>
          <div className="mt-0.5 truncate text-sm font-medium text-slate-100 group-hover:text-accent-gold">
            {q.quest_name}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className="chip">{TYPE_LABEL[q.quest_type] ?? `t${q.quest_type}`}</span>
          <span className="text-[10px] text-slate-500">{q.total_lines} lines</span>
        </div>
      </div>
    </Link>
  );
}
