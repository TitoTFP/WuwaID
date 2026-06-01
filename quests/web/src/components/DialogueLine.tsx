import type { DialogueLine, Lang, PlotMode } from "../lib/types";
import SpeakerBadge from "./SpeakerBadge";

const LANG_LABEL: Record<Lang, string> = {
  en: "EN",
  "zh-Hans": "中",
  ja: "JA",
};

const ORDER: Lang[] = ["en", "zh-Hans", "ja"];

const PLOT_MODE_LABEL: Partial<Record<string, string>> = {
  PhoneMessage: "WavesLine",
  BlackScreen: "fade",
  Chapter: "chapter",
};

function isPhoneMode(mode: PlotMode | undefined): boolean {
  return mode === "PhoneMessage";
}

function isCinematicMode(mode: PlotMode | undefined): boolean {
  // "BlackScreen" or any LevelA..F (camera focus) — visually different
  if (!mode) return false;
  return mode === "BlackScreen" || /^Level[A-Z]$/.test(mode);
}

function highlight(text: string, q: string | null): React.ReactNode {
  if (!q) return text;
  const lower = text.toLowerCase();
  const lq = q.toLowerCase();
  const i = lower.indexOf(lq);
  if (i < 0) return text;
  return (
    <>
      {text.slice(0, i)}
      <mark className="rounded bg-accent-gold/30 px-0.5 text-accent-gold">
        {text.slice(i, i + lq.length)}
      </mark>
      {text.slice(i + lq.length)}
    </>
  );
}

// Resolve an option's branch target to a line id within the same quest.
// We do this by matching the option's plot_line_key against any line's
// plot_line_key OR text_key (TidTalk == PlotLineKey in this game's data).
function resolveTargetId(
  opt: { plot_line_key?: string; actions?: { name: string; params: { TalkId?: number } }[] },
  allLines: DialogueLine[],
): number | null {
  // Prefer plot_line_key match
  if (opt.plot_line_key) {
    const hit = allLines.find((l) => l.plot_line_key === opt.plot_line_key || l.text_key === opt.plot_line_key);
    if (hit) return hit.id;
  }
  // Fall back: JumpTalk's TalkId points at the line id within the state
  for (const a of opt.actions ?? []) {
    if (a.name === "JumpTalk" && typeof a.params?.TalkId === "number") {
      // TalkId == item.Id in ShowTalk.TalkItems, which we used as `id` on the line
      const hit = allLines.find((l) => l.id === a.params.TalkId);
      if (hit) return hit.id;
    }
  }
  return null;
}

function scrollToLine(id: number) {
  const el = document.getElementById(`L${id}`);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.add("is-highlighted");
  window.setTimeout(() => el.classList.remove("is-highlighted"), 3000);
}

export default function DialogueLine({
  line,
  primary,
  highlightQ,
  plotMode,
  allLines,
}: {
  line: DialogueLine;
  primary: Lang;
  highlightQ?: string | null;
  plotMode?: PlotMode;
  allLines?: DialogueLine[];
}) {
  const isEmptySpeaker =
    !line.speaker_en &&
    !line["speaker_zh-Hans"] &&
    !line.speaker_ja;
  const isCenterText = line.type === "CenterText";
  const isOption = line.type === "Option";
  const isMarker = isCenterText || isEmptySpeaker;

  const phone = isPhoneMode(plotMode);
  const cinematic = isCinematicMode(plotMode);

  return (
    <div
      id={`L${line.id}`}
      data-line-id={line.id}
      data-plot-mode={plotMode ?? ""}
      className={[
        "dialogue-line",
        isMarker ? "is-marker" : "",
        phone ? "is-phone" : "",
        cinematic ? "is-cinematic" : "",
      ].filter(Boolean).join(" ")}
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <SpeakerBadge name={line.speaker_en} />
        {phone && (
          <span className="chip text-accent-gold/90 border-accent-gold/40">
            {PLOT_MODE_LABEL.PhoneMessage}
          </span>
        )}
        {cinematic && plotMode && PLOT_MODE_LABEL[plotMode] && (
          <span className="chip text-slate-400/80">{PLOT_MODE_LABEL[plotMode]}</span>
        )}
        {isEmptySpeaker && <span className="chip text-amber-300/80">quest log</span>}
        {isCenterText && <span className="chip text-violet-300/80">center text</span>}
        {isOption && <span className="chip text-sky-300/80">option</span>}
        {line.options && line.options.length > 0 && (
          <span className="chip">+{line.options.length} choice{line.options.length > 1 ? "s" : ""}</span>
        )}
        <span className="ml-auto text-[10px] text-slate-500">
          {(() => {
            const m = (line.state_key ?? "").match(/^(.*)_(\d+)_(\d+)$/);
            const stateId = m ? m[2] : null;
            const subId = m ? m[3] : null;
            const local = line.state_item_id;
            return stateId && subId && local != null
              ? `#${line.id} · S${stateId}.${subId}.${local}`
              : `#${line.id}`;
          })()}
        </span>
      </div>

      <div className="space-y-1.5">
        {ORDER.map((l) => {
          const text = (line as any)[`text_${l}`] as string;
          const speaker = (line as any)[`speaker_${l}`] as string;
          const isPrimary = l === primary;
          if (!text && !speaker) return null;
          if (phone) {
            return (
              <div
                key={l}
                className={`flex items-baseline justify-end gap-2 ${
                  isPrimary ? "" : "opacity-60 hover:opacity-100 transition-opacity"
                }`}
              >
                <span className={`text-sm leading-relaxed text-right ${isPrimary ? "text-slate-100" : "text-slate-300"}`}>
                  {highlight(text || "", highlightQ ?? null)}
                </span>
                <span className={`shrink-0 text-[10px] ${isPrimary ? "text-accent-gold" : "text-slate-500"}`}>
                  {LANG_LABEL[l]}
                </span>
              </div>
            );
          }
          return (
            <div
              key={l}
              className={`grid grid-cols-[2.25rem_1fr] gap-2 ${
                isPrimary ? "" : "opacity-60 hover:opacity-100 transition-opacity"
              }`}
            >
              <span className={`text-[10px] pt-1 ${isPrimary ? "text-accent-gold" : "text-slate-500"}`}>
                {LANG_LABEL[l]}
              </span>
              <div className="min-w-0">
                {speaker && !isEmptySpeaker && (
                  <span className="text-[11px] text-slate-400 mr-1.5">{speaker}:</span>
                )}
                <span className={`text-sm leading-relaxed ${isPrimary ? "text-slate-100" : "text-slate-300"}`}>
                  {highlight(text || "", highlightQ ?? null)}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {line.options && line.options.length > 0 && (
        <ul className="mt-3 space-y-2 border-l-2 border-accent-teal/30 pl-3">
          {line.options.map((opt, i) => {
            const optText = (opt as any)[`text_${primary}`] || opt.text_en || "";
            const targetId = allLines ? resolveTargetId(opt, allLines) : null;
            const hasBranch = !!targetId;
            return (
              <li key={i} className="text-sm text-slate-300">
                <span className="text-accent-teal/70 mr-1">›</span>
                {optText}
                {hasBranch && (
                  <button
                    type="button"
                    onClick={() => scrollToLine(targetId!)}
                    className="ml-2 inline-flex items-center gap-1 rounded border border-accent-teal/30 bg-accent-teal/5 px-1.5 py-0.5 text-[10px] text-accent-teal/80 hover:bg-accent-teal/15 hover:text-accent-teal transition-colors"
                    title="Jump to the line this option leads to"
                  >
                    → leads to #{targetId}
                  </button>
                )}
                <div className="text-[10px] text-slate-500 mt-0.5">{opt.text_key}</div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
