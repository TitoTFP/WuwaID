import { useEffect, useRef, useState } from "react";
import type { CategoryEditorEntry } from "../../lib/types";
import ConfirmDialog from "./ConfirmDialog";
import DiffField from "./DiffField";
import { useUnsavedGuard } from "../../lib/useUnsavedGuard";
import { useCategoryLocalDraft } from "../../lib/useLocalDraft";
import { useToast } from "../Toast";
import { useHotkey } from "../../lib/keyboard";

const MAX_TEXT_LEN = 1000;

export default function CategoryTranslatorForm({
  entry,
  originalEntry,
  category,
  onSubmit,
  onPreview,
  busy,
  onSelectNext,
}: {
  entry: CategoryEditorEntry;
  originalEntry?: CategoryEditorEntry;
  category: string;
  onSubmit: (patch: { text_id: string }, note: string) => void;
  onPreview?: (entry: CategoryEditorEntry) => void;
  busy: boolean;
  onSelectNext?: (direction: 1 | -1) => void;
}) {
  const baseEntry = originalEntry ?? entry;
  const [translation, setTranslation] = useState(entry.id ?? "");
  const [note, setNote] = useState("");
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [showRestore, setShowRestore] = useState(false);
  
  const localDraft = useCategoryLocalDraft<{ text: string; note: string }>(category, entry.key);
  const initialised = useRef(false);
  const toast = useToast();

  useEffect(() => {
    initialised.current = false;
    setNote("");
    setShowRestore(false);
    setConfirmDiscard(false);
  }, [entry.key]);

  useEffect(() => {
    if (initialised.current) return;
    if (localDraft.restored) {
      setTranslation(localDraft.restored.text);
      setNote(localDraft.restored.note);
      setShowRestore(true);
    } else {
      setTranslation(entry.id ?? "");
      setNote("");
    }
    initialised.current = true;
  }, [entry, localDraft.restored]);

  useEffect(() => {
    if (!initialised.current) return;
    if (!showRestore) return;
    localDraft.save({ text: translation, note });
  }, [translation, note, showRestore, localDraft]);

  const changed = translation !== (baseEntry.id ?? "");
  const canSave = changed && !busy;
  const dirty = changed || note.trim().length > 0;
  useUnsavedGuard(dirty);

  useHotkey("s", () => submit(0), { mod: true, allowInInputs: true });

  const tooLong = translation.length > MAX_TEXT_LEN;

  function handleTranslationChange(value: string) {
    setTranslation(value);
    onPreview?.({
      ...entry,
      id: value || null,
    });
  }

  function handleReset() {
    setTranslation(baseEntry.id ?? "");
    onPreview?.(baseEntry);
  }

  function discardAll() {
    setTranslation(baseEntry.id ?? "");
    setNote("");
    onPreview?.(baseEntry);
    localDraft.clear();
    setShowRestore(false);
    setConfirmDiscard(false);
    toast.success("Discarded local edits");
  }

  function discardLocal() {
    setTranslation(entry.id ?? "");
    setNote("");
    onPreview?.(entry);
    localDraft.clear();
    setShowRestore(false);
  }

  function submit(advance: 0 | 1 = 0) {
    if (!canSave) return;
    if (tooLong) {
      toast.error("Fix validation errors before saving");
      return;
    }
    onSubmit({ text_id: translation }, note.trim());
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
        {/* Entry metadata and details */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/5 pb-2">
          <div>
            <div className="text-[10px] font-mono text-slate-500">
              CATEGORY: <span className="text-slate-400 font-semibold">{category}</span>
            </div>
            <div className="font-serif text-sm text-accent-gold mt-0.5">
              {entry.key}
            </div>
          </div>
          <div className="text-xs text-slate-500">
            <span className="font-mono text-[10px] rounded px-1.5 py-0.5 bg-white/5">
              {entry.prefix}
            </span>
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

        {/* English Source Card */}
        <div className="rounded-lg border border-white/10 bg-bg-2/50 p-4 shadow-sm ring-1 ring-white/5">
          <div className="text-[10px] font-mono uppercase tracking-widest text-slate-500 mb-2">
            English Source
          </div>
          <div className="text-slate-100 text-sm whitespace-pre-wrap leading-relaxed">
            {entry.en || <em className="text-slate-500">No English text</em>}
          </div>
        </div>

        {/* Chinese & Japanese References Accordion */}
        <details className="group rounded-md border border-white/5 bg-bg-1/20 overflow-hidden" open>
          <summary className="flex cursor-pointer select-none items-center justify-between px-3 py-2 text-xs text-slate-400 hover:bg-bg-1/40 hover:text-slate-200">
            <span>Chinese & Japanese References</span>
            <span className="text-[10px] text-slate-500 transition-transform group-open:rotate-180">▼</span>
          </summary>
          <div className="border-t border-white/5 p-3 grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div className="space-y-1.5">
              <div className="text-slate-500 font-medium font-mono text-[10px] uppercase">
                Chinese (Simplified)
              </div>
              <div className="text-slate-300 whitespace-pre-wrap leading-relaxed">
                {entry["zh-Hans"] || <em className="text-slate-600">No Chinese text</em>}
              </div>
            </div>
            <div className="space-y-1.5">
              <div className="text-slate-500 font-medium font-mono text-[10px] uppercase">
                Japanese
              </div>
              <div className="text-slate-300 whitespace-pre-wrap leading-relaxed">
                {entry.ja || <em className="text-slate-600">No Japanese text</em>}
              </div>
            </div>
          </div>
        </details>

        {/* Translation workspace */}
        <div className="space-y-4 border-t border-white/5 pt-4">
          <div className="text-[10px] font-mono uppercase tracking-widest text-accent-gold">
            Indonesian Translation
          </div>

          {/* Text ID Input */}
          <div className="space-y-1.5 relative">
            <div className="absolute right-0 top-0 z-10 flex gap-2">
              <button
                type="button"
                className="text-[10px] text-accent-teal/80 hover:text-accent-teal transition hover:underline"
                onClick={() => handleTranslationChange(entry.en ?? "")}
              >
                Copy English
              </button>
            </div>
            <DiffField
              label="Indonesian Text (text_id)"
              value={translation}
              original={baseEntry.id ?? ""}
              onChange={handleTranslationChange}
              onReset={handleReset}
              multiline
              maxLength={MAX_TEXT_LEN}
            />
            {tooLong && (
              <div className="text-[11px] text-rose-300">over {MAX_TEXT_LEN} characters</div>
            )}
          </div>

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
            title="Save draft then jump to next entry"
          >
            Save & next
          </button>
          <span className="mx-1 h-4 w-px bg-white/10" aria-hidden="true" />
          <button
            type="button"
            className="btn"
            onClick={() => onSelectNext?.(-1)}
            title="Previous entry"
            aria-label="Previous entry"
          >
            ←
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => onSelectNext?.(1)}
            title="Next entry"
            aria-label="Next entry"
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
          {changed && (
            <span className="text-xs text-slate-500">
              Unsaved translation changes
            </span>
          )}
          {tooLong && (
            <span className="ml-auto text-xs text-rose-300">
              validation issue(s)
            </span>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmDiscard}
        title="Discard all edits?"
        message="This resets the Indonesian field back to its original state. Saved drafts will not be modified."
        confirmLabel="Discard"
        destructive
        onCancel={() => setConfirmDiscard(false)}
        onConfirm={discardAll}
      />
    </form>
  );
}
