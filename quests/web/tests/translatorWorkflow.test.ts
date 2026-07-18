import assert from "node:assert/strict";
import test from "node:test";
import type { DialogueLine, GlossaryMatch } from "../src/lib/types.ts";
import {
  dialogueContext,
  isTranslationComplete,
  lineNeedsTranslation,
  localDraftForLine,
  nextActionableLineId,
  translationFindings,
} from "../src/lib/translatorWorkflow.ts";

function line(id: number, overrides: Partial<DialogueLine> = {}): DialogueLine {
  return {
    id,
    type: "Talk",
    state_key: "flow_1_1",
    text_key: `line_${id}`,
    "speaker_zh-Hans": "",
    speaker_en: "Rover",
    speaker_ja: "",
    "text_zh-Hans": "",
    text_en: `Source ${id}`,
    text_ja: "",
    options: [],
    ...overrides,
  };
}

test("completion covers parent, option-only, and no-text lines", () => {
  assert.equal(lineNeedsTranslation(line(1)), true);
  assert.equal(isTranslationComplete(line(1)), false);
  assert.equal(isTranslationComplete(line(1, { text_id: "Terjemahan" })), true);
  assert.equal(isTranslationComplete(line(2, {
    text_en: "",
    options: [{ text_key: "o", "text_zh-Hans": "", text_en: "Choose", text_ja: "" }],
  })), false);
  assert.equal(isTranslationComplete(line(3, { text_en: "", options: [] })), true);
});

test("next actionable skips complete and pending then wraps", () => {
  const lines = new Map([
    [1, line(1)],
    [2, line(2, { text_id: "Selesai" })],
    [3, line(3)],
  ]);
  assert.equal(nextActionableLineId([1, 2, 3], 1, lines, new Set([3])), null);
  assert.equal(nextActionableLineId([1, 2, 3], 3, lines, new Set()), 1);
  assert.equal(nextActionableLineId([1, 2, 3], 1, lines, new Set()), 3);
});

test("context stays inside current state", () => {
  const lines = new Map([
    [1, line(1)],
    [2, line(2)],
    [3, line(3, { state_key: "flow_1_2" })],
  ]);
  assert.equal(dialogueContext([1, 2, 3], 2, lines).previous?.id, 1);
  assert.equal(dialogueContext([1, 2, 3], 2, lines).next, null);
});

test("local draft never crosses into another line", () => {
  const saved = { draft: line(1, { text_id: "Baris satu" }), note: "" };
  assert.equal(localDraftForLine(saved, 1), saved);
  assert.equal(localDraftForLine(saved, 2), null);
});

test("QA reports missing tokens, tags, options, whitespace, and glossary terms", () => {
  const source = line(1, {
    text_en: "<i>Hello {PlayerName}</i>",
    options: [{ text_key: "o", "text_zh-Hans": "", text_en: "Choose Rover", text_ja: "" }],
  });
  const target = line(1, {
    text_id: " Halo ",
    options: [{ text_key: "o", "text_zh-Hans": "", text_en: "Choose Rover", text_ja: "", text_id: "" }],
  });
  const glossary: GlossaryMatch[] = [{ term: "Rover", indonesian_translation: "Rover", category: "Character" }];
  const codes = new Set(translationFindings(source, target, glossary).map((finding) => finding.code));
  assert.deepEqual(codes, new Set(["token-mismatch", "tag-mismatch", "outer-whitespace", "missing-translation", "glossary-mismatch"]));
});
