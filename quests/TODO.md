# TODO

Deferred work for the Wuthering Waves Indonesian translation effort. Items
here are intentionally **out of scope** for the v1 standalone tool (see
[`docs/superpowers/specs/2026-06-07-translate-id-design.md`](docs/superpowers/specs/2026-06-07-translate-id-design.md))
and tracked here so they don't get lost.

Each item gets its own spec → plan → implementation cycle when picked up.

## v1 dependencies (must be done first)

- [x] **v1 standalone MT tool** — `scripts/translate_id.py`. The foundation
      everything below depends on. Spec:
      [`docs/superpowers/specs/2026-06-07-translate-id-design.md`](docs/superpowers/specs/2026-06-07-translate-id-design.md).
      Includes **translation memory** (`text_key` cache) — the
      `text_key → text_id` map is built from existing per-quest outputs
      at startup and consulted before each LLM call, so duplicate
      dialogue across quests is translated only once. See spec
      §Translation memory.
- [x] **Translation MCP Server** — `scripts/mcp_server.py`. Exposes the translation pipeline
      as Model Context Protocol tools for AI agents to translate dialogue/quests, and
      read/write glossary entries.

## Viewer integration

- [x] **Indonesian as 4th language in the web UI** — done 2026-06-07.
      Spec: `docs/superpowers/specs/2026-06-07-viewer-id-integration-design.md`.
      Plan: `docs/superpowers/plans/2026-06-07-viewer-id-integration.md`.
  - Add `"id"` to the `Lang` union in `web/src/lib/types.ts`
  - Add `text_id` / `speaker_id` fields to `DialogueLine`, `QuestFlowState`,
    and `DialogueLineOption` interfaces
  - Extend `LangSwitcher.tsx` with an ID option
  - Extend `LangTabs.tsx` and the `LineForm` / `OptionsSubform` / `DiffField`
    components to render the new field
  - Add a FastAPI route to serve `data/quests_id/<qid>.json` and merge
    Indonesian text into the existing quest payload
  - FTS5 index update: include `text_id` for searchability in Indonesian
  - **No** data migration needed for existing `data/quests/*.json` — Indonesian
    is a parallel read.

## Content scope expansion

- [x] **Categories translation** — done 2026-06-07.
      Spec: `docs/superpowers/specs/2026-06-07-content-scope-expansion-design.md`.
      Plan: `docs/superpowers/plans/2026-06-07-content-scope-expansion.md`.
      Pipeline: `--mode categories` on `translate_id.py`. 158,336 keys across
      87 category files translate via prefix-grouped chunks of 50 keys/LLM
      call. Output goes to `data/categories_id/<Cat>.json` with an `id`
      field added per key. Shared `data/_translation_memory.json` cache.
- [x] **UI / menu / option text** — covered by the same categories
      pipeline (`UI.json`, `ConfirmBox.json`, `ErrorCode.json`,
      `Message.json`, etc., all live in `data/categories/` and translate
      through the same `--mode categories` flow).
- [ ] **Speakers translation** — REMOVED. `data/speakers.json` is metadata
      (count list of speaker names), not translatable text. Speaker names
      themselves are proper nouns covered by the glossary (2,750
      Speaker/NPC terms with `indonesian_translation` defaulted to English).

## Quality and reuse

- [ ] **Glossary auto-build from approved editor translations** — when
      editors approve a draft, harvest the human-chosen Indonesian for
      proper nouns and append to `data/glossary.json` automatically. Locks
      in consistency over time.
- [ ] **Quality scoring / spot-check tooling** — sample N random lines
      per quest, render side-by-side EN ↔ ID for human review, log to a
      report. Could be a CLI flag (`--spot-check 20`) or a separate script.
- [ ] **Per-line editor review of MT output** — push machine translations
      into the existing `drafts` table (status `pending`, author label
      `mt-llama-cpp`) so editors can review/approve them just like human
      drafts. Avoids the LLM being the final word.

## Tooling extensibility

- [x] **Multi-model support** — `client.py` natively supports standard OpenAI-compatible
      cloud APIs (OpenAI, OpenRouter, etc.) via custom base URL, model name, API key,
      and headers. A formal provider interface refactoring was skipped since the single
      OpenAI-compatible client already covers most backends.
- [ ] **Configurable prompt templates** — let users override the system
      prompt, user prompt template, and model parameters via a YAML or
      TOML config file. Useful for A/B testing different phrasings.
- [ ] **JSON-mode / structured output** — when the model server supports
      `response_format: {type: "json_object"}`, use it to reduce parse
      failures. Currently we rely on prompt-based JSON enforcement.
- [ ] **Per-quest concurrency** — currently each quest is processed
      sequentially with internal state-level concurrency. For multi-GPU
      setups, run N quests in parallel. Optional, low priority.

## Data layer improvements

- [ ] **Game update reindex flow** — the `scripts/build_index.py` rebuild
      from the WuwaID exporter. After it runs, the MT tool should be
      able to identify which quests changed and re-translate only those.
      Currently the tool processes the full set.
- [ ] **Translator attribution** — when an MT line is later edited by a
      human, record which model produced the original translation. Lets
      us compare model quality over time.

## Documentation

- [ ] **Prompt-engineering guide** — write up which system-prompt rules
      matter most (e.g., "the markup token rule saves dozens of parse
      errors per quest"). Helps the next person tuning the prompt.
- [ ] **Glossary curation guide** — how to add a new term, which
      `category` to pick, when to set a custom `indonesian_translation`.
