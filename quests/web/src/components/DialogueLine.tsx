import { memo, useMemo } from "react";
import type { DialogueLine, Lang, PlotMode } from "../lib/types";

export type LineIndex = {
  byKey: Map<string, number>;
  byId: Map<number, DialogueLine>;
};

const LANG_LABEL: Record<Lang, string> = {
  en: "EN",
  "zh-Hans": "中",
  ja: "JA",
  id: "ID",
};

const ORDER: Lang[] = ["en", "zh-Hans", "ja", "id"];

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
      <mark className="bg-transparent text-accent-signal underline decoration-1 decoration-accent-signal underline-offset-2">
        {text.slice(i, i + lq.length)}
      </mark>
      {text.slice(i + lq.length)}
    </>
  );
}

// Resolve an option's branch target to a line id within the same quest.
// We do this by matching the option's plot_line_key against any line's
// plot_line_key OR text_key (TidTalk == PlotLineKey in this game's data).
// All lookups are O(1) via Map — caller passes a precomputed `lineIndex`.
function resolveTargetId(
  opt: { plot_line_key?: string; actions?: { name: string; params: { TalkId?: number } }[] },
  lineIndex: LineIndex | undefined,
): number | null {
  if (!lineIndex) return null;
  if (opt.plot_line_key) {
    const id = lineIndex.byKey.get(opt.plot_line_key);
    if (id !== undefined) return id;
  }
  for (const a of opt.actions ?? []) {
    if (a.name === "JumpTalk" && typeof a.params?.TalkId === "number") {
      const line = lineIndex.byId.get(a.params.TalkId);
      if (line) return line.id;
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

export default memo(function DialogueLine({
  line,
  primary,
  highlightQ,
  plotMode,
  lineIndex,
}: {
  line: DialogueLine;
  primary: Lang;
  highlightQ?: string | null;
  plotMode?: PlotMode;
  lineIndex?: LineIndex;
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

  const parsedState = useMemo(() => {
    const m = (line.state_key ?? "").match(/^(.*)_(\d+)_(\d+)$/);
    return m ? { stateId: m[2], subId: m[3] } : null;
  }, [line.state_key]);

  return (
    <div
      id={`L${line.id}`}
      data-line-id={line.id}
      data-plot-mode={plotMode ?? ""}
      className={[
        "dialogue-line min-w-0",
        isMarker ? "is-marker" : "",
        phone ? "is-phone" : "",
        cinematic ? "is-cinematic" : "",
      ].filter(Boolean).join(" ")}
    >
      <div className="mb-3 flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 border-b border-white/5 pb-2">
        <span className="min-w-0 truncate text-sm font-medium text-slate-200">
          {line.speaker_en || "Narration"}
        </span>
        {phone && <span className="font-mono text-[10px] text-slate-500">{PLOT_MODE_LABEL.PhoneMessage}</span>}
        {cinematic && plotMode && PLOT_MODE_LABEL[plotMode] && (
          <span className="font-mono text-[10px] text-slate-500">{PLOT_MODE_LABEL[plotMode]}</span>
        )}
        {isEmptySpeaker && <span className="font-mono text-[10px] text-slate-500">quest log</span>}
        {isCenterText && <span className="font-mono text-[10px] text-slate-500">center text</span>}
        {isOption && <span className="font-mono text-[10px] text-slate-500">option</span>}
        {line.options && line.options.length > 0 && (
          <span className="font-mono text-[10px] text-slate-500">
            {line.options.length} choice{line.options.length > 1 ? "s" : ""}
          </span>
        )}
        <span className="ml-auto shrink-0 font-mono text-[10px] text-slate-500 tabular-nums">
          {parsedState && line.state_item_id != null
            ? `#${line.id} · S${parsedState.stateId}.${parsedState.subId}.${line.state_item_id}`
            : `#${line.id}`}
        </span>
      </div>

      <div className="space-y-2">
        {ORDER.map((l) => {
          const text = (line as any)[`text_${l}`] as string;
          const speaker = (line as any)[`speaker_${l}`] as string;
          const isPrimary = l === primary;
          if (!text && !speaker) return null;
          if (phone) {
            return (
              <div
                key={l}
                className={`flex min-w-0 items-baseline justify-end gap-2 ${
                  isPrimary ? "" : "opacity-60 transition-opacity hover:opacity-100"
                }`}
              >
                <span className={`min-w-0 [overflow-wrap:anywhere] text-right text-base leading-relaxed ${isPrimary ? "text-slate-100" : "text-slate-300"}`}>
                  {highlight(text || "", highlightQ ?? null)}
                </span>
                <span className={`shrink-0 font-mono text-[10px] ${isPrimary ? "text-accent-signal" : "text-slate-500"}`}>
                  {LANG_LABEL[l]}
                </span>
              </div>
            );
          }
          return (
            <div
              key={l}
              className={`grid min-w-0 grid-cols-[2rem_minmax(0,1fr)] gap-2 ${
                isPrimary ? "" : "opacity-60 transition-opacity hover:opacity-100"
              }`}
            >
              <span className={`pt-1 font-mono text-[10px] ${isPrimary ? "text-accent-signal" : "text-slate-500"}`}>
                {LANG_LABEL[l]}
              </span>
              <div className="min-w-0">
                {speaker && !isEmptySpeaker && (
                  <span className="mr-2 text-[11px] text-slate-400">{speaker}:</span>
                )}
                <span className={`[overflow-wrap:anywhere] text-base leading-relaxed ${isPrimary ? "text-slate-100" : "text-slate-300"}`}>
                  {highlight(text || "", highlightQ ?? null)}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {line.options && line.options.length > 0 && (
        <section className="mt-4 border-t border-white/10 pt-3">
          <h3 className="font-mono text-[10px] text-accent-signal">Player choices</h3>
          <ul className="mt-1 divide-y divide-white/5">
          {line.options.map((opt, i) => {
            const optText = (opt as any)[`text_${primary}`] || opt.text_en || "";
            const targetId = resolveTargetId(opt, lineIndex);
            const hasBranch = !!targetId;
            return (
              <li key={i} className="min-w-0 py-2 text-base text-slate-300">
                <div className="flex min-w-0 gap-2">
                  <span className="shrink-0 text-accent-signal" aria-hidden="true">→</span>
                  <span className="min-w-0 [overflow-wrap:anywhere]">{optText}</span>
                </div>
                <div className="ml-5 mt-1 flex min-w-0 flex-wrap items-center gap-x-3">
                  <span className="min-w-0 [overflow-wrap:anywhere] font-mono text-[10px] text-slate-500">{opt.text_key}</span>
                  {hasBranch && (
                    <button
                      type="button"
                      onClick={() => scrollToLine(targetId!)}
                      className="link inline-flex min-h-11 items-center whitespace-nowrap font-mono text-[10px]"
                      title="Jump to the line this option leads to"
                    >
                      Leads to #{targetId}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
          </ul>
        </section>
      )}
    </div>
  );
});
