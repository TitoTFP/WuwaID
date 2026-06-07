# TODO

Deferred work for the Wuthering Waves Indonesian translation effort. Items
here are intentionally **out of scope** for the v1 standalone tool (see
[`docs/superpowers/specs/2026-06-07-translate-id-design.md`](docs/superpowers/specs/2026-06-07-translate-id-design.md))
and tracked here so they don't get lost.

Each item gets its own spec → plan → implementation cycle when picked up.

## v1 dependencies (must be done first)

- [ ] **v1 standalone MT tool** — `scripts/translate_id.py`. The foundation
      everything below depends on. Spec:
      [`docs/superpowers/specs/2026-06-07-translate-id-design.md`](docs/superpowers/specs/2026-06-07-translate-id-design.md).

## Viewer integration (highest priority follow-up)

- [ ] **Indonesian as 4th language in the web UI**
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

- [ ] **Categories translation** — `data/categories/*.json` (87 files). Same
      per-line, per-state-style pipeline but the input format is a flat
      list of `{key, en, zh-Hans, ja}` objects. Smaller, faster, but
      still benefits from the same glossary.
- [ ] **Speakers translation** — `data/speakers.json` (counters of speaker
      names). Often a no-op (most names are proper nouns kept in English),
      but the tool should support it.
- [ ] **UI / menu / option text** — `data/categories/UI.json`,
      `ConfirmBox.json`, `ErrorCode.json`, `Message.json`, etc. Most of
      this is short and high-volume; may need its own batching strategy.

## Quality and reuse

- [ ] **Translation memory** — when re-translating after a game update, many
      lines are unchanged. Hash the source `text_en` + `speaker_en` and
      reuse the previous Indonesian output if available. Could save
      significant LLM calls.
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

- [ ] **Multi-model support** — refactor `client.py` to an interface
      with providers for `llama-cpp` (default), OpenAI, Anthropic, etc.
      Same prompt + glossary code, swappable backend.
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
