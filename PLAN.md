# WuwaID monorepo + unified web UI plan

> **Status:** Revised for review — test-first delivery and orchestrated validation included.

## Context

- Make the existing `WuwaID` GitHub repository the canonical repository so its release URL and existing Launcher/Mobile download contract remain unchanged.
- Import `wuwaid-quests` and `wuwaid-log-server` with their Git histories into the WuwaID repository.
- Deliver one web experience: public quest viewing/editing plus an admin-restricted log dashboard.
- Keep Launcher/Mobile upload contracts (`POST /api/logs` and heartbeat) stable during this migration.

## Approach

Use the existing quests React/Vite application as the single UI shell, rather than creating a new frontend or merging runtimes.

```text
React UI at the existing quests origin
  /                 public quest viewer
  /editor/...       quest editing
  /admin/logs       protected log dashboard

FastAPI (quests)
  quest API + signed session cookie
  /api/admin/logs/* -> verify admin role, proxy only to log-server /admin/api/*

Express (log-server)
  POST /api/logs and POST /api/active/heartbeat remain public and unchanged
  /admin/api/* accepts only the server-side proxy credential
```

Keep the FastAPI and Express processes, SQLite databases, deploy units, and secrets independent. Do not add a monorepo-wide package manager, new proxy service, shared database, or client-side admin token. The proxy reads `WUWAID_LOG_SERVER_URL` and `WUWAID_ADMIN_TOKEN` server-side; the browser never receives either value.

## Decisions made

- Serve the unified UI from the existing quests origin, with the restricted dashboard at `/admin/logs`.
- Use an explicit `admin` role/credential; quest editors are not implicitly log administrators.
- Keep the legacy log dashboard in parallel for 14 days after production parity is verified, then retire it.
- Deliver sequential milestones: first a behavior-preserving Git/history import and CI baseline; then the unified UI, authorization, and proxy work. This keeps each rollback bounded.

## UI decision record — complete frontend rebuild

### Problem and desired outcome

WuwaID Quests needs a complete visual and UX rebuild of its existing frontend so readers, translators, editors, and administrators can find, read, edit, review, and inspect information with stronger orientation, legibility, and trust. The rebuild must improve the experience without changing the product semantics or established workflows.

Success is observable when:

- readers can find and read multilingual quest content without losing context;
- translators and editors can work through large quests, drafts, diffs, and review states without losing position or unsaved work;
- administrators can inspect log activity through the restricted operations surface; and
- every existing route, role boundary, API contract, and safeguard continues to work.

### Affected users and surfaces

Users are readers, translators, editors, and administrators. The affected surface is the complete React/Vite frontend under `quests/web/`, including:

- browse and reading: home, chapters, side quests, categories, quests, search, and versions;
- work: quest translation, category translation, structural editing, drafts, login, and review;
- operations: admin login and admin logs.

The URL contract remains unchanged. Navigation may regroup these routes into three visible modes: Browse, Work, and Operations.

### Source evidence and authority

Authority is ordered as follows:

1. the current explicit user requirement;
2. `quests/PRODUCT.md` for product behavior and constraints;
3. `quests/design.md` for Sentinel visual and interaction direction;
4. `quests/tokens.css`, `quests/web/src/index.css`, current route/component behavior, and manual verification documents for implementation evidence;
5. this plan for repository-level runtime, release, and service-boundary constraints.

The current quests React/Vite application remains the single UI shell. No new frontend runtime or second application shell is introduced.

### Preservation constraints

The rebuild must preserve:

- existing routes, capabilities, API contracts, permissions, data flows, and session behavior;
- anonymous drafts, editor approval/rejection, draft persistence, review status, and unsaved-change safeguards;
- keyboard flows, existing shortcuts, focus behavior, and copyable technical IDs/source references;
- multilingual wrapping, language identity, quest line anchors, search highlighting, and large-quest virtualization;
- explicit separation between anonymous, editor, and admin access;
- server-side handling of admin log credentials; the browser must not receive service tokens; and
- existing backend, log-server upload/heartbeat, deployment, and release contracts.

### Settled product and interaction decisions

- Rebuild the complete frontend, not a partial route or component refresh.
- Keep Sentinel as the visual identity and refine it rather than replacing it.
- Keep the unified shell and existing URLs while allowing clearer navigation grouping.
- Keep global search prominent and available on every viewport.
- Preserve context when moving between reading, translation, editing, drafts, and review.
- Keep reading surfaces calm and spacious, work surfaces compact and precise with sticky action regions, and admin logs dense and instrument-like.
- Preserve explicit status, diff, confirmation, and recovery feedback; no silent mutation or data-loss behavior is introduced.

### Relevant state matrix

| State | Decision |
|---|---|
| Initial/loading | Preserve skeleton/loading conventions and avoid blank screens; keep the surrounding context visible where possible. |
| Empty/no-results | Show explicit text and a recoverable next action; preserve active search/filter context. |
| Partial/stale data | Make incomplete or stale content distinguishable from confirmed content; do not silently present it as final. |
| Success/completion | Confirm completed mutations and refresh the affected view without losing the user's location. |
| Validation/recoverable error | Use visible text plus retry, return, or correction actions; never rely on color alone. |
| Permission/authentication | Preserve route guards and role-gated actions for anonymous, editor, and admin sessions. |
| Unsaved/local draft | Warn before leaving, preserve local draft context, and keep pending state visible. |
| Review/destructive action | Keep original-versus-draft context and explicit confirmation for approval, rejection, deletion, export, or other consequential actions. |
| Unavailable dependency | Show an actionable unavailable/error state for API or log-service failure; never fall back to client-held admin credentials. |

### Responsive and adaptive contract

- No horizontal page overflow at 320px.
- Global search remains first-class on mobile and desktop.
- Desktop exposes Browse and Work controls in the masthead.
- Mobile collapses navigation into the existing menu pattern while preserving every route and role-gated action.
- Desktop workbenches may use multiple panes and sticky tools; narrow layouts may stack, collapse, or scroll panes internally, but actions cannot disappear.
- Long multilingual strings wrap safely, and technical IDs remain selectable.
- Primary touch targets remain at least 44px.

### Accessibility and input contract

- Meet WCAG AA contrast expectations.
- Preserve semantic landmarks, labels, and existing accessible names.
- Keep primary workflows and existing keyboard shortcuts operable.
- Keep the cyan focus outline visible against every surface.
- Express selected, loading, error, success, pending, approved, rejected, and disabled states with text or shape in addition to color.
- Respect `prefers-reduced-motion`.

### Explicit non-goals

- No backend, API contract, data model, permission model, or role redesign.
- No route migration or URL-breaking information architecture rewrite.
- No new frontend runtime, separate role-specific shell, or replacement of the existing quests shell.
- No rebuild of the log-server runtime or changes to Launcher/Mobile upload and heartbeat contracts.
- No new visual authority, Figma dependency, or speculative component library.

### Rejected alternatives

- **New frontend application:** rejected because the existing quests React/Vite app is already the repository's unified UI shell and duplicating it would split behavior and routing.
- **Route/API rewrite:** rejected because existing links, integrations, permissions, and release contracts are preservation constraints.
- **Role-specific frontends:** rejected because the product must serve readers, translators, editors, and administrators through one coherent shell.
- **Replacement visual identity:** rejected because Sentinel is the documented current authority and no new source was supplied.
- **Backend or log-server redesign:** rejected because this decision is limited to the frontend experience and must keep service boundaries stable.

### Implementation questions intentionally deferred

Component decomposition, prop contracts, state-library details, CSS structure, exact token exceptions, test organization, rollout sequencing, and file placement are deferred to `/to-ui-spec` and subsequent implementation work.

### Handoff

The next handoff is `/to-ui-spec`. It must turn this record into screen-level UI specifications while preserving the contracts above and using the existing frontend quality gates and manual verification checklists.

## Files to modify

Expected paths after import:

- `quests/web/src/App.tsx`, `quests/web/src/components/Layout.tsx`, `quests/web/src/lib/api.ts`, and a new `quests/web/src/routes/AdminLogsPage.tsx` plus focused components — add the protected React route and port the log-dashboard behavior.
- `quests/app/auth.py`, `quests/app/main.py`, and focused auth/proxy tests — mint and enforce the explicit `admin` role; proxy requests to the log service without exposing a service token to the browser.
- `log-server/src/server.ts`, `log-server/src/config.ts`, and `log-server/src/tests/` — keep upload/heartbeat contracts unchanged and make every admin route fail closed when its credential is absent or invalid.
- `log-server/frontend/` and `log-server/public/` — retain during the 14-day parallel window; remove or redirect only after parity acceptance.
- `quests/scripts/build_index.py` and `quests/scripts/version_texts.py` — replace the sibling-repository assumption with an explicit WuwaID export location.
- `.github/workflows/*.yml` — keep all workflows at the WuwaID repository root and add path-filtered jobs for quests and log server.
- Root `.gitignore`, documentation, deployment instructions, and environment examples — reflect imported applications while excluding generated data, credentials, and log storage.
- `quests/app/test_auth.py` plus a new `quests/app/test_admin_logs_proxy.py` — characterize roles, session gates, allowlisted proxy paths, injected server credential, and upstream failure handling with the existing FastAPI `TestClient`/pytest setup.
- Existing `quests/app/test_build_index_*.py` coverage — extend the current `resolve_source` behavior checks for the post-import WuwaID export location.
- `quests/web/tests/translatorWorkflow.test.ts` pattern plus a new `quests/web/tests/adminLogsWorkflow.test.ts` — use the existing `node:test` harness for extracted dashboard/client helpers without adding a frontend test dependency.
- `log-server/src/tests/server.test.ts` plus a new `log-server/src/tests/admin-auth.test.ts` — characterize unchanged upload/heartbeat requests and require all admin access to fail closed.

## Reuse

- `quests/web/src/App.tsx` and `components/Layout.tsx` provide the existing React Router shell and navigation.
- `quests/app/auth.py` already has signed, persisted sessions and a stored `role` field, so an `admin` role extends an existing model rather than introducing a new auth system.
- `quests` already includes `httpx`, suitable for the small server-side admin API proxy.
- `log-server/src/server.ts` already exposes admin APIs under `/admin/api/*`; reuse those routes and leave Launcher upload and heartbeat endpoints unchanged.
- `log-server/frontend/app.ts` contains the current dashboard's active-player, upload-list, history-chart, and log-inspector behavior to port into React incrementally.
- `log-server/src/tests/` and `quests/app/test_*.py` are the focused regression suites.

## Test-first contract

Before moving source or changing runtime behavior, add and run the smallest missing regression suite using the already-installed pytest and `node:test` harnesses:

1. The FastAPI tests must prove anonymous and editor sessions cannot use any admin-log route; an admin session can use only the intended proxy paths; proxy credentials never appear in responses; and upstream errors are safely surfaced.
2. The log-server tests must prove a missing or bad admin credential denies every admin route while the existing multipart upload and heartbeat contracts continue to work unchanged.
3. The web tests must cover the extracted admin-log client/formatting/route-guard helpers. Browser-level route and dashboard smoke checks stay in the manual verification step; no new test framework is justified.
4. The import/path tests must prove the quests indexer resolves the new WuwaID export source and fails clearly when it is absent.

## Orchestration

- The parent orchestrator owns scope and remains the only decision-maker; implementation uses one writer per branch/milestone.
- A Paseo read-only reviewer, using `omniroute/oc/deepseek-v4-flash-free`, validates release contracts, deployment boundaries, and the final security/deploy diff before each milestone is accepted.
- A Pi worker using the same model is the sole mutation-capable implementer for a milestone. Fresh-context Pi reviewers validate the test-first diff, authorization boundary, and migration/CI result after it lands.
- Do not run concurrent writers. Keep Paseo/Pi output as review artifacts and escalate any new release-URL, credential, or data-retention decision to the user.

## Steps

- [x] **Test first:** add the characterization tests listed above in the current source repositories, run them clean, and record the baseline before any history rewrite, source move, auth, or UI change.
- [x] Create a reversible import branch and Git bundle backups; preserve current WuwaID tags, namespace imported tags, and do not alter WuwaID's public release location.
- [x] Rewrite/import `wuwaid-quests` history beneath `quests/`, then update only repository-root/export-path assumptions and prove its existing build/tests still pass.
- [x] Rewrite/import `wuwaid-log-server` history beneath `log-server/`, excluding tracked `node_modules` and `dist`; add an appropriate `.gitignore` without changing the deployed API host, methods, paths, or multipart fields.
- [x] Move/add all CI definitions under root `.github/workflows/`; apply path filters so WuwaID Windows builds, quests checks, and log-server checks remain independent.
- [x] Extend the existing quests session model with a separate `admin` role and credential; add server-side authorization tests for anonymous, editor, and admin access.
- [x] Add FastAPI `/api/admin/logs/*` proxy endpoints that check the admin session and inject `WUWAID_ADMIN_TOKEN` while forwarding only to log-server `/admin/api/*` endpoints.
- [x] Make log-server admin authorization fail closed, remove query-token dependence for the new UI path, and preserve `POST /api/logs` plus `POST /api/active/heartbeat` unchanged.
- [x] Add React `/admin/logs` navigation and dashboard components by porting current active-player, upload, history, inspector, download, and refresh behaviors from the legacy dashboard.
- [ ] Deploy the unified UI while retaining the old `/admin` dashboard for 14 days; verify feature parity and operations before redirecting/removing that legacy frontend.

## Execution log

### Step 1 — test-first baseline (2026-08-02)

- Added `wuwaid-quests/app/test_build_index_source.py`, an admin-role session round-trip to `wuwaid-quests/app/test_auth.py`, and `wuwaid-log-server/src/tests/admin-auth.test.ts`.
- `uv run pytest -q` in `wuwaid-quests`: **288 passed** (3 pre-existing FastAPI/TestClient deprecation warnings).
- `bun run test:web && bun run build` in `wuwaid-quests`: **6 passed**, production build succeeded.
- `npm test` in `wuwaid-log-server`: **11 passed, 0 failed, 1 todo** for the later unset-token fail-closed change; existing multipart upload and heartbeat coverage remained green.
- `npm run build` in `wuwaid-log-server`: succeeded. `git diff --check` is clean; the generated untracked `dist/src/tests/admin-auth.test.js` artifact was removed.
- The current empty-`WUWAID_ADMIN_TOKEN` fail-open behavior remains intentionally unmodified and is recorded by the TODO; Step 7 will replace it with a passing fail-closed assertion before changing production code.

### Step 2 — reversible import setup (2026-08-02)

- Created and verified complete `git bundle --all` backups at `/home/nozomi/.local/share/wuwaid-migration-backups/20260802T131749Z/` for WuwaID, quests, and log-server before creating migration branches.
- Created local-only `WuwaID` branch `monorepo/unified-web-ui` from `5ee8cf7`; committed this plan as `540d0e8` without changing `origin` (`https://github.com/TitoTFP/WuwaID.git`) or any public tag.
- Current WuwaID has 58 tags; the tag refs exactly match the verified backup and the original main commit remains an ancestor of the migration branch.
- Created source branches `monorepo/pre-import-tests` at `3350602` (quests) and `6d284a3` (log-server) so the baseline tests are committed and will be included in the history imports. No branch was pushed.

### Step 3 — quests history import (2026-08-02)

- `git filter-repo` was unavailable, so a disposable clone under `~/.local/share/wuwaid-migration-work/20260802T131749Z/quests` used Git's built-in `filter-branch --index-filter`; the original source repository and verified bundles remain untouched.
- Rewrote all 155 quests commits beneath `quests/`; the filtered HEAD has no tracked path outside that prefix and retains the Step 1 tests. Quests had no tags to namespace.
- Merged the rewritten branch into `monorepo/unified-web-ui` as `ccfbfea` and removed the temporary `quests-import` remote.
- Updated only the exporter-root candidates, source-resolver test, and current README examples for the new `../scripts/export_text_grouped` monorepo location; legacy sibling candidates remain as fallback.
- Installed the lockfile-resolved Bun dependencies in the new `quests/` checkout, then verified `uv run pytest -q app` (**288 passed**) and `bun run test:web && bun run build` (**6 passed**, build succeeded).
- A bare `pytest` also collects `scripts/__manual__/test_mcp_server.py`, which requires generated `data/glossary.json` and is not part of the supported app suite; it remains unmodified and is documented as a manual-data residual rather than changing test collection outside this path-migration scope.

### Step 4 — log-server history import (2026-08-02)

- Used a second disposable `filter-branch --index-filter` clone to rewrite all 13 log-server commits beneath `log-server/` while removing 1,531 tracked `node_modules` paths and 11 tracked `dist` paths from retained history. The filtered HEAD has no path outside `log-server/`; log-server had no tags to namespace.
- Merged the filtered history as `1353cb1` and removed the temporary `log-server-import` remote. The source repo and the verified pre-import bundle remain intact.
- Added `log-server/.gitignore` for dependencies, build output, env files, and logs. npm 12 recorded allowlisted lifecycle scripts for existing `better-sqlite3` and `esbuild` in `package.json`, making the lockfile install reproducible after tracked dependencies were removed.
- Compared imported `src/server.ts` and `src/config.ts` byte-for-byte with the legacy checkout: both are unchanged. `npm test` passed (**11 passed, 1 planned todo**) and `npm run build` passed after the approved native dependency rebuild; the existing multipart upload and heartbeat tests passed unchanged.

### Step 5 — independent root CI (2026-08-02)

- Added root `.github/workflows/quests.yml` (Python app tests, Bun web tests/build) and `log-server.yml` (npm test/build), each filtered to its own subtree and workflow file.
- Enabled the existing Windows export, PakBypass, and file-trigger workflows only for their respective `src/**` paths plus their workflow definitions; the input-dependent font packaging workflow remains manual-only.
- Confirmed all workflow definitions live under root `.github/workflows/` and have the intended trigger shape. `actionlint` is unavailable locally, so GitHub Actions syntax validation remains a CI-side check.

### Step 6 — separate admin session role (2026-08-02)

- Added `ADMIN_PASSWORD` verification, `require_admin`, and `POST /api/admin/login`; the existing signed cookie/session table stores the `admin` role without a schema migration.
- Kept editor login and `require_editor` editor-only, so an editor credential/session cannot implicitly access future log administration.
- Added server-side tests for the separate credential, anonymous/editor rejection, and admin session endpoint. The new tests failed before the implementation and then passed: `app/test_auth.py` **16 passed**, full quests app suite **292 passed**, web tests/build still passed.

### Step 7 — admin-only log proxy (2026-08-02)

- Added a narrow GET-only FastAPI proxy surface for active summaries, players, history, uploads, file lists/content, and downloads. It maps only to log-server `/admin/api/*` paths; no generic target URL, browser token, or query-token forwarding exists.
- The proxy requires the admin cookie, injects `WUWAID_ADMIN_TOKEN` server-side, disables environment proxy inheritance, filters response headers, and returns a generic 502 without leaking upstream connection details.
- Added respx/TestClient coverage for anonymous/editor denial, admin forwarding/token injection, missing server credential, bounded routes, download headers, and upstream failure. The new suite failed before implementation then passed (**6 passed**); the full quests app suite reached **298 passed** and web tests/build remained green.

### Step 8 — fail-closed log admin auth (2026-08-02)

- Replaced log-server's empty-token bypass with a 503 fail-closed response; only a constant-time checked `X-Admin-Token` header authorizes admin routes. Query tokens are rejected.
- Replaced both legacy dashboard download URLs that embedded the token with header-authenticated Blob downloads, including the compiled `public/app.js`; production source has no query-token dependence.
- The new tests failed before the change then passed. `npm test` now reports **12 passed, 0 todo**; backend/frontend builds pass, and existing multipart upload plus heartbeat tests remain green.

### Step 9 — React admin log dashboard (2026-08-05)

- Added `quests/web/src/routes/AdminLoginPage.tsx` (`/admin/login`) using the separate admin credential and `useAdminLogin`, and `AdminLogsPage.tsx` (`/admin/logs`) with active-player, uploads (inspect/download), history tabs, search filters, 30s auto-refresh, and Blob download with `Content-Disposition` filename parsing.
- Added `quests/web/src/lib/adminLogs.ts` pure helpers plus `adminLogsWorkflow.test.ts`; wired routes in `App.tsx` and admin-only Logs nav links in `Layout.tsx`; extended `api.ts` and `types.ts` for the proxy endpoints.
- The admin-log client calls match the Step 7 proxy paths exactly. `uv run pytest -q app` (**298 passed**), `bun run test:web` (**7 passed**), `bun run build` (succeeded), and `npm test` in log-server (**12 passed**) are all green.
- End-to-end browser verification against a live local stack (quests API :8000 + Vite :5173 + log-server :8001): public quest viewer/search/translator, anonymous denial on `/admin/logs`, admin login, upload listing, log inspect, and zip download all pass through the cookie-only proxy (token never in browser).

### Step 10 — deploy prep (2026-08-05)

- Decided target: WebUI on `wuwaid.titotfp.my.id` (new hostname on the existing `logs-tunnel` Cloudflare tunnel); log-server stays on `logs.titotfp.my.id` unchanged, because `POST /api/logs` + heartbeat URLs are hardcoded in released Launcher/Mobile clients.
- Recommendation accepted: **14-day parallel window** (WebUI live alongside legacy `/admin`), with the legacy dashboard kept alive on `logs.titotfp.my.id` and retired only after parity is proven.
- Repo deploy-readiness changes (this commit):
  - `quests/app/main.py`: CORS origins from `WUWAID_ORIGINS` env (comma-separated), localhost defaults preserved.
  - `quests/.env.example`: documents `WUWAID_ORIGINS`, `WUWAID_LOG_SERVER_URL`, `WUWAID_ADMIN_TOKEN`, `ADMIN_PASSWORD`.
  - `deploy/wuwaid-quests.service`: systemd user unit (uvicorn on 127.0.0.1:8000).
  - `deploy/README.md`: server setup, build/reindex, tunnel hostname addition, rollback.
- **Remaining for production go-live:** server-side steps in `deploy/README.md` (install uv/bun, sync deps, build index, start unit, add tunnel hostname) + a fresh end-to-end check against the live domains.

### Structure cleanup (2026-08-05)

- Removed duplicated root `export_text_grouped/` (506 MB, identical to `scripts/export_text_grouped/`). Canonical export output is now only `scripts/export_text_grouped/`.
- Fixed `scripts/generate_glossary.py` and `scripts/scrape_wiki.py` to read from `scripts/export_text_grouped/` instead of the removed root path.
- Cleaned `quests/scripts/build_index.py` `DEFAULT_CANDIDATES`: dropped self-nested `WuwaID/…` and legacy root candidates; canonical remains `scripts/export_text_grouped/export_quest_ordered`. `test_build_index_source.py` still passes.
- Documented `tools/Dumper-7` as frozen vendored code in `VENDORED.md` (upstream `CallMeDangDev/WuwaVH` is deleted, cannot be a submodule).
- `Web/` (launcher bgm/video assets) is intentionally kept: `Web/assets.json` URLs are hardcoded in released Launcher/Mobile clients (`.../main/Web/Audio/bgm.mp3`), so the path must not move.

### Step 11 — frontend rebuild slices (2026-08-05)

- **S1 — Sentinel shell/search:** split global search and shell navigation into behavior-owning modules; added Browse/Work/Operations grouping, mobile disclosure focus restoration, first-class search labeling, and shell contrast fixes.
- **S2 — Quest viewer:** extracted the virtualized dialogue stream; preserved line anchors, search highlighting, plot/state headers, option jumps, and large-quest behavior; added explicit loading/error recovery states and keyboard-focusable dialogue scrolling.
- **S3 — Translator workbench:** added the shared responsive workbench layout; centralized mobile pane/focus behavior; preserved local draft, selection, navigation, and submit workflows; removed the duplicate route-level unsaved guard.
- **S4 — Structural editor:** migrated the editor to the shared workbench; preserved reorder preview/reset/save, line selection, shortcuts, and unsaved protection; fixed line-type labeling and heading semantics.
- **S5 — Draft review states:** hardened queue/detail loading, session-check, empty, mutation-error, retry, and reviewer-note semantics; preserved role-gated approve/reject, bulk actions, diff, export, and purge behavior.
- **S6 — Admin operations:** hardened admin session recovery, tab/panel semantics, loading/error/empty states, retry paths, table headers, scroll focus, file inspection, and download behavior; fixed active Sentinel buttons and table-header contrast.
- **S7 — Browse/search/versions:** added explicit query error/retry/empty states to home, grouped texts, and search; added category-entry loading/error recovery; added editor-session/version query recovery, labeled version controls, keyboard-focusable long lists, and semantic diff/group controls.
- Browser checks exercised `/`, `/search?q=Jinzhou&lang=en`, `/categories`, `/categories/34NPCTHST`, `/versions`, `/quests/1`, `/quests/1#L5000`, `/translator/1`, `/editor/1`, `/drafts`, `/drafts/999999`, and authenticated `/admin/login` → `/admin/logs` at 320px and 1280px. A disposable admin credential and disposable log-server fixture verified active-player data, upload listing, file inspection, and download without exposing the service token to the browser.
- `bun run test:web`: **7 passed**. `uv run pytest -q app`: **302 passed** with 3 existing warnings. `bun run build`: succeeded. Targeted LSP diagnostics were clean for changed TypeScript; targeted axe checks reported 0 violations for Home, Search, Categories, Versions, Draft Review, and authenticated Admin Logs after the contrast/focus fixes, with remaining incomplete checks requiring manual review.
- Deployed over `ssh nozomi@tito-thinkpad` using remote `.env` injection: created rollback backup `/home/nozomi/deploy-backups/wuwaid-quests/quests-20260806T024212Z.tar.gz`, rsynced current `quests/` source while preserving `.env`, `data/`, `.venv`, and `node_modules`, replaced `web/dist`, and restarted `wuwaid-quests`.
- Deployment verification passed: local service `active`, local HTTP `200`, `cloudflared-tunnel` `active`, transferred source/dist hashes match the local build, and the backup contains no `.env`, `data/`, or `.venv` paths.
- Production asset parity now matches: `assets/index-B1A4SQHP.css` and `assets/index-DXKLp_lP.js` are served by both local and `wuwaid.titotfp.my.id`.
- Authenticated production API smoke passed using secrets only on the target host: admin login `200`, `/api/me` role `admin`, active players, players, uploads, history, file inspection, and ZIP download all returned successfully; 38 uploads were available and one file was inspected. The service token was not printed or sent to the browser.
- Post-deploy production browser QA passed for home, search, grouped texts, editor-only versions, admin login, and anonymous admin denial with no reported console/network/page errors. The existing 14-day parallel rollout and legacy dashboard retirement remain operational follow-up, not deployment blockers.

## Verification

- Before migration, run the new characterization suite plus all existing tests to record a green baseline; rerun the same suite after every milestone.
- Run the quests Python tests plus `bun run test:web` and `bun run build` after its import.
- Run `npm test` and `npm run build` for log-server after its import.
- Verify WuwaID release workflows and current public release URLs remain unchanged for Launcher/Mobile.
- Verify anonymous and editor sessions receive denial for `/admin/logs` and every `/api/admin/logs/*` proxy route; verify an admin can list, inspect, and download logs without a browser-held service token.
- Verify missing or incorrect `WUWAID_ADMIN_TOKEN` denies direct log-server admin access; verify the trusted proxy works with a configured token.
- Verify Launcher/Mobile upload and heartbeat requests still succeed against the unchanged log-server host, methods, paths, and multipart contract.
- Smoke-test the legacy dashboard during the 14-day parallel window, then validate its retirement does not affect upload, retention, cleanup, or stored logs.
