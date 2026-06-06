import { useEffect, useMemo, useRef, useState } from "react";
import type { DialogueLine, DraftPatch, Lang, TreeDropPosition } from "../../lib/types";
import ConfirmDialog from "./ConfirmDialog";
import DiffField from "./DiffField";
import LangTabs from "./LangTabs";
import OptionsSubform from "./OptionsSubform";
import { useUnsavedGuard } from "../../lib/useUnsavedGuard";
import { useLocalDraft } from "../../lib/useLocalDraft";
import { useToast } from "../Toast";
import { useHotkey } from "../../lib/keyboard";

type Tab = Lang | "META";
type SpeakerKey = "speaker_en" | "speaker_zh-Hans" | "speaker_ja";
type TextKey = "text_en" | "text_zh-Hans" | "text_ja";

const LANG_KEYS: Lang[] = ["en", "zh-Hans", "ja"];
const TAB_ORDER: Tab[] = ["META", "en", "zh-Hans", "ja"];

function speakerKey(lang: Lang): SpeakerKey {
  return lang === "zh-Hans" ? "speaker_zh-Hans" : `speaker_${lang}`;
}

function textKey(lang: Lang): TextKey {
  return lang === "zh-Hans" ? "text_zh-Hans" : `text_${lang}`;
}

function basePatch(line: DialogueLine, draft: DialogueLine): DraftPatch {
  const patch: DraftPatch = {};
  for (const key of ["type", "state_key"] as const) {
    if (draft[key] !== line[key]) patch[key] = draft[key];
  }
  for (const lang of LANG_KEYS) {
    const sKey = speakerKey(lang);
    const tKey = textKey(lang);
    if (draft[sKey] !== line[sKey]) patch[sKey] = draft[sKey];
    if (draft[tKey] !== line[tKey]) patch[tKey] = draft[tKey];
  }
  if (JSON.stringify(draft.options ?? []) !== JSON.stringify(line.options ?? [])) {
    patch.options = draft.options ?? [];
  }
  return patch;
}

function hasPatch(patch: DraftPatch): boolean {
  return Object.keys(patch).length > 0;
}

const MAX_TEXT_LEN = 1000;

const STATE_KEY_RE = /^(.*)_(\d+)_(\d+)$/;

function parseStateKey(stateKey: string) {
  const match = stateKey.match(STATE_KEY_RE);
  if (!match) return null;
  return {
    flowName: match[1],
    stateId: Number(match[2]),
    subId: Number(match[3]),
  };
}

function validateField(value: string, field: string): string | null {
  if (!value.trim() && (field.startsWith("text_") || field === "type" || field === "state_key")) {
    return "empty";
  }
  if (value.length > MAX_TEXT_LEN) return "too long";
  return null;
}

export default function LineForm({
  line,
  originalLine,
  qid,
  tab,
  onTabChange,
  onSubmit,
  onPreview,
  busy,
  onSelectNext,
  allLines,
  linesByState,
  stateOrderByFlow,
  multiLang,
  onMoveBlock,
}: {
  line: DialogueLine;
  originalLine?: DialogueLine;
  qid: number;
  tab: Tab;
  onTabChange: (next: Tab) => void;
  onSubmit: (patch: DraftPatch, note: string) => void;
  onPreview?: (line: DialogueLine) => void;
  busy: boolean;
  onSelectNext?: (direction: 1 | -1) => void;
  allLines?: DialogueLine[];
  linesByState?: Map<string, DialogueLine[]>;
  stateOrderByFlow?: Map<string, string[]>;
  multiLang?: boolean;
  onMoveBlock?: (
    movedLineIds: number[],
    targetLineIds: number[],
    position: TreeDropPosition,
  ) => void;
}) {
  const baseLine = originalLine ?? line;
  const [draft, setDraft] = useState<DialogueLine>(line);
  const [note, setNote] = useState("");
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [showRestore, setShowRestore] = useState(false);
  const [moveStateTarget, setMoveStateTarget] = useState("");
  const localDraft = useLocalDraft<{ draft: DialogueLine; note: string }>(qid, line.id);
  const initialised = useRef(false);
  const toast = useToast();

  useEffect(() => {
    initialised.current = false;
    onTabChange("META");
    setNote("");
    setShowRestore(false);
    setConfirmDiscard(false);
    setMoveStateTarget("");
  }, [line.id, onTabChange]);

  function handleMoveState(position: "before" | "after") {
    if (!onMoveBlock) return;
    if (!linesByState || !stateOrderByFlow) {
      // Fallback to old allLines path if precomputed maps not provided
      if (!allLines) return;
    }
    const target = moveStateTarget.trim().replace(/^#/, "");
    if (!target) {
      toast.error("Please enter a target state");
      return;
    }

    let targetLines: DialogueLine[] = [];

    // [N] — local position within the current line's flow
    const bracketMatch = target.match(/^\[(\d+)\]$/);
    if (bracketMatch) {
      const localIndex = Number(bracketMatch[1]);
      const currentParsed = parseStateKey(line.state_key ?? "");
      const currentFlow = currentParsed?.flowName || "Ungrouped";
      const stateOrder = stateOrderByFlow?.get(currentFlow) ?? [];
      const targetStateKey = stateOrder[localIndex - 1];
      if (targetStateKey && linesByState) {
        targetLines = linesByState.get(targetStateKey) ?? [];
      } else if (targetStateKey && allLines) {
        targetLines = allLines.filter((l) => l.state_key === targetStateKey);
      }
    } else {
      // Try matching stateId.subId
      const stateMatch = target.match(/^(\d+)\.(\d+)$/);
      if (stateMatch) {
        const stateId = Number(stateMatch[1]);
        const subId = Number(stateMatch[2]);
        // Search linesByState for one whose key parses to (stateId, subId)
        if (linesByState) {
          for (const [k, ls] of linesByState) {
            const parsed = parseStateKey(k);
            if (parsed && parsed.stateId === stateId && parsed.subId === subId) {
              targetLines = ls;
              break;
            }
          }
        }
        if (targetLines.length === 0 && allLines) {
          targetLines = allLines.filter((l) => {
            const parsed = parseStateKey(l.state_key ?? "");
            return parsed && parsed.stateId === stateId && parsed.subId === subId;
          });
        }
      } else {
        // Try matching state_key directly
        if (linesByState) {
          targetLines = linesByState.get(target) ?? [];
        }
        if (targetLines.length === 0 && allLines) {
          targetLines = allLines.filter((l) => l.state_key === target);
        }
      }
    }

    if (targetLines.length === 0) {
      toast.error(`Target state "${target}" not found`);
      return;
    }

    const currentStateLines = linesByState
      ? (linesByState.get(line.state_key ?? "") ?? [])
      : (allLines?.filter((l) => l.state_key === line.state_key) ?? []);
    const currentLineIds = currentStateLines.map((l) => l.id);
    const targetLineIds = targetLines.map((l) => l.id);

    onMoveBlock(currentLineIds, targetLineIds, position);
    toast.success(`Moved state ${position} target state`);
    setMoveStateTarget("");
  }

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

  const fieldErrors = useMemo(() => {
    const errors: Record<string, string> = {};
    for (const lang of LANG_KEYS) {
      const t = draft[textKey(lang)];
      if (typeof t === "string") {
        const e = validateField(t, `text_${lang}`);
        if (e) errors[`text_${lang}`] = e;
      }
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
      className="flex h-full flex-col"
      onSubmit={(e) => {
        e.preventDefault();
        submit(0);
      }}
    >
      <div className="space-y-4 pb-32">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs text-slate-500">Line #{line.id}</div>
            <div className="font-serif text-xl text-slate-100">{line.text_key || <em className="text-slate-500">no text_key</em>}</div>
          </div>
          <div className="text-xs text-slate-500">
            <a className="link" href={`/quests/${qid}#line-${line.id}`} target="_blank" rel="noreferrer">
              open in viewer ↗
            </a>
          </div>
        </div>

        {showRestore && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-accent-gold/30 bg-accent-gold/5 p-2 text-xs text-slate-200">
            <span>Restored unsaved edits from your last session.</span>
            <div className="flex gap-2">
              <button type="button" className="btn text-[11px]" onClick={discardLocal}>
                Discard local
              </button>
            </div>
          </div>
        )}

        <LangTabs active={tab} onChange={onTabChange} />

        {tab === "META" ? (
          <div className="space-y-4">
              {/* Quick Move Section */}
              <div className="rounded-md border border-white/10 bg-bg-2 p-3 space-y-3">
                <div className="text-[10px] font-mono uppercase tracking-widest text-slate-500">Quick Move</div>

                {/* Move State */}
              {line.state_key && (
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-slate-300">
                    Move entire State ({(() => {
                      const parsed = parseStateKey(line.state_key ?? "");
                      return parsed ? `${parsed.stateId}.${parsed.subId}` : line.state_key;
                    })()})
                  </label>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      placeholder="target state (e.g. 1.2 or [2])"
                      value={moveStateTarget}
                      onChange={(e) => setMoveStateTarget(e.target.value)}
                      className="input h-8 text-xs font-mono w-44"
                    />
                    <button
                      type="button"
                      disabled={!moveStateTarget.trim() || !onMoveBlock}
                      onClick={() => handleMoveState("before")}
                      className="btn h-8 px-2.5 text-xs"
                    >
                      Before
                    </button>
                    <button
                      type="button"
                      disabled={!moveStateTarget.trim() || !onMoveBlock}
                      onClick={() => handleMoveState("after")}
                      className="btn h-8 px-2.5 text-xs"
                    >
                      After
                    </button>
                  </div>
                </div>
              )}
            </div>
            <DiffField
              label="type"
              value={String(draft.type ?? "")}
              original={String(baseLine.type ?? "")}
              onChange={(value) => updateField("type", value)}
              onReset={() => resetField("type")}
            />
            <DiffField
              label="state_key"
              value={String(draft.state_key ?? "")}
              original={String(baseLine.state_key ?? "")}
              onChange={(value) => updateField("state_key", value)}
              onReset={() => resetField("state_key")}
            />
            <OptionsSubform
              options={draft.options ?? []}
              originals={baseLine.options ?? []}
              onChange={(options) => updateField("options", options)}
              allLines={allLines}
              currentLineId={line.id}
            />
          </div>
        ) : multiLang ? (
          <div className="space-y-4">
            {LANG_KEYS.map((lang) => {
              const sKey = speakerKey(lang);
              const tKey = textKey(lang);
              return (
                <div key={lang} className="rounded-md border border-white/5 bg-bg-1/40 p-3">
                  <div className="mb-2 text-[10px] font-mono uppercase tracking-widest text-slate-500">
                    {lang}
                  </div>
                  <div className="space-y-3">
                    <DiffField
                      label={`speaker_${lang}`}
                      value={String(draft[sKey] ?? "")}
                      original={String(baseLine[sKey] ?? "")}
                      onChange={(value) => updateField(sKey, value)}
                      onReset={() => resetField(sKey)}
                    />
                    <DiffField
                      label={`text_${lang}`}
                      value={String(draft[tKey] ?? "")}
                      original={String(baseLine[tKey] ?? "")}
                      onChange={(value) => updateField(tKey, value)}
                      onReset={() => resetField(tKey)}
                      multiline
                      maxLength={MAX_TEXT_LEN}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="space-y-4">
            <DiffField
              label={`speaker_${tab}`}
              value={String(draft[speakerKey(tab)] ?? "")}
              original={String(baseLine[speakerKey(tab)] ?? "")}
              onChange={(value) => updateField(speakerKey(tab), value)}
              onReset={() => resetField(speakerKey(tab))}
            />
            <DiffField
              label={`text_${tab}`}
              value={String(draft[textKey(tab)] ?? "")}
              original={String(baseLine[textKey(tab)] ?? "")}
              onChange={(value) => updateField(textKey(tab), value)}
              onReset={() => resetField(textKey(tab))}
              multiline
              maxLength={MAX_TEXT_LEN}
            />
            {fieldErrors[`text_${tab}`] === "empty" && (
              <div className="text-[11px] text-amber-300">empty text</div>
            )}
            {fieldErrors[`text_${tab}`] === "too long" && (
              <div className="text-[11px] text-rose-300">over {MAX_TEXT_LEN} characters</div>
            )}
          </div>
        )}

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-slate-300" htmlFor="draft-note">
            Note (optional)
          </label>
          <textarea
            id="draft-note"
            className="input min-h-16 resize-y text-xs"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="why this change? reviewers will see this."
          />
        </div>
      </div>

      <div className="sticky bottom-0 -mx-4 mt-auto border-t border-white/10 bg-bg-1/90 px-4 py-3 backdrop-blur-md">
        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" className="btn btn-active" disabled={!canSave} title="Ctrl+S">
            {busy ? "Saving…" : "Save as draft"}
          </button>
          <button
            type="button"
            className="btn"
            disabled={!canSave}
            onClick={() => submit(1)}
            title="Save then jump to next line"
          >
            Save & next
          </button>
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
              {Object.keys(patch).length} changed field(s)
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
        message="This resets the working copy for this line. Drafts already saved are not affected."
        confirmLabel="Discard"
        destructive
        onCancel={() => setConfirmDiscard(false)}
        onConfirm={discardAll}
      />
    </form>
  );
}

export { TAB_ORDER };
