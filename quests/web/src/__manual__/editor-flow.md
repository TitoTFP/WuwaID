# Editor mode — manual verification checklist

Run `bun run dev`, then walk through this list. Each step should match the expected outcome.

## Anonymous draft flow

- [ ] Open `/quests/106000002`. "Edit" link is visible in the header.
- [ ] Click "Edit". Lands on `/editor/106000002`. Left pane lists all lines.
- [ ] Click a line. Right pane shows per-lang tabs (EN | ZH-HANS | JA | META).
- [ ] Edit `text_en` on a Talk line. "edited" pill appears next to the field.
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

## Edge cases

- [ ] Try to approve a draft whose target line was deleted by an earlier approval — should get 409.
- [ ] Try to save a draft with `options[].plot_line_key` set to a non-existent line — approval should fail with 422.
- [ ] Open `/editor/<qid>` in two tabs. Edit the same line in both. Save both drafts. Editor approves one, then the other. Second approval should fail (line may have moved).
- [ ] Log out via `/drafts`. Try to approve another draft - should be 401.

## Regression: viewer

- [ ] `/quests/106000002` shows approved edits to text/speaker.
- [ ] `/search?q=<text from approved edit>` finds the line.
- [ ] Chapter pages and side-quest pages still render.
