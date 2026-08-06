# Frontend commands

## Scope map

- Repository root: `WuwaID/`
- Application root: `WuwaID/quests/`
- Frontend root: `WuwaID/quests/web/`
- Backend/API root: `WuwaID/quests/app/`
- Shared UI sources: `WuwaID/quests/tokens.css`, `WuwaID/quests/web/src/index.css`, and `WuwaID/quests/web/tailwind.config.js`
- Delivery surface: browser SPA

All commands below run from `WuwaID/quests/`.

## Initial setup

```sh
bun install
uv sync
uv run python scripts/build_index.py
```

The index build is needed when the generated `data/` tree is not populated.

## Development

```sh
bun run dev
```

Starts:

- Vite frontend on `http://localhost:5173`
- FastAPI backend on `http://localhost:8000`

The script checks both ports before starting.

Run one side only:

```sh
bun run dev:web
bun run dev:api
```

## Verification and production-style serving

```sh
bun run test:web
uv run pytest -q app
bun run build
bun run serve
```

`bun run build` typechecks and creates `web/dist/`.

`bun run serve` serves the built SPA and API from port `8000`.

Frontend-only Vite preview:

```sh
bun run preview
```

API calls still require a running backend when using `bun run preview`.

## Manual checks

```sh
bash scripts/run-dev.sh
bash scripts/manual-editor-test.sh
```

`run-dev.sh` starts both services and performs HTTP smoke checks.

`manual-editor-test.sh` requires:

- a server on port `8000`
- `EDITOR_PASSWORD`
- the configured quest data
- permission to mutate local gitignored editor data

## Data and translation commands

```sh
bun run build:index
bun run mcp
```

Use the scripts under `scripts/` for translation and export workflows documented in `README.md`.

## Environment

Copy `.env.example` to `.env` when needed. Do not commit credentials or tokens.

Important runtime variables include:

- `WUWAID_ORIGINS`
- `WUWAID_LOG_SERVER_URL`
- `WUWAID_ADMIN_TOKEN`
- `ADMIN_PASSWORD`

## Missing commands

No lint or format command is configured in `package.json`.
