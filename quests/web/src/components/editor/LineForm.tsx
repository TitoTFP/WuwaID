import { useEffect, useState } from "react";
import type { DialogueLine, DraftPatch, Lang } from "../../lib/types";
import ConfirmDialog from "./ConfirmDialog";
import DiffField from "./DiffField";
import LangTabs from "./LangTabs";
import OptionsSubform from "./OptionsSubform";

type Tab = Lang | "META";
type SpeakerKey = "speaker_en" | "speaker_zh-Hans" | "speaker_ja";
type TextKey = "text_en" | "text_zh-Hans" | "text_ja";

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
  for (const lang of ["en", "zh-Hans", "ja"] as const) {
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

export default function LineForm({
  line,
  onSubmit,
  busy,
}: {
  line: DialogueLine;
  onSubmit: (patch: DraftPatch) => void;
  busy: boolean;
}) {
  const [tab, setTab] = useState<Tab>("en");
  const [draft, setDraft] = useState<DialogueLine>(line);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  useEffect(() => {
    setDraft(line);
    setTab("en");
    setConfirmDiscard(false);
  }, [line.id, line]);

  const patch = basePatch(line, draft);
  const canSave = hasPatch(patch) && !busy;

  function updateField<K extends keyof DialogueLine>(key: K, value: DialogueLine[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSave) onSubmit(patch);
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-xs text-slate-500">Line #{line.id}</div>
          <div className="font-serif text-xl text-slate-100">{line.text_key}</div>
        </div>
      </div>

      <LangTabs active={tab} onChange={setTab} />

      {tab === "META" ? (
        <div className="space-y-4">
          <DiffField
            label="type"
            value={draft.type}
            original={line.type}
            onChange={(value) => updateField("type", value)}
          />
          <DiffField
            label="state_key"
            value={draft.state_key}
            original={line.state_key}
            onChange={(value) => updateField("state_key", value)}
          />
          <OptionsSubform
            options={draft.options ?? []}
            originals={line.options ?? []}
            onChange={(options) => updateField("options", options)}
          />
        </div>
      ) : (
        <div className="space-y-4">
          <DiffField
            label={`speaker_${tab}`}
            value={draft[speakerKey(tab)]}
            original={line[speakerKey(tab)]}
            onChange={(value) => updateField(speakerKey(tab), value)}
          />
          <DiffField
            label={`text_${tab}`}
            value={draft[textKey(tab)]}
            original={line[textKey(tab)]}
            onChange={(value) => updateField(textKey(tab), value)}
            multiline
          />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-white/10 pt-4">
        <button type="submit" className="btn btn-active" disabled={!canSave}>
          {busy ? "Saving…" : "Save as draft"}
        </button>
        <button
          type="button"
          className="btn"
          disabled={!hasPatch(patch) || busy}
          onClick={() => setConfirmDiscard(true)}
        >
          Discard
        </button>
        {hasPatch(patch) && (
          <span className="text-xs text-slate-500">
            {Object.keys(patch).length} changed field(s)
          </span>
        )}
      </div>
      <ConfirmDialog
        open={confirmDiscard}
        title="Discard edits?"
        message="This resets the working copy for this line. Drafts already saved are not affected."
        confirmLabel="Discard"
        destructive
        onCancel={() => setConfirmDiscard(false)}
        onConfirm={() => {
          setDraft(line);
          setConfirmDiscard(false);
        }}
      />
    </form>
  );
}
