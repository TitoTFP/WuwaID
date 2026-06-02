# Editor Realtime Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make editor field and structural changes preview immediately in the browser while preserving explicit draft saving.

**Architecture:** Keep backend draft approval unchanged. Maintain local `previewLines` in `EditorPage`; form edits update the selected preview line, and drag/drop mutates local order immediately while recording unsaved reorder operations. Users still save form edits as individual drafts and can save or reset queued reorder previews.

**Tech Stack:** React 18, TypeScript, Tailwind CSS, TanStack Query.

---

## File Structure

- Modify `web/src/routes/EditorPage.tsx`: add local preview line state, unsaved reorder queue, reset/save controls, form preview callback, and TreeView built from preview lines.
- Modify `web/src/components/editor/LineForm.tsx`: emit draft-line previews while keeping save patches based on the original server line.
- Modify `web/src/components/editor/DialogueTreeView.tsx`: no behavior change expected; keeps calling `onMoveBlock`.
- Modify `web/src/__manual__/editor-flow.md`: verify DnD previews before saving drafts.

## Tasks

### Task 1: Preview State

**Files:**
- Modify: `web/src/routes/EditorPage.tsx`

- [ ] Add `previewLines` state initialized from `questQ.data?.all_lines`.
- [ ] Reset `previewLines` when the loaded quest id/data changes.
- [ ] Build TreeView and selected line from `previewLines`.
- [ ] Pass original selected line into `LineForm` so draft patch generation remains based on server data.

### Task 2: Realtime DnD

**Files:**
- Modify: `web/src/routes/EditorPage.tsx`

- [ ] Change `moveBlock` to reorder `previewLines` immediately.
- [ ] Store unsaved reorder operations as `{ line_id, position_after }`.
- [ ] Add `Save reorder drafts` button that sends queued operations through existing `api.createDraft`.
- [ ] Add `Reset preview` button that restores server-loaded line order and clears queued operations.

### Task 3: Realtime Form Preview

**Files:**
- Modify: `web/src/components/editor/LineForm.tsx`
- Modify: `web/src/routes/EditorPage.tsx`

- [ ] Add `onPreview` prop to `LineForm`.
- [ ] Call `onPreview` whenever a field changes.
- [ ] Keep `Save as draft` patch comparison against `originalLine`.
- [ ] Do not refetch editor quest immediately after saving a draft, so local preview remains visible.

### Task 4: Verification

**Files:**
- Modify: `web/src/__manual__/editor-flow.md`

- [ ] Update DnD checklist to confirm immediate preview first, then save draft creation.
- [ ] Run `rtk npm run build`.
