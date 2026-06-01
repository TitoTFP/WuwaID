import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";

export default function HomePage() {
  const { data: chapters = [] } = useQuery({ queryKey: ["chapters"], queryFn: api.chapters });
  const { data: speakers = [] } = useQuery({ queryKey: ["speakers-top"], queryFn: api.speakers });

  return (
    <div className="container-narrow space-y-10">
      <section className="rounded-2xl border border-white/5 bg-gradient-to-br from-bg-1 via-bg-2 to-bg-1 p-6 sm:p-10">
        <div className="flex items-start gap-3 mb-2">
          <span className="chip text-accent-gold/80 border-accent-gold/30">v0.1</span>
          <span className="text-[10px] text-slate-500">viewer only</span>
        </div>
        <h1 className="font-serif text-3xl sm:text-4xl text-slate-100 leading-tight">
          Wuthering Waves
          <br />
          <span className="text-accent-gold">Quest Dialogue</span>
        </h1>
        <p className="mt-3 max-w-2xl text-sm text-slate-400 leading-relaxed">
          Browse every quest from the 3.3 main story plus all side quests in
          <span className="text-accent-teal"> 中文</span>,
          <span className="text-accent-gold"> English</span>, and
          <span className="text-pink-300"> 日本語</span> side-by-side.
          Search inside the lines, filter by speaker, jump to any choice point.
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <Link to="/side-quests" className="btn btn-active">Browse Side Quests</Link>
          <Link to="/search?q=threnodian" className="btn">Try a search</Link>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-xs uppercase tracking-widest text-slate-500">Chapters</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {chapters.map((c) => (
            <Link
              key={`${c.id}-${c.name}`}
              to={c.id === 0 ? "/side-quests" : `/chapters/${c.id}`}
              className="card p-4 sm:p-5 transition hover:border-accent-gold/30 hover:bg-bg-2 group"
            >
              <div className="text-[10px] text-slate-500 font-mono">Chapter {c.id || "—"}</div>
              <div className="mt-1 font-serif text-lg text-slate-100 group-hover:text-accent-gold transition">
                {c.name}
              </div>
              <div className="mt-3 flex items-center gap-3 text-xs text-slate-400">
                <span>{c.quest_count} quests</span>
                <span className="text-slate-600">·</span>
                <span>{c.line_count.toLocaleString()} lines</span>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-xs uppercase tracking-widest text-slate-500">Most prolific speakers</h2>
        <div className="flex flex-wrap gap-2">
          {speakers.slice(0, 24).map((s) => (
            <Link
              key={s.name}
              to={`/search?q=${encodeURIComponent(s.name)}&lang=en`}
              className="chip hover:border-accent-teal/40 hover:text-accent-teal transition"
              title={`${s.line_count} lines in ${s.quest_count} quests`}
            >
              {s.name}
              <span className="text-slate-500">{s.line_count}</span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
