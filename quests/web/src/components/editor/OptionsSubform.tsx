import { useEffect, useMemo, useRef, useState } from "react";
import type { DialogueLine, DialogueLineOption, Lang } from "../../lib/types";
import DiffField from "./DiffField";
import { useToast } from "../Toast";

type TextKey = "text_en" | "text_zh-Hans" | "text_ja" | "text_id";

const LANGS: Lang[] = ["en", "zh-Hans", "ja", "id"];

function textKey(lang: Lang): TextKey {
  if (lang === "zh-Hans") return "text_zh-Hans";
  if (lang === "id") return "text_id";
  return `text_${lang}`;
}

function blankOption(): DialogueLineOption {
  return {
    text_key: "",
    text_en: "",
    "text_zh-Hans": "",
    text_ja: "",
    plot_line_key: "",
  };
}

type ComboEntry = {
  id: number;
  label: string;
  snippet: string;
  stateKey: string;
};

function entriesFor(lines: DialogueLine[] | undefined, query: string, excludeId?: number): ComboEntry[] {
  if (!lines) return [];
  const q = query.trim().toLowerCase();
  return lines
    .filter((l) => l.id !== excludeId)
    .map((l) => {
      const snippet = (l.text_en || l["text_zh-Hans"] || l.text_ja || "").slice(0, 60);
      const haystack = [
        String(l.id),
        l.text_key,
        l.state_key,
        l.speaker_en,
        l.speaker_ja,
        l["speaker_zh-Hans"],
        snippet,
      ]
        .join(" ")
        .toLowerCase();
      return { id: l.id, label: `#${l.id} · ${l.type}`, snippet, stateKey: l.state_key, haystack };
    })
    .filter((entry) => !q || entry.haystack.includes(q))
    .slice(0, 20)
    .map(({ haystack: _haystack, ...rest }) => rest);
}

function LineCombobox({
  value,
  onChange,
  lines,
  excludeId,
  placeholder = "search by id, text, or speaker…",
}: {
  value: string;
  onChange: (next: string) => void;
  lines: DialogueLine[];
  excludeId?: number;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const entries = useMemo(() => entriesFor(lines, value, excludeId), [lines, value, excludeId]);
  const numericId = Number(value);
  const isId = Number.isFinite(numericId) && String(numericId) === value.trim();

  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, []);

  useEffect(() => {
    setHighlight(0);
  }, [value]);

  function commit(entry: ComboEntry) {
    onChange(String(entry.id));
    setOpen(false);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!open) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlight((h) => Math.min(entries.length - 1, h + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight((h) => Math.max(0, h - 1));
    } else if (event.key === "Enter" && entries[highlight]) {
      event.preventDefault();
      commit(entries[highlight]);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <input
        className="input"
        value={value}
        placeholder={placeholder}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
      />
      {isId && (
        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-accent-teal">
          id
        </span>
      )}
      {open && entries.length > 0 && (
        <ul
          className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-md border border-white/10 bg-bg-2 shadow-xl"
          role="listbox"
        >
          {entries.map((entry, idx) => (
            <li
              key={entry.id}
              role="option"
              aria-selected={idx === highlight}
              onMouseEnter={() => setHighlight(idx)}
              onMouseDown={(e) => {
                e.preventDefault();
                commit(entry);
              }}
              className={[
                "cursor-pointer px-2 py-1.5 text-xs",
                idx === highlight ? "bg-accent-gold/10 text-accent-gold" : "text-slate-200 hover:bg-white/5",
              ].join(" ")}
            >
              <div className="flex items-center gap-2 font-mono">
                <span className="text-slate-500">#{entry.id}</span>
                <span className="truncate">{entry.label.replace(`#${entry.id} · `, "")}</span>
                <span className="ml-auto truncate text-[10px] text-slate-500">{entry.stateKey}</span>
              </div>
              {entry.snippet && (
                <div className="truncate pl-1 text-[10px] text-slate-500">{entry.snippet}</div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function OptionsSubform({
  options,
  originals,
  onChange,
  allLines,
  currentLineId,
}: {
  options: DialogueLineOption[];
  originals?: DialogueLineOption[];
  onChange: (options: DialogueLineOption[]) => void;
  allLines?: DialogueLine[];
  currentLineId?: number;
}) {
  const toast = useToast();

  function updateOption(index: number, next: DialogueLineOption) {
    onChange(options.map((option, i) => (i === index ? next : option)));
  }

  function removeOption(index: number) {
    const previous = [...options];
    onChange(options.filter((_, i) => i !== index));
    toast.undo(`Removed option ${index + 1}`, () => {
      onChange(previous);
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium text-slate-200">Options</h3>
          <p className="text-xs text-slate-500">Player choice text and jump target.</p>
        </div>
        <button
          type="button"
          className="btn"
          onClick={() => onChange([...options, blankOption()])}
        >
          Add option
        </button>
      </div>

      {options.length === 0 ? (
        <div className="rounded-md border border-dashed border-white/10 p-3 text-xs text-slate-500">
          No options on this line.
        </div>
      ) : (
        <div className="space-y-3">
          {options.map((option, index) => {
            const original = originals?.[index];
            return (
              <div key={index} className="space-y-3 rounded-md border border-white/10 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs font-semibold text-slate-400">
                    Option {index + 1}
                  </div>
                  <button
                    type="button"
                    className="text-xs text-rose-300 hover:text-rose-200"
                    onClick={() => removeOption(index)}
                  >
                    remove
                  </button>
                </div>

                {LANGS.map((lang) => {
                  const key = textKey(lang);
                  return (
                    <DiffField
                      key={lang}
                      label={`option text_${lang}`}
                      value={option[key] ?? ""}
                      original={original?.[key]}
                      onChange={(value) => updateOption(index, { ...option, [key]: value })}
                      onReset={() => updateOption(index, { ...option, [key]: original?.[key] ?? "" })}
                      multiline
                    />
                  );
                })}

                <label className="block space-y-1.5">
                  <span className="text-xs font-medium text-slate-300">plot_line_key target</span>
                  <input
                    className="input font-mono"
                    value={option.plot_line_key ?? ""}
                    onChange={(e) =>
                      updateOption(index, { ...option, plot_line_key: e.target.value })
                    }
                    placeholder="text_key or id"
                  />
                  {allLines && (
                    <LineCombobox
                      value={option.plot_line_key ?? ""}
                      onChange={(v) => updateOption(index, { ...option, plot_line_key: v })}
                      lines={allLines}
                      excludeId={currentLineId}
                      placeholder="search target line by id, text, speaker…"
                    />
                  )}
                  {original?.plot_line_key && (
                    <div className="text-[11px] text-slate-500">
                      orig: {original.plot_line_key}
                    </div>
                  )}
                </label>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
