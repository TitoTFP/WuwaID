import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { DialogueLine, Lang } from "../lib/types";
import SpeakerBadge from "./SpeakerBadge";

const LANG_LABEL: Record<Lang, string> = {
  en: "EN",
  "zh-Hans": "中",
  ja: "JA",
};

const ORDER: Lang[] = ["en", "zh-Hans", "ja"];

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

export default function DialogueLine({ line, primary, highlightQ }: {
  line: DialogueLine;
  primary: Lang;
  highlightQ?: string | null;
}) {
  const isEmptySpeaker = !line.speaker_en && !line.speaker_zh_Hans && !line.speaker_ja;
  const isCenterText = line.type === "CenterText";
  const isOption = line.type === "Option";
  const isMarker = isCenterText || isEmptySpeaker;

  return (
    <div
      id={`L${line.id}`}
      data-line-id={line.id}
      className={`dialogue-line ${isMarker ? "is-marker" : ""}`}
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <SpeakerBadge name={line.speaker_en} />
        {isEmptySpeaker && <span className="chip text-amber-300/80">quest log</span>}
        {isCenterText && <span className="chip text-violet-300/80">center text</span>}
        {isOption && <span className="chip text-sky-300/80">option</span>}
        {line.options && line.options.length > 0 && (
          <span className="chip">+{line.options.length} choice{line.options.length > 1 ? "s" : ""}</span>
        )}
        <span className="ml-auto text-[10px] text-slate-500">#{line.id}</span>
      </div>

      <div className="space-y-1.5">
        {ORDER.map((l) => {
          const text = (line as any)[`text_${l.replace("-", "_")}`] as string;
          const speaker = (line as any)[`speaker_${l.replace("-", "_")}`] as string;
          const isPrimary = l === primary;
          if (!text && !speaker) return null;
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
        <ul className="mt-3 space-y-1 border-l-2 border-accent-teal/30 pl-3">
          {line.options.map((opt, i) => {
            const optText = (opt as any)[`text_${primary.replace("-", "_")}`] || opt.text_en || "";
            return (
              <li key={i} className="text-sm text-slate-300">
                <span className="text-accent-teal/70 mr-1">›</span>
                {optText}
                <div className="text-[10px] text-slate-500 mt-0.5">{opt.text_key}</div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
