import { useMemo, useState } from "react";
import { diffWords } from "../../lib/diff";

export default function DiffField({
  label,
  value,
  original,
  onChange,
  onReset,
  multiline,
  maxLength,
}: {
  label: string;
  value: string;
  original?: string;
  onChange: (value: string) => void;
  onReset?: () => void;
  multiline?: boolean;
  maxLength?: number;
}) {
  const hasOriginal = original !== undefined && original !== "";
  const changed = value !== (original ?? "");
  const pill = changed ? "edited" : hasOriginal ? "unchanged" : null;
  const tooLong = typeof maxLength === "number" && value.length > maxLength;
  const [showDiff, setShowDiff] = useState(false);

  const spans = useMemo(() => {
    if (!hasOriginal || !changed) return null;
    return diffWords(original ?? "", value);
  }, [hasOriginal, changed, original, value]);

  async function copyOriginal() {
    if (!original) return;
    try {
      await navigator.clipboard.writeText(original);
    } catch {
      // ignore
    }
  }

  return (
    <label className="block space-y-1.5">
      <div className="flex items-center gap-2 text-xs font-medium text-slate-300">
        <span>{label}</span>
        {pill && (
          <span
            className={[
              "rounded px-1.5 py-0.5 text-[10px]",
              changed
                ? "bg-accent-gold/20 text-accent-gold"
                : "bg-white/5 text-slate-500",
            ].join(" ")}
          >
            {pill}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1.5 text-[10px]">
          {hasOriginal && (
            <button
              type="button"
              className="text-slate-500 transition hover:text-slate-200"
              onClick={() => setShowDiff((v) => !v)}
              title="Toggle inline diff"
            >
              {showDiff ? "hide diff" : "diff"}
            </button>
          )}
          {hasOriginal && (
            <button
              type="button"
              className="text-slate-500 transition hover:text-slate-200"
              onClick={copyOriginal}
              title="Copy original to clipboard"
            >
              copy orig
            </button>
          )}
          {hasOriginal && onReset && (
            <button
              type="button"
              className={[
                "rounded px-1.5 py-0.5 transition",
                changed
                  ? "text-rose-300 hover:bg-rose-500/10 hover:text-rose-200"
                  : "cursor-not-allowed text-slate-700",
              ].join(" ")}
              onClick={onReset}
              disabled={!changed}
              title="Reset this field to original"
            >
              reset
            </button>
          )}
        </div>
      </div>
      {multiline ? (
        <textarea
          className={[
            "input min-h-28 resize-y font-sans",
            tooLong ? "border-rose-400/40 focus:border-rose-300/60 focus:ring-rose-300/30" : "",
          ].join(" ")}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          className="input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {multiline && (
        <div className="flex items-center justify-between text-[10px]">
          <span className={tooLong ? "text-rose-300" : "text-slate-600"}>
            {value.length} chars{maxLength ? ` / ${maxLength}` : ""}
          </span>
        </div>
      )}
      {showDiff && spans && (
        <div className="rounded border border-white/10 bg-bg-1/60 p-2 text-[12px] leading-relaxed">
          {spans.map((span, idx) =>
            span.op === "equal" ? (
              <span key={idx} className="diff-equal">
                {span.value}
              </span>
            ) : span.op === "removed" ? (
              <span key={idx} className="diff-removed">
                {span.value}
              </span>
            ) : (
              <span key={idx} className="diff-added">
                {span.value}
              </span>
            ),
          )}
        </div>
      )}
      {hasOriginal && !showDiff && (
        <details className="text-[11px] text-slate-500">
          <summary className="cursor-pointer select-none text-slate-500 hover:text-slate-300">
            orig ({original!.length} chars)
          </summary>
          <div className="mt-1 whitespace-pre-wrap break-words rounded border border-white/5 bg-bg-1/40 p-2 text-slate-400">
            {original}
          </div>
        </details>
      )}
    </label>
  );
}
