# Editor TreeView Drag/Drop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the editor flat left-pane list with a flow/state/line TreeView that supports safe drag/drop reorder drafts.

**Architecture:** Build tree data client-side from `Quest.all_lines` and `Quest.flows`. Keep the backend unchanged by converting valid drag/drop operations into existing line reorder drafts using `position_after`.

**Tech Stack:** React 18, TypeScript, Tailwind CSS, TanStack Query, native HTML drag/drop APIs.

---

## File Structure

- Create `web/src/components/editor/DialogueTreeView.tsx`: TreeView rendering, expand/collapse state, and native drag/drop event handling.
- Modify `web/src/routes/EditorPage.tsx`: build grouped tree data, wire block reorder mutations, replace `LineList` with `DialogueTreeView`, improve responsive layout.
- Modify `web/src/lib/types.ts`: add small TreeView and drag/drop types if needed by multiple files.
- Modify `web/src/__manual__/editor-flow.md`: update expected manual verification for TreeView and drag/drop.

## Tasks

### Task 1: Add TreeView Types and Component

**Files:**
- Create: `web/src/components/editor/DialogueTreeView.tsx`
- Modify: `web/src/lib/types.ts`

- [ ] Add `TreeNodeKind`, `TreeDropPosition`, and `DialogueTreeNode` types.
- [ ] Implement `DialogueTreeView` props: tree nodes, selected id, pending counts, select handler, and block move handler.
- [ ] Render flow/state disclosure rows and line leaves.
- [ ] Add native drag/drop attributes and event handlers.
- [ ] Prevent invalid hierarchy drops.

### Task 2: Wire TreeView in EditorPage

**Files:**
- Modify: `web/src/routes/EditorPage.tsx`

- [ ] Import `useMemo` and `DialogueTreeView`.
- [ ] Build plot mode map from `quest.flows[].states[]`.
- [ ] Group `quest.all_lines` into `flow -> state -> line` nodes using state key regex.
- [ ] Merge `LineSummary.is_edited` data by line id.
- [ ] Implement `moveBlock(lineIds, targetLineId, position)` using existing `structureQ.mutate`.
- [ ] Replace `LineList` with `DialogueTreeView`.
- [ ] Improve editor grid to stack on small screens and widen left pane on large screens.

### Task 3: Manual Checklist and Build

**Files:**
- Modify: `web/src/__manual__/editor-flow.md`

- [ ] Update left-pane checklist from flat list to TreeView.
- [ ] Add drag/drop verification items for line, state, flow, and invalid drops.
- [ ] Run `rtk npm run build` from repo root.
- [ ] Fix TypeScript/build failures.

## Self-Review

- Spec coverage: TreeView, expand/collapse, badges, selection, native drag/drop, safe reorder-only semantics, no backend schema changes, responsive layout, and manual verification are covered.
- Placeholder scan: no TBD/TODO placeholders remain.
- Type consistency: component and type names match planned files.
