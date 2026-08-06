# Frontend stack

## Scope map

- Repository root: `WuwaID/`
- Application root: `WuwaID/quests/`
- Frontend root: `WuwaID/quests/web/`
- Backend/API root: `WuwaID/quests/app/`
- Shared UI sources:
  - `WuwaID/quests/tokens.css`
  - `WuwaID/quests/web/src/index.css`
  - `WuwaID/quests/web/tailwind.config.js`
- Delivery surface: browser SPA

`WuwaID/log-server/` is an adjacent TypeScript service, not part of this application root. Its admin UI is not present in this checkout. The quests application consumes it through the server-side log proxy.

## Framework and rendering

- React 18 with TypeScript.
- Vite is the frontend bundler and dev server.
- Tailwind CSS is used alongside global CSS component classes.
- React Router defines routes in `web/src/App.tsx`.
- `web/src/routes/` contains route-level screens.
- `web/src/components/` contains shared and editor components.
- Rendering is client-side only; no SSR, SSG, or React Server Components were detected.
- `web/src/main.tsx` mounts `QueryClientProvider`, `BrowserRouter`, and `ToastProvider`.

## Runtime and delivery

Development:

- Vite serves the frontend on port `5173`.
- Vite proxies `/api` to FastAPI on port `8000`.

Production-style local serving:

- `bun run build` creates `web/dist/`.
- `bun run serve` runs FastAPI and serves the built SPA from `web/dist/`.
- SPA fallback and static delivery are implemented in `app/main.py`.

## Dependencies and package managers

- JavaScript package manager/runtime: Bun, using `bun.lock`.
- Python package manager/runtime: uv, using `uv.lock`.
- Server-state library: `@tanstack/react-query`.
- Routing: `react-router-dom`.
- Large dialogue lists: `react-window`.
- No component library, headless UI library, form library, or generated API client was detected.

## State and data

- API access uses handwritten typed functions in `web/src/lib/api.ts`.
- Authentication uses FastAPI session cookies.
- Anonymous author labels, local drafts, review marks, tree expansion, and pane sizing use browser `localStorage`.
- Backend data is generated/indexed under `quests/data/`.
- Quest and category search use SQLite FTS5.
- `quests/data/` is generated and gitignored; rebuild it with `bun run build:index`.

## Constraints

- Preserve existing routes, API contracts, permissions, draft persistence, keyboard behavior, and editor safeguards.
- Treat multilingual text, IDs, source references, loading states, error states, and permission states as first-class UI content.
