import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { DialogueLine, Draft, DraftPatch } from "../../lib/types";
import ConfirmDialog from "./ConfirmDialog";
import DiffField from "./DiffField";
import { useUnsavedGuard } from "../../lib/useUnsavedGuard";
import { useLocalDraft } from "../../lib/useLocalDraft";
import { useToast } from "../Toast";
import { useHotkey } from "../../lib/keyboard";
import { api } from "../../lib/api";
import { applyDraftPatch, localDraftForLine, parseDraftPatch, translationFindings } from "../../lib/translatorWorkflow";

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
  pendingDraft,
  context,
  actionableRemaining,
  onSelectNext,
  onSelectActionable,
  onSelectLine,
  allLines,
}: {
  line: DialogueLine;
  originalLine?: DialogueLine;
  qid: number;
  onSubmit: (patch: DraftPatch, note: string) => Promise<void>;
  onPreview?: (line: DialogueLine) => void;
  busy: boolean;
  pendingDraft?: Draft;
  context: { previous: DialogueLine | null; next: DialogueLine | null };
  actionableRemaining: number;
  onSelectNext?: (direction: 1 | -1) => void;
  onSelectActionable: () => void;
  onSelectLine: (id: number) => void;
  allLines?: DialogueLine[];
}) {
  const baseLine = originalLine ?? line;
  const pendingPatch = useMemo(() => parseDraftPatch(pendingDraft), [pendingDraft]);
  const pendingLine = useMemo(() => applyDraftPatch(baseLine, pendingPatch), [baseLine, pendingPatch]);
  const pendingNote = pendingDraft?.note ?? "";
  const serverSignature = JSON.stringify({ patch: pendingPatch, note: pendingNote.trim() });
  const [draft, setDraft] = useState<DialogueLine>(pendingLine);
  const [note, setNote] = useState(pendingNote);
  const [lastSubmittedSignature, setLastSubmittedSignature] = useState(serverSignature);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [showRestore, setShowRestore] = useState(false);
  const [contextOpen, setContextOpen] = useState(() => typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches);
  const [qualityOpen, setQualityOpen] = useState(true);
  const localDraft = useLocalDraft<{ draft: DialogueLine; note: string }>(qid, line.id);
  const restoredLocalDraft = localDraftForLine(localDraft.restored, line.id);
  const initialisedKey = useRef("");
  const initialisationKey = `${line.id}:${pendingDraft?.id ?? "new"}:${pendingDraft?.updated_at ?? ""}`;
  const formRef = useRef<HTMLFormElement>(null);
  const toast = useToast();

  useEffect(() => {
    setConfirmDiscard(false);
    setContextOpen(window.matchMedia("(min-width: 1024px)").matches);
    setQualityOpen(true);
  }, [line.id]);

  useEffect(() => {
    if (initialisedKey.current === initialisationKey) return;
    if (restoredLocalDraft) {
      setDraft(restoredLocalDraft.draft);
      setNote(restoredLocalDraft.note);
      setShowRestore(true);
    } else {
      setDraft(pendingLine);
      setNote(pendingNote);
      setShowRestore(false);
      if (localDraft.restored) localDraft.clear();
    }
    setLastSubmittedSignature(serverSignature);
    initialisedKey.current = initialisationKey;
  }, [initialisationKey, localDraft.clear, localDraft.restored, pendingLine, pendingNote, restoredLocalDraft, serverSignature]);

  useEffect(() => {
    if (!window.matchMedia("(min-width: 1024px)").matches) return;
    const frame = requestAnimationFrame(() => formRef.current?.querySelector<HTMLTextAreaElement>("textarea")?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [line.id]);

  const patch = basePatch(baseLine, draft);
  const currentSignature = JSON.stringify({ patch, note: note.trim() });
  const dirty = currentSignature !== lastSubmittedSignature;

  useEffect(() => {
    if (initialisedKey.current !== initialisationKey || draft.id !== line.id || !dirty) return;
    localDraft.save({ draft, note });
  }, [dirty, draft, initialisationKey, line.id, note, localDraft.save]);

  const canSave = hasPatch(patch) && dirty && !busy;
  useUnsavedGuard(dirty && localDraft.status !== "saved");

  useHotkey("s", () => void submit(0), { mod: true, allowInInputs: true });
  useHotkey("Enter", () => void submit(1), { mod: true, allowInInputs: true });

  const sourceTexts = useMemo(
    () => [baseLine.speaker_en, baseLine.text_en, ...(baseLine.options ?? []).map((option) => option.text_en)].filter(Boolean),
    [baseLine],
  );
  const glossaryQ = useQuery({
    queryKey: ["translator", "glossary", sourceTexts],
    queryFn: () => api.glossaryMatches(sourceTexts),
    enabled: sourceTexts.length > 0,
    staleTime: Infinity,
  });
  const findings = useMemo(
    () => translationFindings(baseLine, draft, glossaryQ.data ?? []),
    [baseLine, draft, glossaryQ.data],
  );

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

  const hasParentText = !!(line.text_en || line["text_zh-Hans"] || line.text_ja || line.text_id);
  const isOptionLine = (line.type === "Option" || line.type === "SystemOption") && !hasParentText;
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
    setDraft(pendingLine);
    setNote(pendingNote);
    onPreview?.(pendingLine);
    localDraft.clear();
    setShowRestore(false);
    setConfirmDiscard(false);
  }

  function discardLocal() {
    setDraft(pendingLine);
    setNote(pendingNote);
    onPreview?.(pendingLine);
    localDraft.clear();
    setShowRestore(false);
  }

  async function submit(advance: 0 | 1 = 0) {
    if (!canSave) return;
    if (Object.keys(fieldErrors).length > 0) {
      toast.error("Fix validation errors before saving");
      return;
    }
    try {
      await onSubmit(patch, note.trim());
    } catch {
      return;
    }
    setLastSubmittedSignature(currentSignature);
    localDraft.clear();
    setShowRestore(false);
    if (advance === 1) onSelectActionable();
  }

  return (
    <form
      ref={formRef}
      className="flex min-h-full flex-col"
      onSubmit={(e) => {
        e.preventDefault();
        void submit(0);
      }}
    >
      <div className="sticky top-0 z-20 flex flex-wrap items-center gap-3 border-b border-white/10 bg-bg-1 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 font-mono text-[10px] text-slate-500">
            <span>LINE #{line.id}</span>
            <span className="border border-white/10 bg-bg-2 px-1.5 py-0.5 text-slate-400">{line.type}</span>
          </div>
          <div className="mt-1 truncate font-mono text-xs text-accent-signal">
            {line.text_key || <span className="text-slate-600">No text key</span>}
          </div>
        </div>
        <a className="link inline-flex min-h-11 items-center whitespace-nowrap text-xs" href={`/quests/${qid}#line-${line.id}`} target="_blank" rel="noreferrer">
          Open in viewer ↗
        </a>
      </div>

      <div className="flex-1 pb-36 lg:pb-24">
        <div className="px-4 pt-4">
        {showRestore && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-md border border-accent-signal/30 bg-accent-signal/5 p-3 text-xs text-slate-200">
            <span>Restored unsaved translation edits from your last session.</span>
            <button type="button" className="btn text-[11px]" onClick={discardLocal}>Discard local</button>
          </div>
        )}
        </div>

        {(context.previous || context.next) && (
          <details
            className="border-t border-white/10 bg-bg-1/30"
            open={contextOpen}
            onToggle={(event) => setContextOpen(event.currentTarget.open)}
          >
            <summary className="flex min-h-11 cursor-pointer items-center justify-between px-4 text-xs text-slate-400 hover:text-slate-200">
              <span>Dialogue context</span>
              <span className="font-mono text-[10px] text-slate-600">SAME STATE</span>
            </summary>
            <div className="grid border-t border-white/10 md:grid-cols-2 md:divide-x md:divide-white/10">
              {[{ label: "Previous", value: context.previous }, { label: "Next", value: context.next }].map(({ label, value }) => value ? (
                <button
                  key={label}
                  type="button"
                  className="min-w-0 border-b border-white/10 p-3 text-left hover:bg-white/[0.03] md:border-b-0"
                  onClick={() => onSelectLine(value.id)}
                >
                  <span className="font-mono text-[10px] text-slate-600">{label.toUpperCase()} · #{value.id}</span>
                  <span className="mt-1 block truncate text-xs font-semibold text-slate-300">{value.speaker_id || value.speaker_en || "Unknown speaker"}</span>
                  <span className="mt-1 block line-clamp-2 text-xs leading-relaxed text-slate-500">{value.text_id || value.text_en || "No dialogue text"}</span>
                </button>
              ) : (
                <div key={label} className="hidden md:block" />
              ))}
            </div>
          </details>
        )}

        {!isOptionLine && (
          <div className="grid border-y border-white/10 xl:grid-cols-[minmax(18rem,0.85fr)_minmax(24rem,1.15fr)] xl:divide-x xl:divide-white/10">
            <section className="bg-bg-1/40 px-4 py-5" aria-labelledby="source-language-heading">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h2 id="source-language-heading" className="font-sans text-sm font-semibold text-slate-300">Source</h2>
                <span className="font-mono text-[10px] text-slate-600">EN · ZH-HANS · JA</span>
              </div>
              <div className="border-l-2 border-accent-signal/50 pl-4">
                <div className="mb-2 text-sm font-semibold text-accent-signal">
                  {line.speaker_en || <span className="text-slate-600">Unknown speaker</span>}
                </div>
                <div className="whitespace-pre-wrap text-base leading-relaxed text-slate-100">
                  {line.text_en || <span className="text-slate-500">No English text</span>}
                </div>
              </div>

              <details className="group mt-5 border-t border-white/10 text-xs">
                <summary className="flex min-h-11 cursor-pointer select-none items-center justify-between text-slate-500 hover:text-slate-200">
                  <span>Supporting references</span>
                  <span className="text-[10px]" aria-hidden="true">▼</span>
                </summary>
                <div className="grid gap-4 border-t border-white/5 pt-4 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                  <div className="space-y-2">
                    <div className="font-mono text-[10px] uppercase text-slate-500">Chinese (Simplified)</div>
                    {line["speaker_zh-Hans"] && <div className="font-semibold text-accent-signal">{line["speaker_zh-Hans"]}</div>}
                    <div className="whitespace-pre-wrap leading-relaxed text-slate-300">{line["text_zh-Hans"] || <span className="text-slate-600">No Chinese text</span>}</div>
                  </div>
                  <div className="space-y-2">
                    <div className="font-mono text-[10px] uppercase text-slate-500">Japanese</div>
                    {line.speaker_ja && <div className="font-semibold text-accent-slate">{line.speaker_ja}</div>}
                    <div className="whitespace-pre-wrap leading-relaxed text-slate-300">{line.text_ja || <span className="text-slate-600">No Japanese text</span>}</div>
                  </div>
                </div>
              </details>
            </section>

            <section className="px-4 py-5" aria-labelledby="target-language-heading">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <h2 id="target-language-heading" className="font-sans text-sm font-semibold text-slate-100">Bahasa Indonesia</h2>
                <button
                  type="button"
                  className="btn border-accent-signal/30 bg-transparent text-xs text-accent-signal"
                  onClick={() => updateField("text_id", line.text_en ?? "")}
                >
                  Copy English source
                </button>
              </div>
              <div className="space-y-5">
                <div>
                <DiffField
                  label="Speaker name"
                  value={draft.speaker_id ?? ""}
                  original={baseLine.speaker_id ?? ""}
                  onChange={(value) => updateField("speaker_id", value)}
                  onReset={() => resetField("speaker_id")}
                />
                {speakerSuggestions.length > 0 && (
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px]">
                    <span className="select-none text-slate-500">Known names</span>
                    {speakerSuggestions.map((name) => (
                      <button
                        key={name}
                        type="button"
                        className="chip min-h-11 text-slate-300"
                        onClick={() => updateField("speaker_id", name)}
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
                <DiffField
                  label="Dialogue text"
                  value={draft.text_id ?? ""}
                  original={baseLine.text_id ?? ""}
                  onChange={(value) => updateField("text_id", value)}
                  onReset={() => resetField("text_id")}
                  multiline
                  maxLength={MAX_TEXT_LEN}
                />
              </div>
            </section>
          </div>
        )}

        {(glossaryQ.data?.length || findings.length > 0) && (
          <details
            className="border-b border-white/10 bg-bg-1/20"
            open={qualityOpen}
            onToggle={(event) => setQualityOpen(event.currentTarget.open)}
          >
            <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-3 px-4 text-xs text-slate-400 hover:text-slate-200">
              <span>Quality & glossary</span>
              <span className="font-mono text-[10px]">
                {findings.length > 0 ? `${findings.length} WARNING${findings.length === 1 ? "" : "S"}` : `${glossaryQ.data?.length ?? 0} TERMS`}
              </span>
            </summary>
            <div className="grid gap-4 border-t border-white/10 px-4 py-4 lg:grid-cols-2">
              <div>
                <div className="mb-2 font-mono text-[10px] uppercase text-slate-600">Advisory checks</div>
                {findings.length > 0 ? (
                  <ul className="space-y-2 text-xs text-amber-300">
                    {findings.map((finding, index) => (
                      <li key={`${finding.code}:${finding.field}:${index}`} className="border-l border-amber-300/40 pl-2">
                        {finding.message}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="text-xs text-accent-emerald">No advisory issues.</div>
                )}
              </div>
              <div>
                <div className="mb-2 font-mono text-[10px] uppercase text-slate-600">Relevant glossary</div>
                {glossaryQ.isLoading ? (
                  <div className="text-xs text-slate-600">Checking glossary…</div>
                ) : glossaryQ.error ? (
                  <div className="text-xs text-rose-300">Glossary unavailable; saving remains enabled.</div>
                ) : (glossaryQ.data?.length ?? 0) > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {glossaryQ.data?.map((match) => (
                      <span key={match.term} className="chip" title={match.category}>
                        <span className="text-slate-500">{match.term}</span>
                        <span aria-hidden="true">/</span>
                        <span className="text-accent-signal">{match.indonesian_translation || "—"}</span>
                      </span>
                    ))}
                  </div>
                ) : (
                  <div className="text-xs text-slate-600">No glossary terms in this line.</div>
                )}
              </div>
            </div>
          </details>
        )}

        {hasOptions && (
          <section className="border-b border-white/10 px-4 py-5" aria-labelledby="option-translations-heading">
            <div className="mb-4 flex items-baseline justify-between gap-3">
              <h2 id="option-translations-heading" className="font-sans text-sm font-semibold text-slate-200">Option translations</h2>
              <span className="font-mono text-[10px] text-slate-600">{draft.options?.length ?? 0} OPTIONS</span>
            </div>
            <div className="space-y-4">
              {(draft.options ?? []).map((opt, idx) => {
                const origOpt = baseLine.options?.[idx];
                return (
                  <div key={idx} className="border border-white/10 bg-bg-1/30">
                    <div className="flex items-center justify-between gap-3 border-b border-white/10 px-3 py-2">
                      <span className="text-xs font-semibold text-slate-400">Option {idx + 1}</span>
                      <span className="max-w-[60%] truncate font-mono text-[10px] text-slate-600">{opt.text_key}</span>
                    </div>
                    <div className="grid lg:grid-cols-2 lg:divide-x lg:divide-white/10">
                      <div className="space-y-3 border-b border-white/10 p-3 text-xs lg:border-b-0">
                        <div>
                          <div className="mb-1 font-mono text-[10px] uppercase text-slate-500">English source</div>
                          <div className="whitespace-pre-wrap leading-relaxed text-slate-200">{opt.text_en || <span className="text-slate-600">—</span>}</div>
                        </div>
                        <details className="text-slate-500">
                          <summary className="flex min-h-11 cursor-pointer items-center">Chinese & Japanese</summary>
                          <div className="grid gap-3 border-t border-white/5 pt-3 sm:grid-cols-2">
                            <div className="whitespace-pre-wrap leading-relaxed">{opt["text_zh-Hans"] || "—"}</div>
                            <div className="whitespace-pre-wrap leading-relaxed">{opt.text_ja || "—"}</div>
                          </div>
                        </details>
                      </div>
                      <div className="p-3">
                        <div className="mb-2 flex justify-end">
                        <button
                          type="button"
                          className="min-h-11 whitespace-nowrap px-2 text-xs text-accent-signal"
                          onClick={() => updateOptionText(idx, opt.text_en ?? "")}
                        >
                          Copy English source
                        </button>
                        </div>
                        <DiffField
                          label="Bahasa Indonesia"
                          value={opt.text_id ?? ""}
                          original={origOpt?.text_id ?? ""}
                          onChange={(value) => updateOptionText(idx, value)}
                          onReset={() => resetOptionText(idx)}
                          multiline
                          maxLength={MAX_TEXT_LEN}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        <div className="space-y-2 px-4 py-5">
            <label className="text-xs font-medium text-slate-300" htmlFor="draft-note">
              Note for reviewer <span className="font-normal text-slate-600">(optional)</span>
            </label>
            <textarea
              id="draft-note"
              className="input min-h-20 resize-y text-xs"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Context, rationale, or question for reviewer…"
            />
        </div>
      </div>

      <div className="sticky bottom-0 z-20 mt-auto border-t border-white/10 bg-bg-1 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1" aria-label="Line navigation">
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
          </div>
          <div className="min-w-0 flex-1 text-xs" aria-live="polite">
            {Object.keys(fieldErrors).length > 0 ? (
              <span className="text-rose-300">{Object.keys(fieldErrors).length} validation issue(s)</span>
            ) : localDraft.status === "error" ? (
              <span className="text-rose-300">Local autosave unavailable</span>
            ) : localDraft.status === "saving" ? (
              <span className="text-slate-400">Saving locally…</span>
            ) : dirty && localDraft.status === "saved" ? (
              <span className="text-accent-signal">Saved locally</span>
            ) : hasPatch(patch) ? (
              <span className="text-accent-signal">Unsaved translation changes</span>
            ) : dirty ? (
              <span className="text-slate-400">Note needs a translation change before saving</span>
            ) : (
              <span className="text-slate-600">No translation changes</span>
            )}
            <span className="ml-2 hidden font-mono text-[10px] text-slate-600 sm:inline">{actionableRemaining} actionable</span>
          </div>
          <button
            type="button"
            className="btn"
            disabled={!dirty || busy}
            onClick={() => setConfirmDiscard(true)}
          >
            Discard
          </button>
          <button type="submit" className="btn" disabled={!canSave} title="Ctrl/⌘ + S" aria-busy={busy}>
            {busy ? "Saving…" : "Save draft"}
          </button>
          <button
            type="button"
            className="btn btn-active"
            disabled={!canSave}
            onClick={() => void submit(1)}
            title="Save draft then jump to next actionable line · Ctrl/⌘ + Enter"
            aria-busy={busy}
          >
            Save & next
          </button>
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
