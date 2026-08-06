# Frontend quality

## Scope map

- Repository root: `WuwaID/`
- Application root: `WuwaID/quests/`
- Frontend root: `WuwaID/quests/web/`
- Backend/API root: `WuwaID/quests/app/`
- Shared UI sources: `WuwaID/quests/tokens.css`, `WuwaID/quests/web/src/index.css`, and `WuwaID/quests/web/tailwind.config.js`
- Delivery surface: browser SPA

## Blocking automated gates

Run from `WuwaID/quests/`.

| Gate | Command | Evidence |
|---|---|---|
| Backend tests | `uv run pytest -q app` | `.github/workflows/quests.yml` |
| Frontend tests | `bun run test:web` | `.github/workflows/quests.yml` |
| Typecheck and production build | `bun run build` | `package.json`, CI workflow |

`bun run build` runs `tsc --noEmit` before `vite build`. TypeScript uses strict mode, unused-local checks, unused-parameter checks, and no-fallthrough checks.

CI installs dependencies with:

```sh
uv sync --locked --group dev
bun install --frozen-lockfile
```

## Manual verification

For UI changes, run the relevant sections of:

- `web/src/__manual__/editor-flow.md`
  - anonymous drafts
  - editor approval
  - tree reordering
  - keyboard shortcuts
  - responsive/editor readability
  - viewer regression
- `web/src/__manual__/quest-perf.md`
  - large quest rendering
  - virtualized scrolling
  - deep links and line anchors
  - gzip and payload behavior
  - editor performance
- `bash scripts/manual-editor-test.sh`
  - API-level draft and approval walkthrough
  - mutates local gitignored data and requires `EDITOR_PASSWORD`

## Accessibility contract

The repository requires:

- WCAG AA contrast.
- Semantic landmarks and existing labels preserved.
- Keyboard-operable primary flows.
- Visible cyan focus indicators.
- Status conveyed with text or shape, not color alone.
- Reduced-motion support through `prefers-reduced-motion`.
- No horizontal page overflow at 320px.
- Primary touch targets of at least 44px.

These requirements are documented in `PRODUCT.md` and `design.md`; no automated accessibility runner was detected.

## Not configured

No executable lint, formatter, browser E2E, visual regression, Storybook, browser matrix, or browserslist configuration was detected. Do not invent a browser support matrix; current browser targets are unspecified.
