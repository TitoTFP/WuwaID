import { useId, useMemo, useState } from "react";
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
  const [copied, setCopied] = useState(false);
  const fieldId = useId();
  const helperId = useId();

  const spans = useMemo(() => {
    if (!hasOriginal || !changed) return null;
    return diffWords(original ?? "", value);
  }, [hasOriginal, changed, original, value]);

  async function copyOriginal() {
    if (!original) return;
    try {
      await navigator.clipboard.writeText(original);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      // ignore
    }
  }

  return (
    <div className="block space-y-2">
      <div className="flex flex-col gap-1 text-xs font-medium text-slate-300 sm:flex-row sm:items-center sm:gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <label htmlFor={fieldId}>{label}</label>
          {pill && (
            <span
              className={[
            "border px-2 py-1 text-[10px]",
                changed
                  ? "border-accent-gold/30 bg-accent-gold/10 text-accent-gold"
                  : "border-white/10 bg-white/5 text-slate-500",
              ].join(" ")}
            >
              {pill}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1 text-[10px] sm:ml-auto">
          {hasOriginal && (
            <button
              type="button"
              className="min-h-11 whitespace-nowrap px-2 text-slate-500 transition-colors hover:text-slate-200"
              onClick={() => setShowDiff((v) => !v)}
              title="Toggle inline diff"
            >
              {showDiff ? "hide diff" : "diff"}
            </button>
          )}
          {hasOriginal && (
            <button
              type="button"
              className="min-h-11 whitespace-nowrap px-2 text-slate-500 transition-colors hover:text-slate-200"
              onClick={copyOriginal}
              title="Copy original to clipboard"
              aria-live="polite"
            >
              {copied ? "copied" : "copy orig"}
            </button>
          )}
          {hasOriginal && onReset && (
            <button
              type="button"
              className={[
                "min-h-11 whitespace-nowrap px-2 transition-colors disabled:opacity-50",
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
          id={fieldId}
          aria-invalid={tooLong || undefined}
          aria-describedby={helperId}
          className={[
            "input min-h-28 resize-y font-sans",
            tooLong ? "border-rose-400/40 focus:border-rose-300/60 focus:ring-rose-300/30" : "",
          ].join(" ")}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          id={fieldId}
          aria-describedby={helperId}
          className="input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      <div id={helperId} aria-live="polite" className="flex min-h-[1lh] items-center justify-between text-[10px]">
        {multiline ? (
          <span className={tooLong ? "text-rose-300" : "text-slate-600"}>
            {value.length} chars{maxLength ? ` / ${maxLength}` : ""}
            {tooLong && maxLength ? ` — ${value.length - maxLength} over limit` : ""}
          </span>
        ) : (
          <span aria-hidden="true">&nbsp;</span>
        )}
      </div>
      {showDiff && spans && (
        <div className="border border-white/10 bg-bg-1/60 p-2 text-[12px] leading-relaxed">
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
          <summary className="flex min-h-11 cursor-pointer select-none items-center text-slate-500 hover:text-slate-300">
            orig ({original!.length} chars)
          </summary>
          <div className="mt-1 whitespace-pre-wrap break-words border border-white/5 bg-bg-1/40 p-2 text-slate-400">
            {original}
          </div>
        </details>
      )}
    </div>
  );
}
