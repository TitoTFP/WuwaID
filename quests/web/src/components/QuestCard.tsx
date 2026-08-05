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
  const pct = q.total_lines > 0 ? (q.translated_count / q.total_lines) * 100 : 0;
  const isFullyTranslated = pct >= 100;

  return (
    <Link
      to={`/quests/${q.qid}`}
      className="group grid min-h-20 min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-1 py-3 transition-colors hover:bg-bg-2 focus-visible:bg-bg-2 sm:px-3"
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[10px] text-slate-500">
          <span>#{q.qid}</span>
          <span>{TYPE_LABEL[q.quest_type] ?? `type ${q.quest_type}`}</span>
          {isDup && <span className="text-accent-signal">record {dupIndex}/{dupTotal}</span>}
          {q.side === 1 && <span className="text-accent-signal">side quest</span>}
        </div>
        <div className="mt-1 min-w-0 truncate text-sm font-medium text-slate-100 transition-colors group-hover:text-accent-signal sm:text-base">
          {q.quest_name}
        </div>
      </div>

      <div className="w-24 shrink-0 text-right sm:w-32">
        <div className="font-mono text-[10px] leading-5 text-slate-500 tabular-nums">
          <div>{q.total_lines} lines</div>
          <div>{q.translated_count} translated · {pct.toFixed(0)}%</div>
        </div>
        <div
          className="mt-1 h-px w-full bg-white/10"
          role="progressbar"
          aria-label={`${q.quest_name} translation progress`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(pct)}
        >
          <div
            className={`h-px ${isFullyTranslated ? "bg-accent-signal" : "bg-accent-signal"}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    </Link>
  );
}
