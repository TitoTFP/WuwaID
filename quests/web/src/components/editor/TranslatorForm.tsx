import { useEffect, useMemo, useRef, useState } from "react";
import type { DialogueLine, DraftPatch } from "../../lib/types";
import ConfirmDialog from "./ConfirmDialog";
import DiffField from "./DiffField";
import { useUnsavedGuard } from "../../lib/useUnsavedGuard";
import { useLocalDraft } from "../../lib/useLocalDraft";
import { useToast } from "../Toast";
import { useHotkey } from "../../lib/keyboard";

const MAX_TEXT_LEN = 1000;

function basePatch(line: DialogueLine, draft: DialogueLine): DraftPatch {
  const patch: DraftPatch = {};
  if (draft.speaker_id !== line.speaker_id) patch.speaker_id = draft.speaker_id ?? "";
  if (draft.text_id !== line.text_id) patch.text_id = draft.text_id ?? "";
  if (JSON.stringify(draft.options ?? []) !== JSON.stringify(line.options ?? [])) {
    patch.options = draft.options ?? [];
  }
  return patch;
}

function hasPatch(patch: DraftPatch): boolean {
  return Object.keys(patch).length > 0;
}

export default function TranslatorForm({
  line,
  originalLine,
  qid,
  onSubmit,
  onPreview,
  busy,
  onSelectNext,
  allLines,
}: {
  line: DialogueLine;
  originalLine?: DialogueLine;
  qid: number;
  onSubmit: (patch: DraftPatch, note: string) => void;
  onPreview?: (line: DialogueLine) => void;
  busy: boolean;
  onSelectNext?: (direction: 1 | -1) => void;
  allLines?: DialogueLine[];
}) {
  const baseLine = originalLine ?? line;
  const [draft, setDraft] = useState<DialogueLine>(line);
  const [note, setNote] = useState("");
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [showRestore, setShowRestore] = useState(false);
  const localDraft = useLocalDraft<{ draft: DialogueLine; note: string }>(qid, line.id);
  const initialised = useRef(false);
  const toast = useToast();

  useEffect(() => {
    initialised.current = false;
    setNote("");
    setShowRestore(false);
    setConfirmDiscard(false);
  }, [line.id]);

  useEffect(() => {
    if (initialised.current) return;
    if (localDraft.restored) {
      setDraft(localDraft.restored.draft);
      setNote(localDraft.restored.note);
      setShowRestore(true);
    } else {
      setDraft(line);
      setNote("");
    }
    initialised.current = true;
  }, [line, localDraft.restored]);

  useEffect(() => {
    if (!initialised.current) return;
    if (!showRestore) return;
    localDraft.save({ draft, note });
  }, [draft, note, showRestore, localDraft]);

  const patch = basePatch(baseLine, draft);
  const canSave = hasPatch(patch) && !busy;
  const dirty = hasPatch(patch) || note.trim().length > 0;
  useUnsavedGuard(dirty);

  useHotkey("s", () => submit(0), { mod: true, allowInInputs: true });

  const speakerSuggestions = useMemo(() => {
    if (!line.speaker_en) return [];
    const suggestions = new Set<string>();
    // First suggestion is English speaker
    suggestions.add(line.speaker_en);
    // Scan allLines for existing translations of the same speaker
    if (allLines) {
      for (const l of allLines) {
        if (
          l.speaker_en === line.speaker_en &&
          l.speaker_id &&
          l.speaker_id.trim() &&
          l.speaker_id !== line.speaker_en
        ) {
          suggestions.add(l.speaker_id.trim());
        }
      }
    }
    return Array.from(suggestions);
  }, [line.speaker_en, allLines, line.speaker_id]);

  const fieldErrors = useMemo(() => {
    const errors: Record<string, string> = {};
    const t = draft.text_id ?? "";
    if (t.length > MAX_TEXT_LEN) {
      errors.text_id = "too long";
    }
    return errors;
  }, [draft]);

  function updateField<K extends keyof DialogueLine>(key: K, value: DialogueLine[K]) {
    setDraft((current) => {
      const next = { ...current, [key]: value };
      onPreview?.(next);
      return next;
    });
  }

  function resetField(key: keyof DialogueLine) {
    setDraft((current) => {
      const next = { ...current, [key]: baseLine[key] };
      onPreview?.(next);
      return next;
    });
  }

  const isOptionLine = line.type === "Option" || line.type === "SystemOption";
  const hasOptions = (draft.options?.length ?? 0) > 0;

  function updateOptionText(index: number, value: string) {
    setDraft((current) => {
      const opts = [...(current.options ?? [])];
      opts[index] = { ...opts[index], text_id: value };
      const next = { ...current, options: opts };
      onPreview?.(next);
      return next;
    });
  }

  function resetOptionText(index: number) {
    setDraft((current) => {
      const opts = [...(current.options ?? [])];
      const origOpt = baseLine.options?.[index];
      opts[index] = { ...opts[index], text_id: origOpt?.text_id ?? "" };
      const next = { ...current, options: opts };
      onPreview?.(next);
      return next;
    });
  }

  function discardAll() {
    setDraft(baseLine);
    setNote("");
    onPreview?.(baseLine);
    localDraft.clear();
    setShowRestore(false);
    setConfirmDiscard(false);
    toast.success("Discarded local edits");
  }

  function discardLocal() {
    setDraft(line);
    setNote("");
    onPreview?.(line);
    localDraft.clear();
    setShowRestore(false);
  }

  function submit(advance: 0 | 1 = 0) {
    if (!canSave) return;
    if (Object.keys(fieldErrors).length > 0) {
      toast.error("Fix validation errors before saving");
      return;
    }
    onSubmit(patch, note.trim());
    setNote("");
    localDraft.clear();
    setShowRestore(false);
    if (advance === 1) onSelectNext?.(1);
  }

  return (
    <form
      className="flex h-full flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit(0);
      }}
    >
      <div className="space-y-4 pb-32">
        {/* Line meta and viewer links */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/5 pb-2">
          <div>
            <div className="text-[10px] font-mono text-slate-500">LINE ID #{line.id} · TYPE: <span className="text-slate-400 font-semibold">{line.type}</span></div>
            <div className="font-serif text-sm text-accent-gold mt-0.5">{line.text_key || <em className="text-slate-500">no text_key</em>}</div>
          </div>
          <div className="text-xs text-slate-500">
            <a className="link" href={`/quests/${qid}#line-${line.id}`} target="_blank" rel="noreferrer">
              open in viewer ↗
            </a>
          </div>
        </div>

        {/* Restore draft indicator */}
        {showRestore && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-accent-gold/30 bg-accent-gold/5 p-2 text-xs text-slate-200">
            <span>Restored unsaved translation edits from your last session.</span>
            <div className="flex gap-2">
              <button type="button" className="btn text-[11px]" onClick={discardLocal}>
                Discard local
              </button>
            </div>
          </div>
        )}

        {/* English Source Card — hidden for option-only lines */}
        {!isOptionLine && (
          <div className="rounded-lg border border-white/10 bg-bg-2/50 p-4 shadow-sm ring-1 ring-white/5">
            <div className="text-[10px] font-mono uppercase tracking-widest text-slate-500 mb-2">English Source</div>
            {line.speaker_en && (
              <div className="font-semibold text-accent-gold text-sm mb-1">{line.speaker_en}</div>
            )}
            <div className="text-slate-100 text-sm whitespace-pre-wrap leading-relaxed">{line.text_en || <em className="text-slate-500">No English text</em>}</div>
          </div>
        )}

        {/* Chinese & Japanese References Accordion — hidden for option-only lines */}
        {!isOptionLine && (
          <details className="group rounded-md border border-white/5 bg-bg-1/20 overflow-hidden">
            <summary className="flex cursor-pointer select-none items-center justify-between px-3 py-2 text-xs text-slate-400 hover:bg-bg-1/40 hover:text-slate-200">
              <span>Chinese & Japanese References</span>
              <span className="text-[10px] text-slate-500 transition-transform group-open:rotate-180">▼</span>
            </summary>
            <div className="border-t border-white/5 p-3 grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div className="space-y-1.5">
                <div className="text-slate-500 font-medium font-mono text-[10px] uppercase">Chinese (Simplified)</div>
                {line["speaker_zh-Hans"] && (
                  <div className="font-semibold text-accent-teal">{line["speaker_zh-Hans"]}</div>
                )}
                <div className="text-slate-300 whitespace-pre-wrap leading-relaxed">{line["text_zh-Hans"] || <em className="text-slate-600">No Chinese text</em>}</div>
              </div>
              <div className="space-y-1.5">
                <div className="text-slate-500 font-medium font-mono text-[10px] uppercase">Japanese</div>
                {line.speaker_ja && (
                  <div className="font-semibold text-accent-violet">{line.speaker_ja}</div>
                )}
                <div className="text-slate-300 whitespace-pre-wrap leading-relaxed">{line.text_ja || <em className="text-slate-600">No Japanese text</em>}</div>
              </div>
            </div>
          </details>
        )}

        {/* Translation workspace */}
        <div className="space-y-4 border-t border-white/5 pt-4">
          <div className="text-[10px] font-mono uppercase tracking-widest text-accent-gold">Indonesian Translation</div>

          {/* Speaker ID & Text ID Inputs — hidden for option-only lines */}
          {!isOptionLine && (
            <>
              {/* Speaker ID Input */}
              <div className="space-y-1.5">
                <DiffField
                  label="Speaker Name (speaker_id)"
                  value={draft.speaker_id ?? ""}
                  original={baseLine.speaker_id ?? ""}
                  onChange={(value) => updateField("speaker_id", value)}
                  onReset={() => resetField("speaker_id")}
                />
                {speakerSuggestions.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 mt-1 text-[10px]">
                    <span className="text-slate-500 select-none">Suggestions:</span>
                    {speakerSuggestions.map((name) => (
                      <button
                        key={name}
                        type="button"
                        className="rounded bg-bg-2 hover:bg-white/5 border border-white/10 hover:border-white/20 px-1.5 py-0.5 text-slate-300 transition"
                        onClick={() => updateField("speaker_id", name)}
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Text ID Input */}
              <div className="space-y-1.5 relative">
                <div className="absolute right-0 top-0 z-10 flex gap-2">
                  <button
                    type="button"
                    className="text-[10px] text-accent-teal/80 hover:text-accent-teal transition hover:underline"
                    onClick={() => updateField("text_id", line.text_en ?? "")}
                  >
                    Copy English
                  </button>
                </div>
                <DiffField
                  label="Dialogue Text (text_id)"
                  value={draft.text_id ?? ""}
                  original={baseLine.text_id ?? ""}
                  onChange={(value) => updateField("text_id", value)}
                  onReset={() => resetField("text_id")}
                  multiline
                  maxLength={MAX_TEXT_LEN}
                />
                {fieldErrors.text_id === "too long" && (
                  <div className="text-[11px] text-rose-300">over {MAX_TEXT_LEN} characters</div>
                )}
              </div>
            </>
          )}

          {/* Options Translation Section */}
          {hasOptions && (
            <div className="space-y-3 border-t border-white/5 pt-3">
              <div className="text-[10px] font-mono uppercase tracking-widest text-accent-teal">Option Translations</div>
              {(draft.options ?? []).map((opt, idx) => {
                const origOpt = baseLine.options?.[idx];
                return (
                  <div key={idx} className="space-y-2 rounded-lg border border-white/10 bg-bg-2/30 p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-400">Option {idx + 1}</span>
                      <span className="text-[10px] font-mono text-slate-600 truncate max-w-[200px]">{opt.text_key}</span>
                    </div>

                    {/* Source references grid */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-xs">
                      <div className="rounded-md bg-bg-1/30 border border-white/5 p-2 space-y-0.5">
                        <div className="text-[10px] font-mono text-slate-500 uppercase">English</div>
                        <div className="text-slate-200 whitespace-pre-wrap leading-relaxed">{opt.text_en || <em className="text-slate-600">—</em>}</div>
                      </div>
                      <div className="rounded-md bg-bg-1/30 border border-white/5 p-2 space-y-0.5">
                        <div className="text-[10px] font-mono text-slate-500 uppercase">Chinese</div>
                        <div className="text-slate-300 whitespace-pre-wrap leading-relaxed">{opt["text_zh-Hans"] || <em className="text-slate-600">—</em>}</div>
                      </div>
                      <div className="rounded-md bg-bg-1/30 border border-white/5 p-2 space-y-0.5">
                        <div className="text-[10px] font-mono text-slate-500 uppercase">Japanese</div>
                        <div className="text-slate-300 whitespace-pre-wrap leading-relaxed">{opt.text_ja || <em className="text-slate-600">—</em>}</div>
                      </div>
                    </div>

                    {/* Indonesian translation input */}
                    <div className="space-y-1 relative">
                      <div className="absolute right-0 top-0 z-10">
                        <button
                          type="button"
                          className="text-[10px] text-accent-teal/80 hover:text-accent-teal transition hover:underline"
                          onClick={() => updateOptionText(idx, opt.text_en ?? "")}
                        >
                          Copy English
                        </button>
                      </div>
                      <DiffField
                        label={`Option ${idx + 1} — Indonesian (text_id)`}
                        value={opt.text_id ?? ""}
                        original={origOpt?.text_id ?? ""}
                        onChange={(value) => updateOptionText(idx, value)}
                        onReset={() => resetOptionText(idx)}
                        multiline
                        maxLength={MAX_TEXT_LEN}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Review Note */}
          <div className="space-y-1.5 border-t border-white/5 pt-3">
            <label className="text-xs font-medium text-slate-300" htmlFor="draft-note">
              Translator/Review Note (optional)
            </label>
            <textarea
              id="draft-note"
              className="input min-h-16 resize-y text-xs"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Provide comments, translation rationales, or questions for reviewers here..."
            />
          </div>
        </div>
      </div>

      {/* Sticky footer for saving actions */}
      <div className="sticky bottom-0 -mx-4 mt-auto border-t border-white/10 bg-bg-1/90 px-4 py-3 backdrop-blur-md">
        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" className="btn btn-active" disabled={!canSave} title="Ctrl+S">
            {busy ? "Saving…" : "Save as draft"}
          </button>
          <button
            type="button"
            className="btn border-accent-gold/45 text-accent-gold hover:bg-accent-gold/5"
            disabled={!canSave}
            onClick={() => submit(1)}
            title="Save draft then jump to next line"
          >
            Save & next
          </button>
          <span className="mx-1 h-4 w-px bg-white/10" aria-hidden="true" />
          <button
            type="button"
            className="btn"
            onClick={() => onSelectNext?.(-1)}
            title="Previous line"
            aria-label="Previous line"
          >
            ←
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => onSelectNext?.(1)}
            title="Next line"
            aria-label="Next line"
          >
            →
          </button>
          <button
            type="button"
            className="btn"
            disabled={!dirty || busy}
            onClick={() => setConfirmDiscard(true)}
          >
            Discard
          </button>
          {hasPatch(patch) && (
            <span className="text-xs text-slate-500">
              Unsaved translation changes
            </span>
          )}
          {Object.keys(fieldErrors).length > 0 && (
            <span className="ml-auto text-xs text-rose-300">
              {Object.keys(fieldErrors).length} validation issue(s)
            </span>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmDiscard}
        title="Discard all edits?"
        message="This resets the Indonesian fields back to their original state. Saved drafts will not be modified."
        confirmLabel="Discard"
        destructive
        onCancel={() => setConfirmDiscard(false)}
        onConfirm={discardAll}
      />
    </form>
  );
}
