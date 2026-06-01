import type { DialogueLineOption, Lang } from "../../lib/types";
import DiffField from "./DiffField";

type TextKey = "text_en" | "text_zh-Hans" | "text_ja";

const LANGS: Lang[] = ["en", "zh-Hans", "ja"];

function textKey(lang: Lang): TextKey {
  return lang === "zh-Hans" ? "text_zh-Hans" : `text_${lang}`;
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

export default function OptionsSubform({
  options,
  originals,
  onChange,
}: {
  options: DialogueLineOption[];
  originals?: DialogueLineOption[];
  onChange: (options: DialogueLineOption[]) => void;
}) {
  function updateOption(index: number, next: DialogueLineOption) {
    onChange(options.map((option, i) => (i === index ? next : option)));
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
                    onClick={() => onChange(options.filter((_, i) => i !== index))}
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
                      value={option[key]}
                      original={original?.[key]}
                      onChange={(value) => updateOption(index, { ...option, [key]: value })}
                      multiline
                    />
                  );
                })}

                <label className="block space-y-1.5">
                  <span className="text-xs font-medium text-slate-300">plot_line_key target</span>
                  <input
                    className="input"
                    value={option.plot_line_key ?? ""}
                    onChange={(e) =>
                      updateOption(index, { ...option, plot_line_key: e.target.value })
                    }
                  />
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
