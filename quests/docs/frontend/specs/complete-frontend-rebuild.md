# UI specification — complete frontend rebuild

**Status:** Confirmed for implementation

**Decision source:** [`WuwaID/PLAN.md`](../../../../PLAN.md), section “UI decision record — complete frontend rebuild”. The user confirmed the decision record before this specification was created.

**Application:** `WuwaID/quests/`

**Frontend:** `WuwaID/quests/web/`

## 1. Specification basis

### Source ledger

| Source | Authority | What it constrains |
| --- | --- | --- |
| [`PLAN.md`](../../../../PLAN.md) | Confirmed product decision | Rebuild boundary, users, non-goals, preserved workflows, handoff |
| [`PRODUCT.md`](../../../PRODUCT.md) | Product truth | Routes, capabilities, roles, workflows, data meaning, state significance |
| [`design.md`](../../../design.md) | Visual and interaction authority | Sentinel identity, hierarchy, composition, responsive behavior, accessibility |
| [`tokens.css`](../../../tokens.css) and [`web/src/index.css`](../../../web/src/index.css) | Existing design-system implementation | Palette, typography, spacing, motion, focus, responsive shell patterns |
| `web/src/App.tsx`, `components/Layout.tsx`, route screens, and `lib/` | Current behavioral evidence | Route contract, session behavior, data boundaries, draft and review behavior |
| [`web/src/__manual__/editor-flow.md`](../../../web/src/__manual__/editor-flow.md) | Manual workflow contract | Draft, approval, reorder, keyboard, unsaved, and viewer regression behavior |
| [`web/src/__manual__/quest-perf.md`](../../../web/src/__manual__/quest-perf.md) | Performance contract | Large quest rendering, anchors, search, gzip, cache, and editor performance |
| [`frontend-quality.md`](../../agents/frontend-quality.md) and [`frontend-commands.md`](../../agents/frontend-commands.md) | Quality and command authority | Blocking commands, manual gates, working directory, automation gaps |

When sources conflict, use this order: current explicit user requirement, `PRODUCT.md`, `design.md`, implementation tokens and documented current behavior, then repository convention.

## 2. Contract boundary

### Current contract to preserve

- Existing route URLs and route capabilities.
- Public reading, search, language switching, translation, editing, drafts, review, versions, authentication, import, and admin-log workflows.
- Anonymous, editor, and admin permission boundaries.
- FastAPI/API contracts, signed session cookies, server-side admin-log credentials, and log-server upload/heartbeat contracts.
- Draft persistence, review status, unsaved-change protection, keyboard shortcuts, line anchors, search highlighting, copyable technical identifiers, and safeguards.
- Large-quest virtualization and existing performance expectations.

### Confirmed contract to change

- Complete visual and UX presentation of the frontend.
- Sentinel layout composition, navigation grouping, typography application, density, emphasis, and responsive composition may be rebuilt.
- Routes remain stable, but navigation may group them into Browse, Work, and Operations.
- Existing visual primitives may be refined within the Sentinel authority; no replacement identity is introduced.

### Not part of the UI contract

Component decomposition, prop names, state-library choices, CSS class names, file placement, helper extraction, test implementation details, and unrelated backend refactors remain implementation decisions.

## 3. Actors and surfaces

| Actor | Entry and permissions | Required surfaces |
| --- | --- | --- |
| Reader | Public/anonymous | Browse indexes, quest viewer, search, language switching, versions |
| Translator | Public translation workflow with local/draft context | Quest translator, category translator, line selection, draft submission |
| Editor | Authenticated `editor` session | Editor, drafts queue, diff/review, approval and rejection, import/export actions permitted by the current role |
| Administrator | Authenticated `admin` session | Admin login and restricted admin logs; admin sessions retain editor capabilities where the current product permits them |

The affected routes are:

- `/`
- `/chapters/:chapterId`
- `/side-quests`
- `/categories`
- `/categories/:categoryName`
- `/translator/category/:categoryName`
- `/quests/:qid`
- `/search`
- `/editor/:qid`
- `/translator/:qid`
- `/drafts`
- `/drafts/:draftId`
- `/versions`
- `/login`
- `/admin/login`
- `/admin/logs`

Unknown routes continue to resolve through the existing fallback behavior rather than introducing a new route migration.

## 4. Primary journeys

### UI-JOURNEY-001 — Find and read multilingual content

**Entry:** A reader opens the home page, a browse route, or any screen with the global shell.

1. The reader can perceive the current language and access global search without leaving the current surface.
2. Submitting a non-empty search query navigates to `/search` with the query and selected language represented in the URL.
3. Search results expose enough identity to distinguish quests, categories, speakers, source references, and exact dialogue matches where available.
4. Selecting a result opens the relevant route and preserves meaningful context such as language, query highlighting, line anchor, or return path.
5. The quest viewer presents speakers, language distinction, dialogue structure, scene/state separators, line anchors, and relevant plot-mode information without decorative noise.
6. A reader can return to the prior browse/search context without losing the active language or meaningful location.

**Completion:** The reader reaches and reads the intended quest or line.

**Recovery:** Empty results expose a clear way to revise or clear the query. API failure exposes a retry or return action. A missing quest does not render a misleading ready state.

### UI-JOURNEY-002 — Translate or edit without losing context

**Entry:** A reader selects a translation or edit action from a quest/category surface, or opens `/translator/:qid` or `/editor/:qid` directly.

1. The work surface identifies the quest/category, language pair, selected line, and current source context.
2. The translator/editor can search within the loaded tree and select a line without losing the surrounding flow/state context.
3. A translator can edit text and submit a draft using the existing draft workflow. Local author/draft context remains available after ordinary navigation or refresh according to current behavior.
4. An editor can edit structural content, preview line changes, and reorder valid flow/state/line blocks.
5. Reordering applies the existing guards: active local search disables reordering, invalid drops are ignored, block moves preserve structural meaning, reset restores server-loaded order, and saving creates pending reorder drafts.
6. The interface identifies edited lines, unsaved local changes, pending drafts, and mutation progress explicitly.
7. Leaving a dirty work surface invokes the existing unsaved-change guard before changing route or discarding work.

**Completion:** The user has a saved/submitted draft or a confirmed structural edit preview, with position and context retained.

**Recovery:** Failed mutations leave the edited content available for correction/retry and do not report success. Reset/cancel paths return to the last server-loaded or explicitly saved state.

### UI-JOURNEY-003 — Review and apply a draft

**Entry:** An authenticated editor opens `/login`, then `/drafts` or a draft detail route.

1. The editor sees pending drafts available to the editor role, including the current workflow's author visibility rules.
2. The queue supports the existing filters for quest, author, status, and date range.
3. Selecting a draft opens original-versus-draft context and identifies changed fields/operations.
4. Approve and reject actions require the existing confirmation semantics for consequential changes.
5. On confirmed success, the queue and detail state update; an applied draft is reflected in the relevant quest/editor view and a rejected draft is visibly distinguished.
6. On failure, the draft remains reviewable and an actionable error is shown.

**Completion:** The draft reaches an explicit applied, rejected, or still-pending state.

**Cancellation/recovery:** Closing or cancelling a confirmation leaves the draft unchanged. Refreshing the queue does not silently change a pending draft's status.

### UI-JOURNEY-004 — Inspect operational logs as an administrator

**Entry:** An administrator authenticates through `/admin/login` and opens `/admin/logs`.

1. The dashboard identifies the active administrator session and presents the current operations surface.
2. Active players, uploads, history ranges, log-file inspection, refresh, and download actions remain available according to the current admin dashboard behavior.
3. Dense tables use readable technical identifiers, timestamps, tabular values, explicit status text, and signal-only chart emphasis.
4. Anonymous and editor sessions cannot use the admin route or admin API proxy. They receive the existing denial/login behavior without seeing a browser-held service credential.
5. API or upstream log-service failure is visible and recoverable; the dashboard does not claim fresh data when the dependency is unavailable.

**Completion:** The administrator can inspect or download the requested log information, or can see why it is unavailable.

### UI-JOURNEY-005 — Operate the shell across viewport profiles

**Entry:** Any route is opened at a supported viewport or pointer mode.

1. The shell keeps brand, current mode, global search, language/session controls, and role-gated actions understandable.
2. Desktop exposes Browse and Work controls in the masthead; Operations remains visible only to the admin role.
3. Narrow layouts move browse/work links into the existing disclosure menu while keeping search first-class and all routes/actions reachable.
4. Moving between modes preserves meaningful route, language, query, selected item, or draft context where the current workflow provides it.
5. Opening and closing menu, modal, confirmation, import/export, and shortcut surfaces remains keyboard-operable and does not strand focus.

## 5. Behavioral requirements

### Navigation and information hierarchy

- **UI-REQ-001 — Stable route contract:** All routes listed in this specification remain addressable at their current URLs; the rebuild must not require URL migration or break existing deep links.
- **UI-REQ-002 — Three-mode shell:** Navigation presents Browse, Work, and Operations as understandable modes without creating separate frontend shells. Operations is visible and usable only for an authenticated admin.
- **UI-REQ-003 — Global search:** Search is available in the global shell on every viewport. Submitting a query preserves the selected language in the search URL and exposes a clear loading, empty, error, or ready state.
- **UI-REQ-004 — Language identity:** The active language is always perceivable on reading, search, translation, and editing surfaces. Language switching preserves the current route and other meaningful context whenever the current API supports it.
- **UI-REQ-005 — Context retention:** Navigation between reading, translation, editing, draft review, and return paths preserves meaningful selection, query, language, anchor, and unsaved-work context instead of resetting it silently.

### Reading and browse surfaces

- **UI-REQ-006 — Browse orientation:** Home, chapter, side-quest, category, and version surfaces expose their current collection/context, available filters or links, and an explicit empty/no-result state where applicable.
- **UI-REQ-007 — Long-form viewer:** Quest pages preserve readable measure, speaker identity, language distinction, choices, state/scene separators, line anchors, search highlights, and visible edit/translation affordances allowed by the current role.
- **UI-REQ-008 — Technical text:** Quest IDs, line IDs, source references, and other technical identifiers remain visually distinguishable from prose and selectable/copyable.

### Translation, editing, drafts, and review

- **UI-REQ-009 — Workbench context:** Translator and editor surfaces identify the current content, language context, selected line, tree position, and available primary action while preserving surrounding context.
- **UI-REQ-010 — Translation draft:** Editing a translation supports the existing draft submission path, local author/draft persistence, pending status, success feedback, and recoverable failure behavior.
- **UI-REQ-011 — Structural editing:** Structural editor operations preserve valid flow/state/line semantics. Valid block moves update the preview immediately; invalid drops are ignored; active local search disables reordering; reset returns to server-loaded order; saving creates the existing pending reorder draft behavior.
- **UI-REQ-012 — Unsaved protection:** A dirty editor or translator surface presents the existing unsaved-change guard before an in-app route change, browser leave, reset, or other operation that would discard work.
- **UI-REQ-013 — Draft review:** Draft queues expose existing filters, status values, original-versus-draft context, changed fields, and explicit review outcomes.
- **UI-REQ-014 — Consequential actions:** Approval, rejection, deletion, export, import, reset, and other consequential actions retain explicit confirmation/cancellation semantics and prevent duplicate submission while pending.

### Permissions, trust, and failures

- **UI-REQ-015 — Role boundaries:** Anonymous, editor, and admin sessions see only the actions and routes allowed by the current permission model. Admin capability is not inferred from editor capability.
- **UI-REQ-016 — Authentication recovery:** Login and admin-login failures remain visible and recoverable. Successful authentication updates the visible session state and available actions without requiring a full manual reload.
- **UI-REQ-017 — State feedback:** Loading, empty, no-results, partial/stale, success, pending, approved, rejected, disabled, permission-denied, and error states are visibly distinct using text/shape in addition to color.
- **UI-REQ-018 — Recoverable errors:** Query, mutation, import/export, and log-service failures expose an actionable retry, correction, return, or cancellation path. Failed actions do not claim success or silently discard local work.
- **UI-REQ-019 — Credential trust boundary:** Admin service credentials remain server-side. No UI behavior may require placing `WUWAID_ADMIN_TOKEN` or equivalent service credentials in browser state, URLs, or downloaded page data.

### Responsive, accessibility, and visual behavior

- **UI-REQ-020 — Narrow viewport:** At 320px and above, the page has no horizontal overflow; long multilingual content wraps safely; primary actions remain reachable.
- **UI-REQ-021 — Existing responsive profiles:** Use the repository's existing profiles: base/narrow layout below 48rem, wider content treatment from 48rem, desktop masthead/work controls from 64rem, and expanded shell constraints from 80rem. Do not introduce arbitrary competing breakpoints without a later design decision.
- **UI-REQ-022 — Workbench adaptation:** Desktop workbenches may use multiple panes, sticky tool regions, and dense controls. Narrow layouts may stack, collapse, or internally scroll panes, but no role-gated or primary action disappears.
- **UI-REQ-023 — Keyboard and focus:** Semantic links, buttons, inputs, disclosure controls, dialogs, and form controls remain keyboard-operable. Existing shortcuts remain unchanged. Focus is visible, follows logical order, returns from transient surfaces, and is not trapped outside the active dialog/menu.
- **UI-REQ-024 — Status accessibility:** Selection, loading, error, success, pending, approved, rejected, disabled, and permission states communicate through text, shape, or accessible name in addition to color. Dynamic mutation feedback is perceivable without relying on visual color alone.
- **UI-REQ-025 — Motion and targets:** Respect `prefers-reduced-motion`; primary touch targets are at least 44px; hover-only affordances cannot be the only way to discover or operate an action.
- **UI-REQ-026 — Sentinel visual system:** Use the documented Sentinel ground/panel/rule/signal palette, Manrope body/display typography, JetBrains Mono technical typography, restrained radii, hairline structure, flat panels, and signal-only emphasis. Avoid gradients, glassmorphism, emoji icons, rainbow semantic coding, and decorative looping motion.

### Performance and reliability

- **UI-REQ-027 — Large quest behavior:** Quest 1-sized data (approximately 45,292 lines) remains usable: no blank screen, initial render target under 2 seconds in the existing manual profile, responsive scrolling near 60fps, line anchors, search highlights, state headers, and plot-mode chips remain functional.
- **UI-REQ-028 — Payload behavior:** Existing gzip, stripped payload, and cache expectations remain observable through the current manual performance procedure. The rebuild must not require shipping the unbounded uncompressed quest representation to the browser.

## 6. State and transition model

### State definitions

| State ID | Entry condition | Visible information | Actions | Recovery/transitions |
| --- | --- | --- | --- | --- |
| `UI-STATE-INITIAL` | Route has mounted before required data is available | Stable shell and route context; no misleading content | Navigation remains available; data-dependent actions are unavailable | `LOADING`, `ERROR-RECOVERABLE`, or `READY` |
| `UI-STATE-LOADING` | Query or route data is being fetched | Skeleton/progress treatment and stable context | Duplicate data actions disabled; navigation remains safe | `READY`, `EMPTY`, `NO-RESULTS`, `STALE-PARTIAL`, or `ERROR-RECOVERABLE` |
| `UI-STATE-READY` | Required data loaded successfully | Full content, current language, selected context, available actions | Role-allowed actions enabled | Editing may enter `DIRTY`; mutations enter `SUBMITTING` |
| `UI-STATE-EMPTY` | Valid collection has no items | Explicit explanation and next action | Clear filters, browse parent, or create/submit where current workflow allows | `READY`, `NO-RESULTS`, or `LOADING` |
| `UI-STATE-NO-RESULTS` | Search/filter returns no matching items | Query/filter remains visible with no-result explanation | Revise or clear query/filter | `LOADING`, `READY`, or `EMPTY` |
| `UI-STATE-STALE-PARTIAL` | Cached/partial content is shown while refresh or dependency data is incomplete | Existing content remains visible with stale/incomplete indication | Retry/refresh; safe read actions remain available | `READY` or `ERROR-RECOVERABLE` |
| `UI-STATE-ERROR-RECOVERABLE` | Query/mutation/import/export fails | Human-readable error and affected context | Retry, correct, cancel, or return | `LOADING`, `READY`, or prior `DIRTY` state |
| `UI-STATE-AUTH-REQUIRED` | An action or route requires a missing session | Login requirement and route/action context | Log in or return to public surface | `READY`, `PERMISSION-DENIED`, or `ERROR-RECOVERABLE` |
| `UI-STATE-PERMISSION-DENIED` | Session lacks the required role | Explicit denial; no privileged data/action exposed | Return or authenticate with an allowed role | Public `READY` or authenticated allowed state |
| `UI-STATE-DIRTY` | Local edit, reorder preview, or draft change differs from saved/server state | Dirty/pending indicator and affected selection/context | Continue editing, save/submit, reset, or leave with confirmation | `SUBMITTING`, `READY`, `ERROR-RECOVERABLE`, or confirmed discard |
| `UI-STATE-SUBMITTING` | Save, draft, review, import, export, delete, or reset mutation is in flight | Progress/pending status for the specific action | Duplicate submission disabled; cancellation only where current API supports it | `READY`, `PENDING-REVIEW`, `REVIEW-OUTCOME`, `ERROR-RECOVERABLE`, or `DIRTY` |
| `UI-STATE-PENDING-REVIEW` | Draft submission succeeds and awaits editor review | Pending status, author/context, and next expected step | Continue browsing/editing where allowed; editor can review | `REVIEW-OUTCOME` or remain pending |
| `UI-STATE-REVIEW-OUTCOME` | Editor approves or rejects a draft | Applied/rejected status and refreshed affected content | Return to queue/detail/quest | `READY`, `PENDING-REVIEW`, or `ERROR-RECOVERABLE` |
| `UI-STATE-UNAVAILABLE-DEPENDENCY` | API, upstream log service, or required data source is unavailable | Dependency-specific unavailable message; no false freshness | Retry or return; no browser credential fallback | `LOADING`, `READY`, or `ERROR-RECOVERABLE` |

### Key transitions

| From | Event | Guard | To | Observable effect |
| --- | --- | --- | --- | --- |
| `READY` | Submit global search | Query is non-empty after trimming | `LOADING` → `READY`/`NO-RESULTS` | URL becomes `/search?q=...&lang=...`; language remains visible |
| `READY` | Open quest result or line anchor | Target exists | `LOADING` → `READY` | Quest context, highlight, and anchor are preserved |
| `READY` | Begin edit | Role/action is allowed | `DIRTY` after change | Selected line/tree context remains visible |
| `DIRTY` | Navigate/reset/close | User has not confirmed discard | `DIRTY` | Existing unsaved guard blocks the transition |
| `DIRTY` | Save/submit | Required data valid | `SUBMITTING` | Action becomes pending and duplicate submission is disabled |
| `SUBMITTING` | Draft save succeeds | API confirms success | `PENDING-REVIEW` or `READY` | Status/toast/banner updates and relevant data refreshes |
| `SUBMITTING` | Mutation fails | Error is recoverable | `ERROR-RECOVERABLE` or `DIRTY` | Error is actionable; local work remains available |
| `READY` | Editor opens draft | Session has editor permission | `LOADING` → `READY` | Original-versus-draft detail and review actions appear |
| `READY` | Approve/reject draft | Confirmation accepted | `SUBMITTING` → `REVIEW-OUTCOME` | Queue and affected quest state refresh |
| Any | Open admin logs | Session is admin | `LOADING` → `READY` | Operations dashboard appears |
| Any | Open admin logs | Session is anonymous/editor | `AUTH-REQUIRED` or `PERMISSION-DENIED` | No admin data or service credential is exposed |
| Any | Open narrow viewport menu | Menu control is operable | Menu open/closed | All routes/actions remain reachable and focus remains recoverable |

## 7. Responsive and platform contract

The repository's existing CSS profiles are the specification basis:

| Profile | Required behavior |
| --- | --- |
| Base / 320px minimum | No horizontal page overflow; readable wrapping; primary actions reachable; global search remains available; technical IDs remain selectable. |
| `>=48rem` | Wider heading/content treatment and increased reading/workspace room may apply without changing information order or action availability. |
| `>=64rem` | Desktop masthead exposes Browse and Work controls; multi-pane workbench and sticky tool regions may be used. |
| `>=80rem` | Expanded shell/content constraints may apply; content remains readable rather than stretching indefinitely. |
| Hover-capable pointer | Hover may add affordance, but cannot replace labels, focus, or keyboard operation. |
| Reduced motion | Remove/reduce translation, shimmer, and decorative transitions while preserving state change and feedback. |

For all profiles:

- mobile disclosure preserves every route and role-gated action;
- workbench panes may stack, collapse, or scroll internally, but primary actions remain available;
- long Chinese, English, Japanese, and Indonesian strings wrap without corrupting structure;
- tables, diffs, IDs, and source references remain readable/selectable;
- primary touch targets are at least 44px.

## 8. Accessibility and input contract

- Use semantic landmarks for shell, navigation, search, main content, workbench regions, and operations tables.
- Every icon-only action has an accessible name; visible labels remain preferred for primary actions.
- Search, disclosure menu, dialogs, filters, tabs, tree selection, line forms, approval/rejection, import/export, and download controls are keyboard-operable.
- Focus is visible against every Sentinel surface, follows logical reading order, enters transient surfaces predictably, and returns to the invoking control after close.
- Dialogs and confirmations expose their purpose, consequence, and available cancel/confirm actions; focus cannot escape an active modal interaction.
- Loading, mutation progress, success, error, pending, review outcome, and permission changes are exposed as perceivable text/status, not color alone.
- Existing keyboard shortcuts remain unchanged; shortcut help remains discoverable from work surfaces.
- Selected tree lines, edited lines, review marks, and status chips have non-color indicators.
- Reduced motion follows `prefers-reduced-motion`.
- Technical text remains selectable and copyable.

Accessibility verification is required; repository inspection alone does not claim WCAG compliance.

## 9. Visual and design-system contract

The authoritative visual source is [`design.md`](../../../design.md), implemented through [`tokens.css`](../../../tokens.css) and [`web/src/index.css`](../../../web/src/index.css).

Required visual behavior:

- Near-black blue Sentinel ground with flat panel surfaces and hairline structural rules.
- Cyan signal for focus, active, selected, links, and primary action.
- Success, warning, error, and informational colors remain sparse and are paired with text/shape.
- Manrope for interface/reading text and JetBrains Mono for IDs, counts, source references, and statuses.
- Reading surfaces have calm measure and low visual competition.
- Translator/editor surfaces use compact controls, selected-row signal, sticky tools, and clear diff/status treatment.
- Admin logs use dense tables, mono data, tabular numbers, text-plus-shape status chips, and restrained cyan chart emphasis.
- Avoid gradients, glassmorphism, emoji icons, decorative looping animation, rainbow line semantics, and generic card-grid presentation.
- No exact Figma or screenshot pixel target exists; verification is against the documented hierarchy, tokens, semantic states, and responsive contract.

## 10. Data, permission, trust, and reliability contract

- Data-dependent controls remain unavailable until the required data and permission state are known.
- Existing React Query/API boundaries may be replaced internally, but visible behavior must retain loading, refresh, mutation confirmation, and error semantics.
- Do not introduce new optimistic success claims where the current workflow waits for API confirmation.
- Preserve local author label and draft context according to current session behavior.
- Preserve editor/admin distinction: `editor` can review editor drafts; `admin` can access admin logs; editor access does not imply admin access.
- Admin service credentials remain server-side and are never placed in query parameters, local storage, page data, or browser-held configuration.
- Log dashboard failure identifies the unavailable dependency and permits retry/return without exposing upstream credentials.
- Large quests remain virtualized and navigable by line anchor; the UI must not require rendering every dialogue row simultaneously.
- Existing gzip, stripped payload, and cache behavior remains verifiable through the current manual procedure.

## 11. Verification seams

| Seam | Level | Behavior observed | Precedent and environment | Automation status |
| --- | --- | --- | --- | --- |
| `S-ROUTE-MANUAL` | Route-level browser journey | Shell, browse, search, viewer, translator, editor, drafts, auth, admin logs, responsive behavior | `bash scripts/run-dev.sh`; browser walkthrough | Manual; no browser E2E framework is configured |
| `S-WORKFLOW-TEST` | Public workflow/client seam | Translator and admin-log workflow helpers, formatting, route/permission-related client behavior | `bun run test:web`; `web/tests/translatorWorkflow.test.ts`, `web/tests/adminLogsWorkflow.test.ts` | Automated blocking |
| `S-API-AUTH` | API/auth seam | Session roles, draft/review API behavior, admin proxy denial/allowance, upstream failure handling | `uv run pytest -q app` | Automated blocking |
| `S-EDITOR-MANUAL` | Route-level manual journey | Anonymous draft, editor approval, tree reorder, keyboard shortcuts, unsaved guard, viewer regression | `web/src/__manual__/editor-flow.md`; `bash scripts/manual-editor-test.sh` | Manual blocking for UI acceptance |
| `S-PERFORMANCE-MANUAL` | Route/network/browser seam | Quest 1 large data, render latency, gzip, cache, anchors, search, scrolling, editor performance | `web/src/__manual__/quest-perf.md` | Manual blocking for performance acceptance |
| `S-BUILD` | Delivery seam | Typecheck and production bundle | `bun run build` from `WuwaID/quests` | Automated blocking |
| `S-VISUAL-A11Y-MANUAL` | Browser visual/input walkthrough | Sentinel hierarchy, 320/48/64/80rem profiles, keyboard, focus, reduced motion, non-color status | Existing manual quality contract; no visual/a11y runner configured | Automation gap; manual required |

No browser automation, visual-regression runner, accessibility runner, or browser matrix is configured. This is an explicit automation gap, not an implied pass.

## 12. Verification matrix

| Requirement | Seam | Method | Profile or fixture | Gate |
| --- | --- | --- | --- | --- |
| `UI-REQ-001`–`UI-REQ-005` | `S-ROUTE-MANUAL` | Browser journey | All routes; public and authenticated sessions | Blocking manual |
| `UI-REQ-006`–`UI-REQ-008` | `S-ROUTE-MANUAL` | Browse/viewer walkthrough | Normal quest and deep line anchor/search | Blocking manual |
| `UI-REQ-009`–`UI-REQ-014` | `S-WORKFLOW-TEST`, `S-EDITOR-MANUAL` | Automated workflow tests plus manual editor flow | Translator/editor, anonymous draft, pending review, reorder | Blocking |
| `UI-REQ-015`–`UI-REQ-019` | `S-API-AUTH`, `S-ROUTE-MANUAL` | Pytest/API verification plus denial/allowance walkthrough | Anonymous, editor, admin; missing/bad upstream credential | Blocking |
| `UI-REQ-020`–`UI-REQ-025` | `S-VISUAL-A11Y-MANUAL` | Manual responsive and keyboard walkthrough | 320px, 48rem, 64rem, 80rem; reduced motion; keyboard-only | Blocking manual; automation gap |
| `UI-REQ-026` | `S-VISUAL-A11Y-MANUAL` | Visual contract review | Sentinel dark surface, reading/work/operations states | Blocking manual; automation gap |
| `UI-REQ-027`–`UI-REQ-028` | `S-PERFORMANCE-MANUAL` | Manual network/render/scroll checks | Quest 1 (45,292 lines), normal side quest, main quest, editor | Blocking manual |
| All changed behavior | `S-BUILD` | Typecheck and production build | `WuwaID/quests/` | Blocking |

## 13. Acceptance criteria

- **UI-AC-001** [`UI-REQ-001`, `UI-REQ-002`]: Given any existing route URL, when the rebuilt frontend loads, then the same route and capability are reachable without a URL migration and the shell identifies its Browse, Work, or Operations context.
- **UI-AC-002** [`UI-REQ-003`, `UI-REQ-004`]: Given a reader on any route, when they select a language and submit global search, then the search route contains the query/language context and exposes a usable loading, result, no-result, or error state.
- **UI-AC-003** [`UI-REQ-006`–`UI-REQ-008`]: Given a matching quest result, when the reader opens it and selects a line anchor or query highlight, then the viewer presents readable multilingual dialogue, speaker/structure context, and selectable technical references.
- **UI-AC-004** [`UI-REQ-009`–`UI-REQ-012`]: Given a translator/editor changes a line or reorderable block, when they search, select, edit, reset, save, or navigate away, then tree/context behavior, draft state, reorder guards, and unsaved confirmation match the specified transitions.
- **UI-AC-005** [`UI-REQ-013`, `UI-REQ-014`]: Given an authenticated editor opens a pending draft, when they filter, inspect, approve, reject, cancel, or encounter a failed mutation, then original-versus-draft context and explicit review outcome remain visible without silent data loss.
- **UI-AC-006** [`UI-REQ-015`–`UI-REQ-019`]: Given anonymous, editor, and admin sessions, when each attempts public, editor, or admin actions, then only the allowed actions are available and denied admin requests never expose a service credential.
- **UI-AC-007** [`UI-REQ-017`, `UI-REQ-018`]: Given loading, empty, stale, success, pending, rejected, permission, or dependency-failure conditions, when the user observes or retries the surface, then the state is explicit, non-color-only, actionable, and does not claim false success.
- **UI-AC-008** [`UI-REQ-020`–`UI-REQ-025`]: Given 320px, 48rem, 64rem, and 80rem profiles plus keyboard-only and reduced-motion input, when the user operates shell, menus, dialogs, search, workbench, and primary actions, then no required action disappears, focus remains visible/recoverable, and no horizontal overflow occurs at 320px.
- **UI-AC-009** [`UI-REQ-026`]: Given reading, workbench, and operations states, when the visual review is performed against `design.md` and existing tokens, then Sentinel hierarchy, typography, status treatment, density, and motion rules are followed without decorative exceptions.
- **UI-AC-010** [`UI-REQ-027`, `UI-REQ-028`]: Given Quest 1-sized data and the existing performance procedure, when the reader loads, searches, anchors, scrolls, and opens editor mode, then the documented render, gzip, cache, and responsiveness checks remain within the current manual thresholds.
- **UI-AC-011** [All requirements]: Given the changed frontend, when `bun run test:web`, `uv run pytest -q app`, and `bun run build` run from `WuwaID/quests`, then all blocking automated gates pass and the required manual checklists are completed.

## 14. Implementation questions intentionally deferred

- Exact component boundaries and public component interfaces.
- Exact token additions or exceptions needed to express the settled Sentinel hierarchy.
- State ownership and query-cache details where the public behavior remains unchanged.
- Exact copy for new empty/error/stale announcements, subject to the product/design vocabulary.
- Whether a future browser automation or visual/accessibility runner should be added; this is an automation/tooling decision, not a product decision.
- Rollout and migration sequencing after the UI slice is decomposed.

## 15. Handoff

Component design is recorded in Section 16. The next handoff is `/implement-frontend`. Implementation must preserve the route, permission, state, responsive, accessibility, visual, trust, and verification contracts above and must not turn this specification into a file-by-file task plan.

## 16. Component design

### Design basis

This design serves `UI-REQ-001` through `UI-REQ-028`, the five journeys, and the state/transition model above. It is a module design, not a file layout. A boundary is justified only when it owns a product concept, lifecycle, invariant, accessibility behavior, or real variation point.

The current frontend has several deep feature coordinators, but they also own tree transformation, selection, draft persistence, mutations, layout, and modal state together. The rebuild should improve locality without replacing one large route component with many pass-through wrappers.

### Current responsibility inventory

| Current module | Current responsibility | State or behavior currently visible | Design finding |
| --- | --- | --- | --- |
| Application shell | Route wrapper, search submission, browse/work links, role-gated links, draft badge, import modal, mobile disclosure | URL query/language, menu open state, import open state, session role, draft-count query | Keep one shell coordinator, but move meaningful search, navigation, and workflow behavior behind domain seams. |
| Quest reading route | Quest query, virtualized dialogue rows, anchors/highlights, role actions, export/delete mutations | Server quest data, URL query/hash, modal state, mutation status | Separate the large-list reading behavior from route-level data and consequential actions. |
| Translator route | Quest/category queries, tree derivation/filtering, selected line, local drafts, mutation, pane sizing, shortcuts | Server state, selected line, search/filter, local draft state, pane preference | Keep as a feature coordinator; give tree, workbench layout, and translation editing clear owners. |
| Structural editor route | Translator responsibilities plus selection sets, reorder preview, structural mutations | Selected IDs, reorder preview, filters, dirty state, mutation status | Keep separate from translator workflow; share mechanics, not a universal mode-heavy coordinator. |
| Dialogue tree | Tree rendering, filtering, expansion, selection, keyboard interaction, drag/drop and reorder preview | Expanded/drag/hover interaction and selection callbacks | Make this a deep domain component with a finite interaction contract. |
| Translation and line forms | Field editing, validation, options, local draft/review behavior, submit callbacks | Field draft, validation, local persistence, glossary/findings, pending state | Each form owns its form invariant and emits product outcomes instead of exposing field-level remote control. |
| Drafts route | Queue filters, selected detail, diff rendering, approve/reject/delete/export/purge mutations | URL draft selection, filters, server queue/detail, confirmation state | Split queue/detail/diff responsibilities while keeping review mutations in one feature coordinator. |
| Admin logs route | Admin guard, active/uploads/history tabs, filters, selected upload/file, downloads, error state | Tab, search, range, selection, query/mutation status | Keep one operations coordinator with independently owned tab-panel data and presentation. |
| API/auth/session adapters | Typed HTTP, session role, author label, local draft persistence, keyboard helpers | Server state and durable client state | Remain the external-state seams; UI modules must not recreate competing copies. |
| Existing primitives | Toasts, error boundary, skeletons, confirmation/dialogs, resize handle, shortcut help | Focus/dialog lifecycle, announcements, visual loading, resize mechanics | Reuse and harden these seams before introducing new primitives. |

### Proposed module map

| Module | Responsibility and depth | Interface shape | Authoritative state | Verification seam |
| --- | --- | --- | --- | --- |
| `ApplicationShell` | Coordinates route-aware shell composition, session access, draft summary, import workflow entry, and mode visibility. It does not render route-specific workbench internals. | Composition receives route content; shell children expose semantic outcomes such as search intent, import request, and logout request. | URL query/language remains owned by the router; session/draft summary remains server state; import visibility is shell workflow state. | Shell route journey, auth/manual navigation walkthrough. |
| `ResponsiveNavigation` | Owns Browse/Work/Operations disclosure behavior, menu lifecycle, keyboard focus, and visibility of role-gated links. | Receives a semantic navigation model and current location; emits only meaningful menu/request outcomes, not DOM step callbacks. | Menu open/focus state is local ephemeral state; role/access comes from `ApplicationShell`. | `UI-REQ-002`, `UI-REQ-015`, `UI-REQ-020`–`UI-REQ-025` manual seam. |
| `GlobalSearch` | Owns search input draft, trimming/submit semantics, labels, busy/disabled feedback, and keyboard behavior. | `query`, `language`, `busy/disabled`, and one `onSubmit({ query, language })` outcome. External URL changes reset/reconcile the input. | Router owns committed query/language; the component owns only ephemeral input draft. | Search route journey and shell accessibility walkthrough. |
| `QuestReadingFeature` | Coordinates quest route params, server data, role actions, export/delete workflows, and viewer state without owning row-measurement internals. | Route-level feature; child regions receive normalized quest/viewer data and semantic action outcomes. | Query/cache and URL query/hash are authoritative; modal/mutation intent is feature state. | Viewer route journey, API tests, performance manual. |
| `DialogueStream` | Owns virtualization, row measurement, anchor reveal, long-list scrolling, line semantics, and search-highlight rendering. | Receives normalized rows, active/highlight context, viewport contract, and `onLineAction` outcome. It does not fetch or mutate API data. | Virtualization/measurement/scroll position are local ephemeral state; selected/highlight context comes from the feature coordinator. | Quest 1 performance procedure and viewer journey. |
| `TranslationWorkbench` | Coordinates translator route queries, tree model, selected line, filters, local draft workflow, submission, pane layout, and shortcut outcomes. | Composes `WorkbenchLayout`, `DialogueTree`, `TranslationEditor`, `DraftStatus`, and shortcut/dialog regions. Emits only route-level completion/error outcomes. | Server queries plus route qid are coordinator state; selection/filter and draft workflow are owned here or by the dedicated draft controller below. | Translator workflow test and editor manual flow. |
| `StructuralEditorWorkbench` | Coordinates structural editor queries, selected IDs, reorder preview, line editing, pending reorder drafts, reset, save, and unsaved protection. | Shares workbench composition but exposes structural outcomes such as `onReorderCommit`, `onResetPreview`, and `onSubmitPatch`. | Reorder preview and selected IDs are editor-workflow state; server data remains query/cache state. | Editor manual flow: drag/drop, keyboard, reset, save, viewer regression. |
| `WorkbenchLayout` | Owns responsive pane composition, sticky toolbar/status regions, resize mechanics, persistence of pane preference, and narrow-screen focus/order changes. | Named composition regions: `toolbar`, `status`, `tree`, `detail`; a semantic layout identity for persistence; no API/auth props. | Pane width/mode and resize focus are local/durable UI state; feature content remains child-owned. | Responsive manual seam at 320px/48rem/64rem/80rem and keyboard walkthrough. |
| `DialogueTree` | Owns tree semantics, expand/collapse, keyboard navigation, row focus, filtering presentation, and drag interaction when the finite reorder variant is enabled. | `nodes`, controlled `selection`, controlled `filters`, `interaction: select | reorder`, `onSelectionChange`, `onFiltersChange`, and semantic `onReorder` outcomes. | Parent owns selection/filter values; tree owns expanded IDs, drag target, hover, and focus mechanics. | Public route/workbench journeys, not private row DOM tests. |
| `TranslationEditor` | Owns translation field invariants, local draft restoration/autosave, glossary/findings presentation, field validation, shortcut focus, and submit intent. | Receives source line/server draft context and mutation status; emits `onSubmit(draft)`, `onNavigate(direction)`, and `onRequestShortcuts()`. | Local draft store is authoritative for uncommitted translation work; server draft/query remains external state. | Translator workflow test plus anonymous draft/manual checks. |
| `StructuralLineEditor` | Owns structural line/options form validation, preview semantics, and line-level submit/delete/cancel outcomes. | Receives selected line and preview context; emits semantic `onSubmit(patch)`, `onDelete`, and `onCancel` events. | Form draft/validation is local to this domain component; editor coordinator owns persistence and mutation status. | Editor manual flow and backend mutation tests. |
| `DraftStatus` | Owns local-draft change subscription, pending/saved/error presentation, and recovery-oriented status text. | Receives a quest/category identity; no parent field-by-field callbacks. | Local draft store/event stream is authoritative; banner derives its visible status. | Editor/translator manual flow and local-draft workflow tests. |
| `DraftReviewWorkspace` | Coordinates draft route selection, role access, queue/detail queries, filters, review mutations, confirmations, and refresh. | Route-level feature; composes queue, detail, diff, and confirmation regions with semantic review outcomes. | URL draft ID, review filters, and server draft cache have one owner at this feature boundary. | Draft review journey, `bun run test:web`, backend auth/review tests. |
| `DraftQueue` | Renders/filter-operates the queue and exposes selection/filter outcomes without owning review mutations. | `items`, `filters`, `selectedId`, status metadata, `onFiltersChange`, `onSelect`. | Filter interaction can be local to the queue only if the workspace does not need it; otherwise workspace owns the value. The chosen implementation must have one owner. | Draft route journey and workflow tests. |
| `DraftDetail` and `DiffView` | Present original-versus-draft context, patch fields, status, and review actions with explicit consequence. | Receives one draft and review state; emits `onApprove`, `onReject`, `onDelete`, `onExport`, and `onClose` outcomes. | Workspace owns mutation status and confirmation intent; diff rendering owns no server state. | Draft review journey and manual approval flow. |
| `AdminLogsWorkspace` | Coordinates admin access, active/uploads/history mode, search/range, selected upload/file, refresh, download, and dependency errors. | Route-level feature; tab panels receive typed data/status and emit selection/retry/download intents. | Admin role/session and selected cross-tab context belong to workspace; each panel owns only its query presentation/lifecycle. | Admin logs workflow test, API auth tests, admin manual route journey. |
| `ActivePlayersPanel`, `UploadExplorer`, `HistoryPanel` | Own independent operations-table/chart presentation, empty/loading/error states, and tab-specific interaction. | Typed data/status plus semantic row/file/range outcomes; no service-token or auth internals. | Tab-specific server query state is local to its panel or domain adapter; shared selection remains workspace-owned. | Admin logs route and workflow seam. |
| Existing dialog/toast/error/resize primitives | Own generic focus, confirmation, announcement, fallback, loading, and resize mechanics. | Small semantic interfaces with stable accessibility behavior; callers send intent and receive outcomes. | Dialog open/confirmation intent stays with the feature coordinator; focus/announcement mechanics stay inside the primitive. | Manual keyboard/accessibility seam and existing tests. |

### State ownership

| State | Category | Authoritative owner | Readers | Writers | Persistence/lifecycle | Reason |
| --- | --- | --- | --- | --- | --- | --- |
| Route, query, hash, language, draft ID | Navigation | Router/history | Shell, route coordinator, search/viewer | Navigation outcomes only | URL/history/refresh | Deep links and return context must survive component lifecycles. |
| Session role and authentication | Server/host state | Session access adapter/query | Shell, route coordinators, protected panels | Login/logout outcomes | Signed session cookie and query invalidation | A single role source prevents editor/admin drift. |
| Quest/category server data | Server state | Domain query adapter/cache | Viewer, tree, forms, review panels | API mutation outcomes | Query cache/refresh | Do not copy server data into competing component state. |
| Global search input draft | Ephemeral interaction | `GlobalSearch` | Search input only | User typing | Reset/reconcile on committed URL change | The shell needs the submitted intent, not every keystroke. |
| Workbench selected line/IDs | Workflow/navigation | Translator/editor coordinator | Tree, form, status, shortcut help | Tree selection outcomes and route restoration | Feature lifecycle; restore only from existing route/workflow contract | Selection coordinates tree, detail, keyboard, and reorder invariants. |
| Workbench search/filter | Derived/workflow state | Translator/editor coordinator | Tree, counts, action availability | Filter outcomes | Feature lifecycle | Active search must disable editor reorder and preserve context. |
| Tree expansion/focus/drag target | Ephemeral interaction | `DialogueTree` | Tree rows and focus model | Keyboard/pointer interaction | Tree lifecycle; selected ancestor auto-expands | These mechanics do not need to leak into the route coordinator. |
| Translation local draft | Durable client/draft state | Local draft store/controller | Translation editor, draft status, review context | Form submit/autosave/reset | Local storage keyed by content identity | One recoverable owner prevents form/banner disagreement. |
| Server draft/review status | Server/workflow state | Draft/review coordinator and query cache | Queue, detail, shell badge, quest/editor | Confirmed API mutations | Server persistence and invalidation | Pending/applied/rejected status must not be fabricated locally. |
| Structural reorder preview | Workflow/preview state | Structural editor coordinator | Tree, preview banner, save/reset actions | Semantic reorder outcome/reset | Until reset, save, navigation guard, or failure | The preview is intentional draft state, not a second server copy. |
| Pane mode/width | Durable client UI state | `WorkbenchLayout` | Layout regions | Resize/disclosure interaction | Existing preference persistence | Layout mechanics should not be mixed into domain drafts. |
| Mobile menu open/focus | Ephemeral interaction | `ResponsiveNavigation` | Menu/toggle | Disclosure keyboard/pointer actions | Current shell lifecycle | Menu focus and close behavior belongs with the disclosure. |
| Admin active tab and cross-tab selection | Feature workflow state | `AdminLogsWorkspace` | Tab panels, inspector/download controls | Tab/upload/file/range outcomes | Route lifecycle; preserve only if current behavior requires | Cross-tab selection must not be duplicated in each panel. |
| Toast/confirmation visibility | Ephemeral workflow state | Feature coordinator for intent; primitive for focus/announcement | Dialog/toast primitive | User/API outcome | Until dismiss/confirm/cancel | The parent owns what action is pending; the primitive owns how it is announced. |

### Invariants

1. There is exactly one authoritative selected line/selection set for each workbench; tree and detail render that state rather than competing copies.
2. Server data is never copied into local state except as an explicit local draft, structural preview, or other intentional transaction.
3. A dirty translation/editor state is either recoverable through the local draft/preview owner or blocked by the unsaved-change guard before it can be discarded.
4. Active editor search/filter state disables reorder and invalid structural drops are ignored.
5. A selected nested tree item remains reachable: its ancestor expansion is restored when the tree is collapsed/refreshed.
6. Role gating is enforced at the feature/adapter boundary and reflected in visible actions; child presentation cannot grant permission.
7. Admin service credentials never enter component props, browser storage, URL state, or downloaded page data.
8. Workbench responsive changes may move or collapse regions but cannot remove primary or role-gated actions.
9. Dialogs return focus to their invoking control; dynamic state feedback is announced through the existing toast/status conventions.
10. A review outcome is shown only after the API confirms it; failed mutations preserve the reviewable state.

### Interface sketches

These sketches express behavioral seams, not final TypeScript or file names.

#### Global search

```text
GlobalSearch(
  query,
  language,
  busy,
  disabled,
  onSubmit({ query, language })
)
```

The component owns input editing, trimming, submit-key behavior, accessible naming, and busy/disabled feedback. The shell owns committed URL navigation. It must not expose callbacks for every internal field or route step.

#### Responsive workbench layout

```text
WorkbenchLayout(
  layoutId,
  toolbar,
  status,
  tree,
  detail
)
```

Named regions are the composition contract. The layout owns responsive stacking/collapse, sticky regions, resize mechanics, focusable divider behavior, and pane preference persistence. It does not know about quests, drafts, roles, or API mutations.

#### Dialogue tree

```text
DialogueTree(
  nodes,
  selection,
  filters,
  interaction: "select" | "reorder",
  onSelectionChange(selection),
  onFiltersChange(filters),
  onReorder(change)    // only for the reorder variant
)
```

The tree owns expansion, row focus, drag targets, and keyboard mechanics. The workbench owns selected values and workflow consequences. `onReorder` reports a semantic change, not pointer coordinates or internal drag steps.

#### Translation editor

```text
TranslationEditor(
  sourceLine,
  persistedDraft,
  glossary,
  status,
  onSubmit(draft),
  onNavigate(direction),
  onRequestShortcuts()
)
```

The editor owns field validation, local-draft restoration/autosave, focus, and translation-specific form invariants. The workbench owns server mutation and route-level completion/error handling.

#### Draft review detail

```text
DraftDetail(
  draft,
  reviewState,
  onApprove(),
  onReject(),
  onDelete(),
  onExport(),
  onClose()
)
```

The detail surface owns review presentation and accessible action semantics. The workspace owns confirmation intent, mutation status, cache invalidation, and route selection.

### Boundary alternatives and decisions

#### Workbench architecture

**Option A — shared mechanical layout plus separate feature coordinators (chosen).**

`TranslationWorkbench` and `StructuralEditorWorkbench` share `WorkbenchLayout`, `DialogueTree`, status/dialog primitives, and responsive mechanics, while each owns its own server workflow, draft semantics, and invariants. This gives callers a small composition contract and keeps translator/editor changes local.

**Option B — one universal editor coordinator with a large `mode`/boolean configuration.**

Rejected. Translator and structural editing have different mutation, selection, reorder, and draft invariants. A universal mode would create boolean combinations, leak role/workflow details into every child, and make invalid states representable.

#### Tree state ownership

**Option A — workbench controls selection/filter; tree controls expansion/drag/focus (chosen).**

This keeps selection synchronized with the detail pane and lets the editor disable reorder when search is active, while the tree hides mechanical interaction complexity.

**Option B — uncontrolled tree with imperative parent commands.**

Rejected. Imperative refs would make focus, selection, filtering, and reorder guards harder to verify and would duplicate the route coordinator's workflow state.

#### Shared visual components

**Option A — reuse existing primitives and deepen domain components (chosen).**

Keep the existing toast, error boundary, skeleton, dialog, resize, and shortcut seams; improve their accessibility and visual contract while extracting only meaningful workbench/viewer/review behavior.

**Option B — introduce a new universal component library or prop-driven design system.**

Rejected. The repository already has Sentinel tokens/primitives, and hypothetical reuse would add interface and migration cost without a confirmed second consumer.

#### Route extraction

**Option A — retain feature coordinators and extract only deep responsibilities (chosen).**

This keeps route-level journeys as stable verification seams while moving virtualization, tree interaction, workbench mechanics, review detail, and tab-specific operations behind coherent interfaces.

**Option B — split every route into small visual fragments.**

Rejected. File size alone is not a boundary; shallow wrappers would increase prop wiring and leave state ownership unclear.

### Migration sequence

The redesign need not be atomic, but each stage must preserve the public route and workflow contract:

1. Establish characterization coverage at the route, workflow, auth, editor-manual, and performance seams before changing ownership.
2. Stabilize/reuse the existing dialog, toast, error, skeleton, resize, and shortcut accessibility primitives.
3. Introduce the shell/search/navigation ownership and verify all route/role links before replacing page presentation.
4. Migrate the reading stream and large-list behavior behind `DialogueStream`; verify anchors, highlights, states, and performance.
5. Introduce `WorkbenchLayout` and the controlled selection/filter contract, then migrate translator and structural editor independently.
6. Move local draft, form, review, and reorder invariants behind their domain owners; verify unsaved/recovery paths before removing duplicated route logic.
7. Migrate draft review and admin operations tab-by-tab using their public route journeys.
8. Run responsive, keyboard, reduced-motion, visual, CI, editor, and performance verification; remove only abstractions proven to be pass-through or duplicated.

### Verification impact

| Proposed boundary | Primary verification | Lower-level verification needed |
| --- | --- | --- |
| `ApplicationShell`, `ResponsiveNavigation`, `GlobalSearch` | Shell route journey across public/editor/admin sessions and 320px/desktop profiles | Focus/menu/search interaction checks only where the route journey cannot observe them |
| `DialogueStream` | Quest viewer journey and Quest 1 performance manual | Row-level tests only for a proven pure transformation; do not couple tests to virtualizer DOM internals |
| `WorkbenchLayout` | Translator/editor journey at 320px, 48rem, 64rem, and 80rem plus keyboard walkthrough | Resize/persistence test only if the public journey cannot observe recovery |
| `DialogueTree` | Translator/editor manual journey: selection, search, expand, keyboard, reorder | Pure tree-model tests for filtering/reorder invariants; no pointer-coordinate tests |
| `TranslationEditor` and `StructuralLineEditor` | Anonymous draft/editor manual journey and workflow tests | Focused validation/model tests for patch/draft invariants |
| `DraftStatus`, `DraftReviewWorkspace`, `DraftDetail`, `DiffView` | Draft approval journey and backend review tests | Diff transformation tests where they are pure and stable |
| `AdminLogsWorkspace` and tab panels | Admin route journey, admin workflow test, and API auth tests | Formatting/filter tests only for pure functions |
| Dialog/toast/error/shortcut primitives | Existing keyboard/manual accessibility seam | Small public interaction tests when current coverage is insufficient |

Blocking gates remain `bun run test:web`, `uv run pytest -q app`, and `bun run build` from `WuwaID/quests`. The editor-flow and quest-performance walkthroughs remain required manual gates for the affected UI. Browser E2E, visual regression, and automated accessibility remain explicit automation gaps.
