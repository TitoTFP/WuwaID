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
- [ ] Rewrite/import `wuwaid-log-server` history beneath `log-server/`, excluding tracked `node_modules` and `dist`; add an appropriate `.gitignore` without changing the deployed API host, methods, paths, or multipart fields.
- [ ] Move/add all CI definitions under root `.github/workflows/`; apply path filters so WuwaID Windows builds, quests checks, and log-server checks remain independent.
- [ ] Extend the existing quests session model with a separate `admin` role and credential; add server-side authorization tests for anonymous, editor, and admin access.
- [ ] Add FastAPI `/api/admin/logs/*` proxy endpoints that check the admin session and inject `WUWAID_ADMIN_TOKEN` while forwarding only to log-server `/admin/api/*` endpoints.
- [ ] Make log-server admin authorization fail closed, remove query-token dependence for the new UI path, and preserve `POST /api/logs` plus `POST /api/active/heartbeat` unchanged.
- [ ] Add React `/admin/logs` navigation and dashboard components by porting current active-player, upload, history, inspector, download, and refresh behaviors from the legacy dashboard.
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

## Verification

- Before migration, run the new characterization suite plus all existing tests to record a green baseline; rerun the same suite after every milestone.
- Run the quests Python tests plus `bun run test:web` and `bun run build` after its import.
- Run `npm test` and `npm run build` for log-server after its import.
- Verify WuwaID release workflows and current public release URLs remain unchanged for Launcher/Mobile.
- Verify anonymous and editor sessions receive denial for `/admin/logs` and every `/api/admin/logs/*` proxy route; verify an admin can list, inspect, and download logs without a browser-held service token.
- Verify missing or incorrect `WUWAID_ADMIN_TOKEN` denies direct log-server admin access; verify the trusted proxy works with a configured token.
- Verify Launcher/Mobile upload and heartbeat requests still succeed against the unchanged log-server host, methods, paths, and multipart contract.
- Smoke-test the legacy dashboard during the 14-day parallel window, then validate its retirement does not affect upload, retention, cleanup, or stored logs.
