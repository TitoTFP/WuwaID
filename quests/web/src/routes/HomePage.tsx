import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";

export default function HomePage() {
  const { data: chapters = [] } = useQuery({ queryKey: ["chapters"], queryFn: api.chapters });
  const { data: speakers = [] } = useQuery({ queryKey: ["speakers-top"], queryFn: api.speakers });

  return (
    <div className="container-narrow gap-10 pb-8 sm:gap-12">
      <header className="border-b border-white/10 pb-7 pt-2 sm:pb-9">
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-slate-500">
          Dialogue archive · v0.1
        </p>
        <h1 className="mt-3 min-w-0 max-w-3xl [overflow-wrap:anywhere] font-serif text-3xl leading-tight text-slate-100 sm:text-4xl">
          Wuthering Waves Quest Dialogue
        </h1>
        <p className="mt-3 max-w-prose text-base leading-relaxed text-slate-400">
          Browse every quest from the 3.3 main story plus all side quests in
          <span className="text-accent-teal"> 中文</span>,
          <span className="text-accent-gold"> English</span>, and
          <span className="text-slate-300"> 日本語</span> side-by-side.
          Search inside the lines, filter by speaker, jump to any choice point.
        </p>
        <nav aria-label="Archive shortcuts" className="mt-5 flex flex-wrap items-center gap-2">
          <Link to="/side-quests" className="btn btn-active whitespace-nowrap">Side quests</Link>
          <Link to="/search?q=threnodian" className="btn whitespace-nowrap">Search dialogue</Link>
        </nav>
      </header>

      <section aria-labelledby="chapters-heading">
        <div className="mb-3 flex items-end justify-between gap-4">
          <h2 id="chapters-heading" className="font-serif text-xl text-slate-100">Chapters</h2>
          <span className="font-mono text-[10px] text-slate-500">{chapters.length} records</span>
        </div>
        <div className="divide-y divide-white/10 border-y border-white/10">
          {chapters.map((c) => (
            <Link
              key={`${c.id}-${c.name}`}
              to={c.id === 0 ? "/side-quests" : `/chapters/${c.id}`}
              className="group grid min-h-16 min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-1 py-3 transition-colors hover:bg-bg-2 focus-visible:bg-bg-2 sm:px-3"
            >
              <div className="min-w-0">
                <div className="font-mono text-[10px] text-slate-500">Chapter {c.id || "—"}</div>
                <div className="mt-1 truncate font-serif text-lg text-slate-100 transition-colors group-hover:text-accent-gold" title={c.name}>
                  {c.name}
                </div>
              </div>
              <div className="text-right font-mono text-[10px] leading-5 text-slate-500 tabular-nums sm:text-xs">
                <div>{c.quest_count} quests</div>
                <div>{c.line_count.toLocaleString()} lines</div>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section aria-labelledby="speakers-heading">
        <div className="mb-3 flex items-end justify-between gap-4">
          <h2 id="speakers-heading" className="font-serif text-xl text-slate-100">Most prolific speakers</h2>
          <span className="hidden text-xs text-slate-500 sm:inline">Search by speaker</span>
        </div>
        <div className="grid grid-cols-1 border-y border-white/10 sm:grid-cols-2 sm:gap-x-8">
          {speakers.slice(0, 24).map((s) => (
            <Link
              key={s.name}
              to={`/search?q=${encodeURIComponent(s.name)}&lang=en`}
              className="group flex min-h-11 min-w-0 items-center justify-between gap-4 border-b border-white/10 px-1 py-3 text-sm text-slate-300 transition-colors hover:bg-bg-2 hover:text-accent-teal focus-visible:bg-bg-2 sm:px-2"
              title={`${s.line_count} lines in ${s.quest_count} quests`}
            >
              <span className="min-w-0 truncate">{s.name}</span>
              <span className="shrink-0 font-mono text-[10px] text-slate-500 tabular-nums">
                {s.line_count.toLocaleString()} lines
              </span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
