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

## Editor keyboard shortcuts

- [ ] In the META tab, focus the Quick Move "target line" input and type `#12345`. All digits appear; the active tab does not change.
- [ ] In the META tab, focus the Quick Move "target state" input and type `#119000000.1`. All characters appear; the active tab does not change.
- [ ] In any input, press `1`/`2`/`3`/`4`/`[`/`]` — the character is entered and the active tab does not change.
- [ ] Click a line in the tree (it gets highlighted), then expand or collapse a different state. The viewport stays where the user moved it; the highlighted row does not pull the view back.
- [ ] Click a line that is off-screen at the bottom of the tree. The row scrolls smoothly into the center of the viewport with equal space above and below (preview text fully visible).
- [ ] Click a line that is off-screen at the top of the tree. The row scrolls smoothly into the center of the viewport with equal space above and below.
- [ ] Click a line that is already fully visible. The viewport does not jump.
- [ ] Tree states display as `state 1.1 [1]`, `state 1.2 [2]`, etc. — no `#` prefix, bracket is 1-based within the flow.
- [ ] Reorder two states in the tree. The `[N]` bracket updates to reflect the new position.
- [ ] In the META tab, the `Move entire State` label shows `1.1` (no `#`).
- [ ] In the META tab, type `[2]` into the target state input and click Before/After. The state moves to the [2] position of the same flow.
- [ ] Use the tree `#id / state` jump input to jump to a state. The toast reads `Jumped to state 1.2` (no `#`).

## Edge cases

- [ ] Try to approve a draft whose target line was deleted by an earlier approval — should get 409.
- [ ] Try to save a draft with `options[].plot_line_key` set to a non-existent line — approval should fail with 422.
- [ ] Open `/editor/<qid>` in two tabs. Edit the same line in both. Save both drafts. Editor approves one, then the other. Second approval should fail (line may have moved).
- [ ] Log out via `/drafts`. Try to approve another draft - should be 401.

## Tree readability pass

- [ ] Talk / Option / CenterText / PhoneMessage / NoTextItem / SystemOption rows each render with a different type tag color and left rail color
- [ ] Plot_mode `BlackScreen` and `LevelA..F` lines render with the `CINE` overlay (slate rail, slate tag) instead of the type tag
- [ ] Flow rows show the filled `FLOW` chip + teal gradient rail
- [ ] State rows show the outlined `STATE` chip + gold gradient rail + `state X.Y [N]` + meta
- [ ] Line rows: speaker is `font-sans` (not mono); preview line is italic + slate-500 + indented
- [ ] EDITED / N DRAFTS / N opts pills render in the unified style; with 3 statuses, show `+N` overflow
- [ ] Drag a line before another: 6px gradient bar + glow + target row fades and shifts
- [ ] Drag a state into another flow: target row gets teal-tinted bg + `↳ inside` hint
- [ ] Drag a flow into a state: drop is ignored, no highlight
- [ ] After this round, all 12+ previously-passing checks in `editor-flow.md` (drag/drop, scroll, jump-to, state numbering) still pass

## Urut review marker

- [ ] Click the circle toggle on a line row. The row gets emerald bg + border; the icon becomes a filled checkmark
- [ ] Click the filled checkmark again. The emerald bg + border disappear; the icon returns to an empty circle
- [ ] Mark a state row. The state row gets emerald bg + border; its inner line rows are not auto-marked
- [ ] Mark a flow row. The flow row gets emerald bg + border
- [ ] Refresh the browser. All previously-marked rows are still marked (persisted via localStorage)
- [ ] Mark a row, then drag it before/after another row. The marker stays on the dragged row after the drop
- [ ] Mark a row, then drag another row over it (inside). The teal-tinted inside drop indicator overrides the emerald bg while dragging; emerald returns after drop

## Regression: viewer

- [ ] `/quests/106000002` shows approved edits to text/speaker.
- [ ] `/search?q=<text from approved edit>` finds the line.
- [ ] Chapter pages and side-quest pages still render.
