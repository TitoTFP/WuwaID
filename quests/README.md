# wuwaid-quests

Web viewer for Wuthering Waves quest dialogue exported by
[`WuwaID/export_quest_ordered.py`](../WuwaID).

- **Frontend**: React 18 + Vite + TypeScript + Tailwind
- **Backend**: FastAPI + SQLite FTS5 (search)
- **Data pipeline**: Python script copies dialogue JSON from WuwaID and builds a
  full-text search index
- **Runner**: Bun

## Layout

```
wuwaid-quests/
├── scripts/build_index.py   # rebuilds data/ from ../WuwaID/export_quest_ordered
├── app/                     # FastAPI backend
├── web/                     # Vite + React frontend
└── data/                    # generated, gitignored
    ├── chapters.json
    ├── index.db             # FTS5
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

## Pre-flight

Both `bun run dev` and `bun run serve` run a precheck (scripts/dev-check.js,
scripts/serve-check.js) that fails fast with the offending PID if port
8000/5173 is busy. If a previous run was killed uncleanly:

```sh
ss -ltnp 'sport = :8000'   # find PID
kill <pid>                 # free the port
```
