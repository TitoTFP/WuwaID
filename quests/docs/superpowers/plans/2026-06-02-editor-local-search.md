# Editor Local Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add local current-quest dialogue search to the editor TreeView.

**Architecture:** Keep search client-side over already loaded `quest.all_lines`. Filter TreeView leaves while preserving matching flow/state parents, expand matching groups, and select matched lines without backend changes.

**Tech Stack:** React 18, TypeScript, Tailwind CSS.

---

## File Structure

- Modify `web/src/routes/EditorPage.tsx`: own search query state, filter tree data before rendering, pass query metadata to TreeView.
- Modify `web/src/components/editor/DialogueTreeView.tsx`: render search input, count, clear button, empty state, and text highlights.
- Modify `web/src/__manual__/editor-flow.md`: add local search verification.

## Tasks

### Task 1: Tree Filtering

**Files:**
- Modify: `web/src/routes/EditorPage.tsx`

- [ ] Add `searchQ` state.
- [ ] Add helper that matches id, type, state key, speaker, and all three text languages.
- [ ] Add helper that recursively filters flow/state nodes to matching line leaves.
- [ ] Pass filtered tree and raw match count to `DialogueTreeView`.

### Task 2: Search UI

**Files:**
- Modify: `web/src/components/editor/DialogueTreeView.tsx`

- [ ] Add search props.
- [ ] Render input above TreeView controls.
- [ ] Highlight matched fragments in line text and speaker.
- [ ] Show empty state when query has no matches.
- [ ] Auto-expand groups when search is active.

### Task 3: Verification

**Files:**
- Modify: `web/src/__manual__/editor-flow.md`

- [ ] Add checklist entries for search by speaker, text, id, and clear.
- [ ] Run `rtk npm run build`.
