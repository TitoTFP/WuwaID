# Editor Mode for wuwaid-quests — Design

**Date:** 2026-06-02
**Status:** Approved (pending user review of this document)
**Scope:** Add a browser-based editor to `wuwaid-quests` for full line-structure edits to quest dialogue, with an anonymous-drafts + editor-approval workflow.

---

## 1. Goals and non-goals

**Goals**
- Let anyone (no login) propose line-level edits to quest dialogue, stored as drafts.
- Let a small group of editors (single shared password) review and approve drafts.
- Approved edits merge into the viewer transparently, without rebuilding the source JSON.
- Support full line-structure edits: speaker, text (3 langs), type, state_key, options[] (with branch targets), add new lines, reorder, delete.

**Non-goals (out of scope for v1)**
- Editing flow structure (adding/removing flows or states), plot_mode changes, raw `actions[]` on flows.
- Translating into a fourth language (the editor is lang-agnostic — works on the existing 3).
- Multi-user concurrency UI (no live "X is editing this" indicator).
- Per-user accounts / per-editor audit trail.
- Reverting already-approved edits to live state (a draft can supersede one, but no `revert` endpoint).
- Mobile-first layout (desktop only; mobile not broken, just not optimized).

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Browser  (Vite + React + Tailwind, same stack as today)    │
│  /editor/:qid   /drafts   /login                            │
└────────────────────────┬────────────────────────────────────┘
                         │  /api/*  (existing CORS, existing proxy)
┌────────────────────────▼────────────────────────────────────┐
│  FastAPI  (app/main.py — add new routes only)               │
│   - reads: data/quests/<qid>.json + data/index.db           │
│   - writes: drafts (anon), edits (editor approval only)     │
│   - merge: apply edits on top of quest JSON for read path   │
└────────────┬──────────────────────────┬─────────────────────┘
             │                          │
       data/quests/*.json         data/index.db
       (read-only at runtime)     (quests, dialogue_idx, **drafts**, **edits**, **editor_session**)
```

The edit path is the only path that writes SQLite. Source JSON stays frozen. `scripts/build_index.py` continues to do its job; the new tables simply appear on a freshly built DB. A new `--with-edits` flag on `build_index.py` re-applies approved edits into the per-quest JSONs for export (round-tripping). Without it, the runtime merge is the only path.

---

## 3. Components

### 3.1 Backend (Python, in `app/`)

**`app/db.py`** — extend with:
- `apply_edits(qid: int, quest: dict) -> dict` — merge rows from `edits` table into a quest dict (the read-path merge).
- `list_lines_summary(qid: int) -> list[dict]` — for the editor left-pane (id, type, speaker, draft badge).
- `create_draft(...)`, `update_draft(...)`, `delete_draft(...)`.
- `list_drafts(*, scope: 'mine' | 'all', author_label: str | None)`.
- `get_draft_with_diff(draft_id: int) -> dict` — returns `{ draft, original, diff }`.
- `approve_draft(draft_id: int) -> None` — transactional: validate, write to `edits`, mark draft `withdrawn`.
- `reject_draft(draft_id: int) -> None` — mark `rejected`.
- `insert_line(qid: int, after_line_id: int, line: dict) -> int` — assign new id, append to `all_lines[]` at correct position, write a synthetic edit.
- `reorder_line(qid: int, line_id: int, after_line_id: int | None) -> None` — move within `all_lines[]`.

**`app/auth.py`** (new):
- `EDITOR_PASSWORD` env var, single shared.
- `secrets.compare_digest` constant-time check.
- Signed cookie session (`itsdangerous.URLSafeTimedSerializer` or stdlib `hmac` + `hashlib`).
- `require_editor` FastAPI dependency.
- `editor_session` table for revocation list (logout invalidates server-side).

**`app/main.py`** — add routes:
| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/editor/quest/{qid}` | any | Quest with edits already merged |
| GET | `/api/editor/quest/{qid}/lines` | any | Flat line list summary (left pane) |
| POST | `/api/editor/drafts` | any | Create draft (anon ok) |
| PUT | `/api/editor/drafts/{id}` | draft owner (or editor) | Update draft patch |
| DELETE | `/api/editor/drafts/{id}` | draft owner (or editor) | Discard draft |
| GET | `/api/drafts` | any (filtered) | List drafts (anon → own only) |
| GET | `/api/drafts/{id}` | any (filtered) | Fetch + diff vs original |
| POST | `/api/drafts/{id}/approve` | editor | Promote draft to edits |
| POST | `/api/drafts/{id}/reject` | editor | Mark draft rejected |
| POST | `/api/login` | any | Password login, sets cookie |
| POST | `/api/logout` | any | Clears session |
| GET | `/api/me` | any | `{ role: 'anon' \| 'editor' }` |

The existing `/api/quests/{qid}` and `/api/search` are **also** updated to merge edits, so the main viewer shows approved changes without redirecting to `/editor/...`.

### 3.2 Frontend (TypeScript, in `web/src/`)

New routes:
- `web/src/routes/EditorPage.tsx` — `/editor/:qid`, two-pane layout
- `web/src/routes/DraftsPage.tsx` — `/drafts`, queue + per-draft review
- `web/src/routes/LoginPage.tsx` — `/login`, password form

New components (under `web/src/components/editor/`):
- `LineList.tsx` — left pane, badge per line (`edited`, `draft-mine`, `draft-other`, `new`)
- `LineForm.tsx` — right pane, per-lang tabs + meta
- `LangTabs.tsx` — EN | ZH-HANS | JA | META tab strip
- `OptionsSubform.tsx` — `options[]` editor
- `ReorderButtons.tsx` — up/down per line in the list, plus "insert after"
- `DraftBanner.tsx` — "N pending for this quest · Review" banner on `/editor/:qid`
- `DiffField.tsx` — input with original value hint beneath
- `ConfirmDialog.tsx` — small modal for destructive actions

Library:
- `web/src/lib/api.ts` — extend with `editor.*`, `drafts.*`, `auth.*` namespaces
- `web/src/lib/types.ts` — add `Draft`, `DraftPatch`, `LineSummary`, `DiffField`, `EditRow`
- `web/src/lib/session.ts` — `author_label` random hash persisted in `localStorage` (uuid v4)

### 3.3 Schema (added to `index.db` in `scripts/build_index.py`)

```sql
CREATE TABLE edits (
  qid INTEGER NOT NULL,
  line_id INTEGER NOT NULL,
  type TEXT,
  state_key TEXT,
  speaker_en TEXT,
  speaker_zh_hans TEXT,
  speaker_ja TEXT,
  text_en TEXT,
  text_zh_hans TEXT,
  text_ja TEXT,
  options_json TEXT,           -- null = unchanged; else full options[] JSON
  approved_by TEXT NOT NULL,
  approved_at TEXT NOT NULL,
  PRIMARY KEY (qid, line_id)
);

CREATE TABLE drafts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  qid INTEGER NOT NULL,
  line_id INTEGER NOT NULL,    -- 0 = "new line" (insert)
  position_after INTEGER,      -- null for existing line; int for insert position
  patch_json TEXT NOT NULL,    -- sparse field overlay, same shape as one row of edits
  status TEXT NOT NULL,        -- 'pending' | 'rejected' | 'withdrawn' | 'applied'
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  author_label TEXT,           -- client-supplied uuid; 'anon' if absent
  note TEXT                    -- optional "why I'm editing this"
);
CREATE INDEX idx_drafts_status ON drafts(status);
CREATE INDEX idx_drafts_qid ON drafts(qid);
CREATE INDEX idx_drafts_author ON drafts(author_label);

CREATE TABLE editor_session (
  token TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
```

A "synthetic edit" for an inserted line uses `line_id = 0` in `edits` with a column-less convention: instead, the inserted line's full data is stored in a separate table. When `options_json` is set in `edits`, it **fully replaces** the line's `options[]` (no deep merge).

```sql
CREATE TABLE inserted_lines (
  qid INTEGER NOT NULL,
  line_id INTEGER NOT NULL,    -- assigned at insert time
  position_after INTEGER,      -- anchor in the original all_lines[]
  line_json TEXT NOT NULL,     -- full DialogueLine JSON
  approved_by TEXT NOT NULL,
  approved_at TEXT NOT NULL,
  PRIMARY KEY (qid, line_id)
);
```

A "reorder" is an entry in `inserted_lines` if it moves a freshly inserted line, or a separate `line_order` table for moving an existing one:

```sql
CREATE TABLE line_order (
  qid INTEGER NOT NULL,
  line_id INTEGER NOT NULL,
  position_after INTEGER,      -- new anchor
  approved_by TEXT NOT NULL,
  approved_at TEXT NOT NULL,
  PRIMARY KEY (qid, line_id)
);
```

`apply_edits` then performs: 1) overlay field edits onto existing lines, 2) splice in inserted lines at the right `position_after`, 3) apply `line_order` overrides to reorder existing lines. Order matters and is documented in `apply_edits`'s docstring.

---

## 4. Data flow

### 4.1 Read (existing viewer)

`/api/quests/{qid}` and `/api/search` → load `data/quests/<qid>.json` → `apply_edits(qid, quest_dict)` → return merged JSON. No change to the existing endpoint signatures; behavior is "approved edits are visible."

### 4.2 Anonymous editing

1. User opens `/editor/:qid`.
2. `GET /api/editor/quest/{qid}` returns the merged quest (same merge logic, possibly cached per-request).
3. `GET /api/editor/quest/{qid}/lines` returns the left-pane summary.
4. User clicks a line → right pane shows the form, prefilled with merged values.
5. User edits fields. Client keeps a working copy in component state; nothing is sent until "Save as draft."
6. User clicks "Save as draft" → `POST /api/editor/drafts` with `{ qid, line_id, patch_json }` and `X-Author-Label` header (the localStorage uuid).
7. Server validates (types, branch targets, state_key existence) and inserts a row in `drafts` with `status = 'pending'`.
8. The user sees their draft on `/drafts` (filtered by their `author_label`).

A user with `author_label = 'anon'` can still create drafts; they simply can't come back to edit them from a different device. The client warns once on first visit: "Saving drafts requires a local handle. We'll generate one for you."

### 4.3 Editor approval

1. Editor opens `/login`, enters `EDITOR_PASSWORD`.
2. `POST /api/login` checks password with `secrets.compare_digest`, creates a `editor_session` row, returns a signed cookie.
3. Editor opens `/drafts`. Sees all `pending` drafts (anonymous `author_label` is shown as `anon-<short hash>`).
4. Clicks a row → `/drafts/{id}` shows `{ draft, original, diff }` rendered side-by-side.
5. Editor clicks Approve → `POST /api/drafts/{id}/approve` runs in a transaction:
   - Re-validate against current quest state (line still exists, branch target still valid).
   - Insert into `edits` (or `inserted_lines` / `line_order` for structural changes).
   - Set draft `status = 'applied'`.
6. The viewer picks up the change on the next read (read path always re-merges).
7. Reject → `status = 'rejected'`. The draft is hidden from the pending list but kept for audit.

### 4.4 Insert new line

1. User clicks "Insert after #N" in `ReorderButtons`.
2. Client opens a blank `LineForm` with `line_id = 0`, `position_after = N`.
3. User fills type, state_key (defaults to `position_after`'s state), speaker, text, options.
4. "Save as draft" sends `POST /api/editor/drafts` with `line_id = 0`, `position_after = N`.
5. On approval, server picks a fresh `id = max(all_lines[].id) + 1`, writes to `inserted_lines`, and `apply_edits` splices it into `all_lines[]` at the right index.

### 4.5 Reorder

1. User clicks ↑ or ↓ on a line in `LineList`.
2. Client computes the new `position_after` (the line id that should appear immediately before).
3. "Save as draft" sends `POST /api/editor/drafts` with `{ qid, line_id, position_after: <new> }` and a `patch_json` of `{"_op": "reorder"}`.
4. On approval, server writes a `line_order` row. `apply_edits` rebuilds `all_lines[]` by applying the override position.

### 4.6 The merge algorithm (`apply_edits`)

Pseudocode:

```python
def apply_edits(qid: int, quest: dict) -> dict:
    # 1. Field overlay
    for row in SELECT * FROM edits WHERE qid = ?:
        line = find_line(quest, row.line_id)
        if line is None: continue  # stale, ignore
        for field in EDITABLE_FIELDS:
            if getattr(row, field) is not None:
                line[STORED_TO_JSON[field]] = getattr(row, field)
    # 2. Inserted lines (splice in by position_after; ties broken by approved_at, then line_id)
    for ins in SELECT * FROM inserted_lines WHERE qid = ? ORDER BY position_after, approved_at, line_id:
        anchor = find_line(quest, ins.position_after) or None
        idx = quest["all_lines"].index(anchor) + 1 if anchor else len(quest["all_lines"])
        quest["all_lines"].insert(idx, json.loads(ins.line_json))
    # 3. Reorder overrides. Each row says "line_id should appear immediately
    #    after the line with id=position_after". Walk the original order,
    #    skipping overridden lines at their original spot, and splice each
    #    follower in after its anchor (recursively, in case a chain forms).
    overrides = SELECT * FROM line_order WHERE qid = ?
    if overrides:
        by_id = {l["id"]: l for l in quest["all_lines"]}
        following: dict[int, list[dict]] = {}
        overridden_ids: set[int] = set()
        for row in overrides:
            overridden_ids.add(row.line_id)
            anchor = row.position_after
            if anchor is None:
                continue
            follower = by_id.get(row.line_id)
            if follower is None:
                continue
            following.setdefault(anchor, []).append(follower)
        new_order: list[dict] = []
        visited: set[int] = set()
        def _add(line):
            if line["id"] in visited:
                return
            visited.add(line["id"])
            new_order.append(line)
            for f in following.get(line["id"], []):
                _add(f)
        for line in quest["all_lines"]:
            if line["id"] in overridden_ids:
                continue
            _add(line)
        quest["all_lines"] = new_order
    return quest
```

The merge is **idempotent** (re-running it on a quest that already has all edits applied is a no-op, because the overlay matches the in-memory values).

---

## 5. Error handling

| Condition | Response |
|---|---|
| `EDITOR_PASSWORD` not set in env | Server starts; `POST /api/login` returns 503 with message "Editor login not configured" |
| Login wrong password | 401 with `WWW-Authenticate: Basic realm="editor"` (purely cosmetic) |
| Editor session expired (7 days) | 401; UI redirects to `/login` |
| Draft patch references invalid field | 422 with field name |
| Branch target line_id not in this quest | 422 with line id |
| `state_key` change to a non-existent state in the quest | 422 |
| Approving a draft whose target line was deleted by an earlier approved draft | 409 with `{"detail": "target line gone", "deleted_by_draft": <id>}` |
| Concurrent approval race | DB transaction with `SELECT ... FOR UPDATE` (or just `BEGIN IMMEDIATE` in SQLite); second approver gets 409 |
| `index.db` missing the new tables | Startup check; clear error pointing at `bun run build:index` |
| Anonymous user tries to update/delete a draft they don't own | 403 |
| Update/delete a draft whose status is not `pending` | 409 |
| Cookie tampered | Session lookup fails; treated as anon |

---

## 6. Testing

### 6.1 Backend (pytest)

- `app/test_apply_edits.py`
  - empty overlay → identity
  - single-field overlay
  - multi-field overlay
  - options overlay (full replacement, not merge — simpler)
  - insert at end (position_after = None)
  - insert after an existing line
  - reorder one line
  - reorder multiple lines (stable sort with cross-references)
  - stale edit (line_id no longer exists) is ignored
  - idempotency: re-running on already-merged quest is a no-op
- `app/test_drafts.py`
  - create draft, fetch, update, delete
  - anonymous draft creation works without session
  - anon can only see own drafts; editor sees all
  - approve writes edit row + sets draft `applied`
  - reject sets `rejected`
  - double-approve returns 409
  - approval with stale line target returns 409
  - branch-target validation rejects bad inputs
  - state_key validation rejects non-existent state
- `app/test_auth.py`
  - login with correct password sets cookie
  - login with wrong password returns 401
  - editor routes reject anon
  - editor routes accept logged-in editor
  - logout invalidates session
  - tampered cookie treated as anon

### 6.2 Frontend

- No formal test runner is set up. Add `web/src/__manual__/editor-flow.md` with a 10-step manual checklist for visual verification.
- Type checking: `tsc --noEmit` must pass.

### 6.3 End-to-end manual

- `curl` script in `scripts/manual-editor-test.sh` that:
  1. Logs in
  2. Creates a draft
  3. Fetches it
  4. Approves it
  5. Re-fetches `/api/quests/{qid}` and greps for the change

---

## 7. Configuration

- `EDITOR_PASSWORD` env var (required for approval; server starts without it but login returns 503)
- `SESSION_SECRET` env var for cookie signing (random fallback generated at startup; warns and logs a one-time line)
- `SESSION_DAYS` env var, default 7
- No new dependencies beyond what's already declared in `pyproject.toml` and `package.json` (add `itsdangerous` to `pyproject.toml` — already a FastAPI transitive, but pin explicitly).

---

## 8. Rollout

1. Build the new tables on the existing `index.db` (a one-shot migration step in `build_index.py`).
2. Add the new routes behind no flag — drafts/edits are inert until first draft is created.
3. Set `EDITOR_PASSWORD` in `.env` (gitignored) for the editor approval role.
4. Verify the viewer shows the merged quest on a quest with no edits (regression test).
5. Add a "Edit" link in the quest-page header (visible to all) that opens `/editor/:qid`.

---

## 9. Out-of-scope follow-ups (future)

- Per-user accounts + audit log per editor
- Diff hunks (word-level / character-level) in the review UI
- Bulk operations (apply many drafts at once)
- Export approved edits back to source JSON as the new ground truth (`build_index.py --with-edits`)
- Locking / "X is editing this" presence
- Mobile-optimized editor layout
