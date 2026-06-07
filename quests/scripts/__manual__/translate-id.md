# Manual regression checklist — translate_id.py

Run after any non-trivial change. Each box is one verification.

**Setup:**
- [ ] `data/quests/<qid>.json` exists for a small main-story quest (~50 lines).
- [ ] `data/glossary.json` exists (copy of `WuwaID/glossary_draft.json`).
- [ ] `llama-server` running on `http://localhost:8080` with a Gemma 4 12B model loaded (or compatible).
- [ ] No `data/quests_id/_memory.json` (or delete it for a clean run).

**Single quest end-to-end:**
- [ ] `uv run python scripts/translate_id.py <qid> --verbose` runs without errors.
- [ ] Log line `Concurrency=N (server=..., ...)` shows detected slot count (if `--np auto`).
- [ ] `data/quests_id/<qid>.json` is created with the expected structure.
- [ ] All `lines[]` have `text_id` non-empty and `flags=[]` for clean lines.
- [ ] All `lines[]` have `text_key` matching the source.
- [ ] No `<|channel|>` or `<|think|>` tags leaked into `text_id` (thinking mode parsed correctly).

**Idempotency:**
- [ ] Re-run the same command; output file is unchanged (`diff` is empty).
- [ ] `_memory.json` is created on first run and contains N entries.

**Translation memory:**
- [ ] Translate a different quest that shares `text_key`s with the first.
- [ ] Second quest's shared lines have `from_memory: true` in the output.
- [ ] Second quest's `_memory.json` has more entries than after the first run.
- [ ] `--no-cache` flag: re-run second quest; output still has `from_memory: true` for shared lines (no LLM call made for them). `_memory.json` is NOT modified by the run.

**Reset memory:**
- [ ] `uv run python scripts/translate_id.py <qid> --reset-memory` deletes `_memory.json` first; new run rebuilds it.

**Corrupt memory recovery:**
- [ ] Hand-write garbage into `_memory.json` (`echo "not json" > _memory.json`).
- [ ] Run the tool; it logs the corruption, backs up the file as `.corrupt-<ts>`, and starts fresh.
- [ ] The tool completes successfully (no crash).

**Chapter priority:**
- [ ] `uv run python scripts/translate_id.py --dry-run --all` prints quests in order ch 1 → 2 → 3 → side.
- [ ] `uv run python scripts/translate_id.py --chapter 1` translates only chapter 1 quests.

**Glossary enforcement:**
- [ ] Pick a quest with `text_en` containing "Rover" (character name).
- [ ] Verify the Indonesian translation still contains "Rover" (not "Pengembara" or similar).
- [ ] If LLM over-translated and the retry still failed, the line has `flags: ["glossary_violation"]`.

**Resume after crash:**
- [ ] Start a long run (chapter 1).
- [ ] Kill the process (Ctrl-C) mid-way.
- [ ] Re-run the same command; only the unfinished states are translated.

**--force:**
- [ ] `uv run python scripts/translate_id.py <qid> --force` re-translates even if `data/quests_id/<qid>.json` already exists.

**Spot-check quality:**
- [ ] Open 5 random translated lines in a text editor.
- [ ] Indonesian reads naturally.
- [ ] All glossary terms (character names, place names, skill names) are in English.
- [ ] No obvious markup-token loss (e.g. `{PlayerName}` still present).
