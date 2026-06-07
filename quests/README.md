# wuwaid-quests

Web viewer for Wuthering Waves quest dialogue exported by
[`WuwaID/export_text_grouped.py`](../WuwaID).

- **Frontend**: React 18 + Vite + TypeScript + Tailwind
- **Backend**: FastAPI + SQLite FTS5 (search)
- **Data pipeline**: Python script copies dialogue JSON from WuwaID and builds a
  full-text search index
- **Runner**: Bun

## Layout

```
wuwaid-quests/
├── scripts/
│   ├── build_index.py       # rebuilds data/ from ../WuwaID/export_text_grouped/export_quest_ordered
│   ├── dev-check.js         # fails fast if :5173/:8000 busy
│   └── serve-check.js       # fails fast if :8000 busy
├── app/                     # FastAPI backend
│   ├── *.py                 # routes, db, auth
│   └── test_*.py            # pytest suite
├── web/                     # Vite + React frontend
│   └── src/
│       ├── components/editor/  # LineForm, DialogueTreeView, DiffField, ...
│       ├── routes/             # QuestPage, EditorPage, DraftsPage, ...
│       └── __manual__/         # manual verification checklists
├── docs/superpowers/        # design specs + implementation plans
└── data/                    # generated, gitignored
    ├── chapters.json
    ├── index.db             # FTS5 + editor state
    └── quests/              # copy of dialogue.json files
```

## Setup

```sh
bun install
uv sync                                     # or: pip install -e .
uv run python scripts/build_index.py        # copies data + builds FTS5
```

## Develop

```sh
bun run dev
# Vite on :5173, FastAPI on :8000, Vite proxies /api → :8000
```

`bun run dev` runs both servers concurrently with hot-reload. Edit any
`.tsx`/`.css` in `web/src/` → Vite HMR; edit any `.py` in `app/` →
uvicorn `--reload` picks it up. Use this while building.

## Build + serve (prod-style local)

```sh
bun run build         # vite build → web/dist/
bun run serve         # uvicorn serves web/dist + /api
# open http://localhost:8000
```

`bun run build` produces a static bundle in `web/dist/`. `bun run serve`
mounts that bundle and exposes `/api/*` on a single port (`:8000`).
This is the closest local equivalent to a production deploy — use it to
verify the build before pushing, or to share on your LAN.

## Which command when?

| You're doing… | Run this |
|---|---|
| Editing React/components/CSS | `bun run dev` |
| Editing FastAPI/Python | `bun run dev` (uvicorn auto-reloads) |
| Verifying the production bundle | `bun run build && bun run serve` |
| Sharing on LAN with a finished build | `bun run build && bun run serve` |
| Reindexing quest data after game update | `bun run build:index` |
| Running backend tests | `uv run pytest` |
| Manual editor walkthrough | follow `web/src/__manual__/editor-flow.md` |

## Reindexing after game updates

`bun run build:index` rebuilds generated quest JSON and the FTS index from the
latest WuwaID export. Editor-owned data in `data/index.db` is preserved across
the rebuild:

- approved field edits (`edits`)
- inserted lines (`inserted_lines`)
- approved reorder operations (`line_order`)
- pending/review drafts (`drafts`)

Rows targeting quests or line ids that no longer exist in the updated game data
are skipped as stale. The command prints how many editor rows were restored or
skipped.

## Translating to Indonesian (machine translation)

The tool under `scripts/translate_id.py` translates `data/quests/*.json` to
Indonesian using a local `llama-server`. Output goes to `data/quests_id/`.

Default settings target `unsloth/gemma-4-12B-it-qat-GGUF` with the model's
recommended sampling (`temperature=1.0, top_p=0.95, top_k=64`) and
Gemma 4 thinking mode enabled.

Setup (one time):

```sh
# 1. Make sure data/quests/ is populated (see "Reindexing" above).
# 2. Copy the glossary draft into the data dir.
cp ../WuwaID/glossary_draft.json data/glossary.json
# 3. Start a llama-server on http://localhost:8080.
#    Example for Gemma 4 12B (Q4_K_XL, 30 GPU layers, 64K context, 1 slot):
llama-server \
  -m ~/.models/gemma-4-12B-it-qat-UD-Q4_K_XL.gguf \
  -ngl 30 -c 65536 -np 1 -fa \
  -ctk q8_0 -ctv q8_0 \
  --host 127.0.0.1 --port 8080
```

Run on one quest:

```sh
uv run python scripts/translate_id.py 119000000
```

Sweep all 940 quests in chapter-priority order (ch 1 → 2 → 3 → side):

```sh
uv run python scripts/translate_id.py --all
```

Translate one chapter:

```sh
uv run python scripts/translate_id.py --chapter 1
```

Useful flags:

| Flag | Effect |
|---|---|
| `--dry-run` | Print the quest order; no LLM calls |
| `--verbose` | Per-state timing + retry info |
| `--no-cache` | Bypass translation-memory cache; force LLM for every line |
| `--reset-memory` | Wipe `data/quests_id/_memory.json` before starting |
| `--force` | Re-translate even if output already exists |
| `--limit N` | Translate only first N states (testing) |
| `--state-key KEY` | Translate only one state within the quest (testing) |
| `--np N\|auto` | Parallel requests (default `auto`: queries llama-server `/slots` to get slot count) |
| `--temperature F` | Sampling temperature (default 1.0, matches Gemma 4 model card) |
| `--max-tokens N` | Max response tokens (default 32768; matches the 32K context window) |
| `--top-p F` | Nucleus sampling (default 0.95, matches model card) |
| `--top-k N` | Top-k sampling (default 64, matches model card) |
| `--timeout F` | HTTP request timeout in seconds (default 300s) |
| `--enable-thinking` / `--no-enable-thinking` | Enable Gemma 4 thinking mode via `<|think|>` token (default ON). Parser extracts the final-answer channel automatically. |
| `--no-progress` | Disable the tqdm progress bar (default: bar shown). Useful for log files / CI. |
| `--flush-every N` | Flush `<qid>.json` + `_memory.json` after every N states in a quest (default 0 = end-of-quest only). Set to 1 for crash-safe, real-time progress. |

Progress bar shows two levels: outer = quests done, inner = states within current quest.
Per-state log line includes `prompt=X completion=Y reasoning=Z` token counts.

Final summary includes total prompt/completion tokens, % from memory, and the
single state with the highest token usage (for spotting overly-long states).

## Editor mode

The `/editor/:qid` route lets visitors propose corrections without an account
(anonymous drafts). Editors log in via `/login` to approve drafts at `/drafts`.
Editor state lives in `data/index.db` alongside the FTS index.

Set the editor password in a local `.env` (gitignored):

```sh
echo 'EDITOR_PASSWORD=dev' > .env
```

Then restart `bun run dev` / `bun run serve` and log in. The cookie session
keeps you signed in until you sign out or restart with a different password.

See `web/src/__manual__/editor-flow.md` for the full end-to-end checklist
(anonymous draft → editor approval → applied edit).

## Testing

```sh
uv run pytest
```

The suite uses `httpx` + FastAPI's TestClient against a tmpdir `data/index.db`.
Notable cases: `app/test_build_index_preserve.py` verifies that
`scripts/build_index.py` preserves editor tables (`edits`, `inserted_lines`,
`line_order`, `drafts`) when rebuilding the FTS index.

There is no JS test runner. The frontend is verified manually via the checklists
in `web/src/__manual__/`.

## Pre-flight

Both `bun run dev` and `bun run serve` run a precheck (scripts/dev-check.js,
scripts/serve-check.js) that fails fast with the offending PID if port
8000/5173 is busy. If a previous run was killed uncleanly:

```sh
ss -ltnp 'sport = :8000'   # find PID
kill <pid>                 # free the port
```
