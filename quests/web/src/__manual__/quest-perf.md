# Quest Page Performance — Manual Regression

After running `bun run dev`, hit `http://localhost:5173/quests/{qid}` for each
of these and tick the boxes. Browser DevTools → Network tab open.

## Quest 1 (45,292 lines, "测试文本")

- [ ] **Blank-screen smoke: opening `/quests/1` shows the dialog list rendered
      in the scroll area, not a blank/black region.** This catches the
      "FixedSizeList with a function `itemSize`" regression class — see the
      2026-06-07 incident. Always run this for any change touching
      `QuestPage.tsx` or `react-window`.
- [ ] Open `/quests/1` cold — initial render < 2s, browser responsive
- [ ] Network tab: response `/api/quests/1` < 12MB (gzipped) and < 1.5s
- [ ] Network tab: response has `content-encoding: gzip`
- [ ] Network tab: response does NOT contain `"flows":[` (stripped)
- [ ] Response does include `"plot_mode_by_state":{`
- [ ] Scroll to bottom — no jank, ~60fps
- [ ] Open `/quests/1#L5000` — page loads and scrolls to line 5000, line
      highlighted (gold background fades after 3s)
- [ ] Open `/quests/1?q=Encore` — search highlights still work
- [ ] Click any "→ leads to #N" button — jumps to target line
- [ ] State headers (flow · state X) visible between groups
- [ ] Plot mode chips (WavesLine, fade, chapter) visible when applicable
- [ ] Edit link → editor loads

## Normal side quest (e.g. `/quests/121850001`, 1097 lines)

- [ ] Open — initial render < 500ms
- [ ] No regression on language switcher (top-right)
- [ ] "Edit" link → editor loads

## Main quest (`/quests/158800019`, 1195 lines)

- [ ] Open — works, no regression
- [ ] Chapter link back works

## Editor (`/editor/1`)

- [ ] Open — quest loads (large but doesn't freeze; ~3-5s OK for 45k lines)
- [ ] Click a line in tree — selectedLine populates fast
- [ ] Backlinks panel shows for lines with options
- [ ] `jumpToLine` keyboard shortcut works (e.g. "119000000.1" or "#5000")
- [ ] Reorder / move-block still works
- [ ] Move-to-state input works (e.g. `[2]` for 2nd state in current flow)

## Build & typecheck

- [ ] `cd web && tsc --noEmit` exits 0 (this is the one that catches the
      `react-window` list-type mistakes; the root `tsc` doesn't compile
      anything because there's no root tsconfig.json)
- [ ] `bun run build` exits 0 (now runs `tsc --noEmit` before `vite build`,
      so a type error will block the bundle)
- [ ] `uv run pytest app/ -v` all pass (52 tests)

## How to test gzip manually

```sh
curl -H "Accept-Encoding: gzip" -i http://127.0.0.1:8000/api/quests/1 | head
# Expect: HTTP/1.1 200 OK
#         content-encoding: gzip
#         content-length: ~15000000 (15MB, vs 66MB without gzip+strip)
```

## How to test cache manually

Open `/quests/1` twice in a row. The second load should not re-read the JSON
file from disk. You can verify by adding a `print("loaded quest", qid)` inside
`_load_quest_cached` and checking it only fires once.
