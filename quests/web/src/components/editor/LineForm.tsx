import { useEffect, useRef, useState } from "react";
import type { DialogueLine, DraftPatch, TreeDropPosition } from "../../lib/types";
import ConfirmDialog from "./ConfirmDialog";
import DiffField from "./DiffField";
import OptionsSubform from "./OptionsSubform";
import { useUnsavedGuard } from "../../lib/useUnsavedGuard";
import { useLocalDraft } from "../../lib/useLocalDraft";
import { useToast } from "../Toast";
import { useHotkey } from "../../lib/keyboard";

function basePatch(line: DialogueLine, draft: DialogueLine): DraftPatch {
  const patch: DraftPatch = {};
  for (const key of ["type", "state_key"] as const) {
    if (draft[key] !== line[key]) patch[key] = draft[key];
  }
  if (JSON.stringify(draft.options ?? []) !== JSON.stringify(line.options ?? [])) {
    patch.options = draft.options ?? [];
  }
  return patch;
}

function hasPatch(patch: DraftPatch): boolean {
  return Object.keys(patch).length > 0;
}

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

export default function LineForm({
  line,
  originalLine,
  qid,
  busy,
  onSubmit,
  onPreview,
  onSelectNext,
  allLines,
  linesByState,
  stateOrderByFlow,
  onMoveBlock,
}: {
  line: DialogueLine;
  originalLine?: DialogueLine;
  qid: number;
  busy: boolean;
  onSubmit: (patch: DraftPatch, note: string) => void;
  onPreview?: (line: DialogueLine) => void;
  onSelectNext?: (direction: 1 | -1) => void;
  allLines?: DialogueLine[];
  linesByState?: Map<string, DialogueLine[]>;
  stateOrderByFlow?: Map<string, string[]>;
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
    setNote("");
    setShowRestore(false);
    setConfirmDiscard(false);
    setMoveStateTarget("");
  }, [line.id]);

  function handleMoveState(position: "before" | "after") {
    if (!onMoveBlock) return;
    if (!linesByState || !stateOrderByFlow) {
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
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/5 pb-2">
          <div>
            <div className="text-xs text-slate-500">Line #{line.id}</div>
            <div className="font-serif text-lg text-slate-100">{line.text_key || <em className="text-slate-500">no text_key</em>}</div>
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

        {/* English Text Context Box */}
        <div className="rounded-lg border border-white/5 bg-bg-2/30 p-3 text-xs mb-1">
          <div className="text-[10px] font-mono text-slate-500 mb-1 uppercase">English Source Context</div>
          {line.speaker_en && (
            <div className="font-semibold text-accent-gold mb-0.5">{line.speaker_en}</div>
          )}
          <div className="text-slate-300 whitespace-pre-wrap leading-relaxed">{line.text_en || <em className="text-slate-500">no source text</em>}</div>
        </div>

        {/* Quick Move Section */}
        {line.state_key && (
          <div className="rounded-md border border-white/10 bg-bg-2 p-3 space-y-3">
            <div className="text-[10px] font-mono uppercase tracking-widest text-slate-500">Quick Move State</div>
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
          </div>
        )}

        {/* Metadata Inputs */}
        <div className="space-y-4">
          <DiffField
            label="Line Type"
            value={String(draft.type ?? "")}
            original={String(baseLine.type ?? "")}
            onChange={(value) => updateField("type", value)}
            onReset={() => resetField("type")}
          />
          <DiffField
            label="State Key"
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

        {/* Save Note */}
        <div className="space-y-1.5 border-t border-white/5 pt-3">
          <label className="text-xs font-medium text-slate-300" htmlFor="draft-note">
            Note (optional)
          </label>
          <textarea
            id="draft-note"
            className="input min-h-16 resize-y text-xs"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Why this metadata/structural change? Reviewers will see this."
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
              {Object.keys(patch).length} changed structural field(s)
            </span>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmDiscard}
        title="Discard all edits?"
        message="This resets the metadata settings for this line. Drafts already saved will not be changed."
        confirmLabel="Discard"
        destructive
        onCancel={() => setConfirmDiscard(false)}
        onConfirm={discardAll}
      />
    </form>
  );
}
