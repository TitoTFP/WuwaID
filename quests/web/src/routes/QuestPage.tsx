import { Link, useParams, useSearchParams } from "react-router-dom";
import { useEffect, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import DialogueLine from "../components/DialogueLine";
import type { Lang } from "../lib/types";

export default function QuestPage() {
  const { qid = "0" } = useParams();
  const qidN = Number(qid);
  const [params] = useSearchParams();
  const primary = (params.get("lang") ?? "en") as Lang;
  const highlightQ = params.get("q");

  const { data: quest, isLoading, error } = useQuery({
    queryKey: ["quest", qidN],
    queryFn: () => api.quest(qidN),
    enabled: !!qidN,
  });

  // Scroll to the line indicated by #L<id> in the URL hash
  const scrolledRef = useRef(false);
  useEffect(() => {
    if (!quest || scrolledRef.current) return;
    const m = window.location.hash.match(/^#L(\d+)$/);
    if (m) {
      const el = document.getElementById(`L${m[1]}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add("is-highlighted");
        setTimeout(() => el.classList.remove("is-highlighted"), 3000);
        scrolledRef.current = true;
      }
    }
  }, [quest]);

  const groups = useMemo(() => {
    if (!quest) return [];
    // Build a (state_key) → plot_mode map from the flow.states arrays
    const plotModeByKey = new Map<string, string>();
    for (const f of quest.flows) {
      for (const s of f.states ?? []) {
        plotModeByKey.set(s.state_key, s.plot_mode);
      }
    }
    const lines = quest.all_lines;
    const g: { flow_name: string; state_id: number; plot_mode: string; lines: typeof lines }[] = [];
    let cur: { flow_name: string; state_id: number; plot_mode: string; lines: typeof lines } | null = null;
    for (const l of lines) {
      // State keys are "<FlowListName>_<StateId>_<SubId>". The FlowListName
      // itself can contain underscores (e.g. "剧情_3_3_拉海洛主线_下半"), so a
      // naive split("_") would shred it. Match the exporter's parse:
      const m = (l.state_key ?? "").match(/^(.*)_(\d+)_(\d+)$/);
      if (!m) continue;
      const flow_name = m[1];
      const state_id = Number(m[2]);
      const pm = plotModeByKey.get(l.state_key ?? "") ?? "Normal";
      if (!cur || cur.flow_name !== flow_name || cur.state_id !== state_id) {
        cur = { flow_name, state_id, plot_mode: pm, lines: [] };
        g.push(cur);
      }
      cur.lines.push(l);
    }
    return g;
  }, [quest]);

  if (isLoading) return <div className="container-narrow text-sm text-slate-500">Loading quest…</div>;
  if (error || !quest) return <div className="container-narrow text-sm text-rose-400">Quest {qid} not found.</div>;

  return (
    <div className="container-narrow space-y-5">
      <div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link to={quest.side === 1 ? "/side-quests" : `/chapters/${quest.chapter_id ?? 0}`} className="link text-xs">
            ← {quest.side === 1 ? "side quests" : (quest.chapter_name ?? "chapter")}
          </Link>
          <Link to={`/editor/${quest.quest_id}`} className="btn text-xs">
            Edit
          </Link>
        </div>
        <h1 className="mt-1 font-serif text-2xl text-slate-100">
          {quest.quest_name}
        </h1>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <span className="font-mono">#{quest.quest_id}</span>
          {quest.chapter_name && quest.side === 0 && (
            <span className="text-accent-teal">{quest.chapter_name}</span>
          )}
          <span>{quest.total_lines} lines</span>
        </div>
      </div>

      {groups.map((g, i) => (
        <section key={i}>
          <h2 className="mb-2 flex items-center gap-2 text-[10px] uppercase tracking-widest text-slate-600">
            <span>{g.flow_name || "scene"} · state {g.state_id || "—"}</span>
            {g.plot_mode && g.plot_mode !== "Normal" && (
              <span className="rounded border border-white/10 bg-bg-2 px-1.5 py-0.5 text-[9px] normal-case tracking-normal text-slate-400">
                {g.plot_mode}
              </span>
            )}
          </h2>
          <div className="space-y-2">
            {g.lines.map((line) => (
              <DialogueLine
                key={line.id}
                line={line}
                primary={primary}
                highlightQ={highlightQ}
                plotMode={g.plot_mode}
                allLines={quest.all_lines}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
