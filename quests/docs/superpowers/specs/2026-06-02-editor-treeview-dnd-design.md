# Editor TreeView Drag/Drop — Design

**Date:** 2026-06-02
**Status:** Approved
**Scope:** Improve `/editor/:qid` left pane by replacing the flat line list with a flow/state/line TreeView and safe drag/drop reorder controls.

## Goals

- Make long quest dialogue easier to navigate by preserving the source hierarchy: flow list name, state, then lines.
- Keep the editor form and draft approval workflow unchanged.
- Support drag/drop for lines, states, and flows where the operation can be represented by existing line reorder drafts.
- Improve the editor layout so the left pane feels like a navigation surface instead of a cramped debug list.

## Non-Goals

- Do not add persisted flow or state entities to the backend.
- Do not rename `state_key` when moving a state under another flow.
- Do not allow semantically invalid hierarchy drops such as dropping a flow inside a state.
- Do not add a new drag/drop dependency unless native browser APIs are insufficient.

## UX

The left pane becomes a TreeView:

- Top controls show line count plus `expand all` and `collapse all`.
- First level: flow list name.
- Second level: state label derived from `state_key`, with plot mode badge when not `Normal`.
- Third level: line leaf with `#id`, type, speaker, text preview, `edited`, and pending-draft badges.
- Selecting a line still sets `selectedId` and loads the existing `LineForm` on the right.
- Selecting a line auto-expands its parent flow and state.
- The old `up`, `down`, and `insert` fallback controls are removed from line leaves; drag/drop is the structure-editing UI.
- Invalid or unparsable `state_key` lines appear under `Ungrouped`.

## Drag/Drop Rules

Safe first implementation means drag/drop is order-only:

- Drag line before/after another line.
- Drag state before/after another state, or into a flow, by moving every line in the state as one block.
- Drag flow before/after another flow by moving every line in the flow as one block.
- Preserve every moved line's current `state_key`.
- Convert accepted drops into existing `_op: "reorder"` drafts with `position_after` anchors.
- Reject invalid drops:
  - flow into state
  - flow into line
  - state into line
  - dropping any node into itself or its own descendants
  - dropping before/after a member of the same moved block when it would be a no-op

## Data Flow

- `EditorPage` already fetches full quest data through `api.editorQuest(qid)` and line summaries through `api.editorQuestLines(qid)`.
- Build TreeView data client-side from `quest.all_lines` and `quest.flows`.
- Parse state keys with the same regex used by `QuestPage`: `/^(.*)_(\d+)_(\d+)$/`.
- Use `quest.flows[].states[]` to resolve plot mode per `state_key`.
- Merge summary metadata by line id for `is_edited`; use existing `pendingCounts` for pending draft badges.
- For drag/drop persistence, `EditorPage` exposes a block reorder handler. It creates one draft per moved line using the existing `api.createDraft` endpoint.

## Testing

- Run `rtk npm run build` from repo root.
- Manually verify `/editor/106000002`:
  - TreeView renders grouped by flow and state.
  - Expand/collapse works.
  - Selecting a line loads the form.
  - `edited` and pending badges remain visible.
  - Line drag/drop creates reorder draft(s).
  - State drag/drop creates reorder drafts for all state lines.
  - Flow drag/drop creates reorder drafts for all flow lines.
  - Invalid hierarchy drops are ignored.
