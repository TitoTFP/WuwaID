# Editor mode — manual verification checklist

Run `bun run dev`, then walk through this list. Each step should match the expected outcome.

## Anonymous draft flow

- [ ] Open `/quests/106000002`. "Edit" link is visible in the header.
- [ ] Click "Edit". Lands on `/editor/106000002`. Left pane shows a Flow → State → Line TreeView.
- [ ] Use "collapse" and "expand" in the TreeView. Groups close and reopen without losing selection.
- [ ] Type a speaker name, text fragment, and line id in the local search box. TreeView filters to matching lines.
- [ ] Click "clear" in local search. Full TreeView returns.
- [ ] Click a line. Right pane shows per-lang tabs (EN | ZH-HANS | JA | META).
- [ ] Edit `text_en` on a Talk line. The right pane and TreeView preview update immediately before saving.
- [ ] Click "Discard" and confirm. The local preview for that line returns to the server-loaded value.
- [ ] Edit `text_en` again on a Talk line. "edited" pill appears next to the field.
- [ ] Click "Save as draft". The line in the left pane now shows "✎1".
- [ ] Open `/drafts`. Your draft is listed.
- [ ] Click the row. Side-by-side preview renders.
- [ ] Refresh `/quests/106000002`. The text is unchanged (draft is pending, not applied).

## Editor approval flow

- [ ] Set `EDITOR_PASSWORD=dev` in `.env`, restart server.
- [ ] Log in at `/login`. Cookie is set. `/api/me` returns `{"role":"editor"}`.
- [ ] Open `/drafts`. All pending drafts (including your own) are visible.
- [ ] Click a row. Side-by-side view shows original vs draft.
- [ ] Click "✓ Approve". Draft disappears from the queue.
- [ ] Refresh `/quests/<qid>`. The text is now updated.
- [ ] Open `/editor/<qid>`. The left pane shows "edited" badge for the line.

## TreeView drag/drop

- [ ] Drag one line before/after another line. TreeView order updates immediately and an unsaved preview banner appears.
- [ ] Click "Reset preview". TreeView returns to the server-loaded order.
- [ ] Drag a state before/after another state. The state lines move immediately as a block.
- [ ] Drag a state into another flow. The state lines move immediately as a block; existing `state_key` values are preserved.
- [ ] Drag a flow before/after another flow. The flow lines move immediately as a block.
- [ ] Click "Save reorder drafts". Reorder drafts are created and pending badges/banner update.
- [ ] Try to drop a flow into a state. Drop is ignored.
- [ ] Type in local search, then try dragging. Reordering is disabled until search is cleared.
- [ ] After selecting a nested line, collapse all then refresh/select it again. Its parent flow/state auto-expands.

## Edge cases

- [ ] Try to approve a draft whose target line was deleted by an earlier approval — should get 409.
- [ ] Try to save a draft with `options[].plot_line_key` set to a non-existent line — approval should fail with 422.
- [ ] Open `/editor/<qid>` in two tabs. Edit the same line in both. Save both drafts. Editor approves one, then the other. Second approval should fail (line may have moved).
- [ ] Log out via `/drafts`. Try to approve another draft - should be 401.

## Regression: viewer

- [ ] `/quests/106000002` shows approved edits to text/speaker.
- [ ] `/search?q=<text from approved edit>` finds the line.
- [ ] Chapter pages and side-quest pages still render.
