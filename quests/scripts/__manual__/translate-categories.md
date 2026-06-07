# Manual Acceptance Checklist -- translate_id --mode categories

Run each step and tick the box. Steps with mock servers (steps 1, 2) are
fast; steps with a real `llama-server` (steps 3-6) take minutes.

## Setup

- [ ] Real `llama-server` running on `localhost:8080` with Gemma 4 12B
      (or your preferred model) loaded.
- [ ] `data/glossary.json` exists (copy of `WuwaID/glossary_draft.json`).
- [ ] `data/quests/*.json` populated (run `bun run build:index` if not).
- [ ] `data/categories/*.json` populated (87 files; copied by `build_index.py`).

## Step 1: Translate one small category

- [ ] Run: `uv run python scripts/translate_id.py --mode categories --category Advice --verbose`
- [ ] Open `data/categories_id/Advice.json` and verify each entry has
      a non-empty `id` field with Indonesian text.
- [ ] Verify: glossary terms (e.g., character names) appear unchanged
      in the `id` field.

## Step 2: Re-run idempotency

- [ ] Re-run the same command from Step 1.
- [ ] Verify: no new LLM calls (output `keys_translated: 0`,
      `keys_from_memory: N` for N keys in Advice.json).
- [ ] Verify: the file's content is byte-identical to the previous run
      (use `git diff` if file is tracked, or `md5sum`).

## Step 3: Sweep small categories

- [ ] Run: `uv run python scripts/translate_id.py --mode categories --all --limit 5`
- [ ] Verify: 5 smallest categories translated.
- [ ] Verify: `data/categories_id/` has 5 new files.

## Step 4: Viewer integration

- [ ] Run: `bun run dev` (starts Vite on :5173 and FastAPI on :8000).
- [ ] Open `http://localhost:5173/categories` in a browser.
- [ ] Verify: all 87 categories are listed with translation progress bars.
- [ ] Click a translated category.
- [ ] Verify: the `ID` column appears and is populated with Indonesian text.
- [ ] Verify: the `ID` column shows `—` for keys not yet translated (if
      the file is only partially translated).
- [ ] Use the filter box to find a key by English or Indonesian text.

## Step 5: Search integration

- [ ] Open `http://localhost:5173/search?q=Glacio&lang=id&scope=category`
- [ ] Verify: search results include the Indonesian text for `Glacio`
      (or the English form if Indonesian translation isn't done yet).
- [ ] Compare with `scope=quest` to confirm the two FTS5 tables are
      independent.

## Step 6: Memory migration (if upgrading from v1)

- [ ] Verify `data/quests_id/_memory.json` exists (from a prior v1 run).
- [ ] Run any categories or quest command: `uv run python scripts/translate_id.py --mode categories --category Advice`.
- [ ] Verify log output includes: `Migrated translation memory: data/quests_id/_memory.json -> data/_translation_memory.json (N entries)`.
- [ ] Verify `data/quests_id/_memory.json` no longer exists.
- [ ] Verify `data/_translation_memory.json` exists with the entries.

## Step 7: Editor-table preservation (after `build_index.py`)

- [ ] Pre-populate some editor data (e.g., apply a test edit on
      `data/quests/<qid>.json`).
- [ ] Run: `uv run python scripts/build_index.py`.
- [ ] Verify: editor tables (`edits`, `inserted_lines`, `line_order`,
      `drafts`, `editor_session`) are preserved in `data/index.db`.
- [ ] Verify: new `category_text_idx` and `categories` tables exist in
      `data/index.db`.

## Sign-off

- [ ] All steps above pass.
- [ ] No regressions in existing quest translation (run
      `uv run python scripts/translate_id.py --chapter 1 --limit 3`
      to spot-check).
