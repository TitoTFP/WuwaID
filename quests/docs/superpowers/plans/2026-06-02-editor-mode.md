# Editor Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a browser-based editor to `wuwaid-quests` that lets anonymous users propose full line-structure edits as drafts, and a small group of editors (single shared password) review and approve them. Approved edits merge into the viewer at read time.

**Architecture:** SQLite `edits`/`inserted_lines`/`line_order` overlay tables applied to per-quest JSON at read time via `apply_edits(qid, quest)`. Drafts live in a separate table; approval writes through to the overlay in a transaction. Auth: anonymous drafts (no login); editor role gated by signed cookie + env `EDITOR_PASSWORD`. Two new frontend routes: `/editor/:qid` (two-pane edit surface) and `/drafts` (review queue).

**Tech Stack:** Python 3.10+, FastAPI, SQLite (stdlib `sqlite3`), `itsdangerous` (cookie signing), pytest. Frontend: React 18 + Vite + Tailwind (existing).

**Spec:** `docs/superpowers/specs/2026-06-02-editor-mode-design.md`

---

## File Structure

**New files**
- `app/auth.py` — env password, signed cookie session, `require_editor` dep
- `app/test_apply_edits.py` — merge algorithm tests
- `app/test_drafts.py` — draft lifecycle tests
- `app/test_auth.py` — login/logout/gated routes tests
- `app/test_editor_routes.py` — editor surface tests
- `app/conftest.py` — shared pytest fixtures (temp DB, sample quest)
- `web/src/routes/EditorPage.tsx` — `/editor/:qid` two-pane
- `web/src/routes/DraftsPage.tsx` — `/drafts` review queue
- `web/src/routes/LoginPage.tsx` — `/login` password form
- `web/src/components/editor/LineList.tsx` — left pane
- `web/src/components/editor/LineForm.tsx` — right pane
- `web/src/components/editor/LangTabs.tsx` — EN/ZH-HANS/JA/META tabs
- `web/src/components/editor/OptionsSubform.tsx` — `options[]` editor
- `web/src/components/editor/ReorderButtons.tsx` — ↑/↓/insert
- `web/src/components/editor/DraftBanner.tsx` — pending-drafts banner
- `web/src/components/editor/DiffField.tsx` — input with original-hint
- `web/src/components/editor/ConfirmDialog.tsx` — small modal
- `web/src/lib/session.ts` — `author_label` localStorage helper
- `scripts/manual-editor-test.sh` — end-to-end curl walkthrough
- `web/src/__manual__/editor-flow.md` — manual checklist

**Modified files**
- `pyproject.toml` — add `itsdangerous`, `pytest` (dev group)
- `scripts/build_index.py` — create new tables in `index.db`; add `--with-edits` stub flag (deferred implementation, see spec §9)
- `app/db.py` — add `apply_edits`, draft CRUD, approve/reject
- `app/main.py` — add new routes; wrap existing read routes to merge
- `web/src/App.tsx` — add 3 new routes
- `web/src/lib/types.ts` — add `Draft`, `DraftPatch`, `LineSummary`, etc.
- `web/src/lib/api.ts` — add `editor.*`, `drafts.*`, `auth.*`
- `web/src/routes/QuestPage.tsx` — add "Edit" link in header

---

## Conventions

- **Run from repo root** unless a step says otherwise.
- **Backend tests:** `uv run pytest app/test_<name>.py -v`
- **Frontend type-check:** `cd web && npx tsc --noEmit`
- **Manual smoke after every backend task that changes API surface:** `curl http://localhost:8000/api/...` against a running `bun run dev`.
- **Commit after every task.** The `git` step in each task shows the exact `git add` + commit message. Don't squash across tasks.
- **No emoji, no extra commentary in code comments.** The codebase has none; match it.

---

## Task 1: Add dev dependencies (pytest + itsdangerous)

**Files:**
- Modify: `pyproject.toml`

- [ ] **Step 1: Add pytest + itsdangerous to pyproject.toml**

Replace the contents of `pyproject.toml` with:

```toml
[project]
name = "wuwaid-quests"
version = "0.1.0"
description = "Web viewer for exported Wuthering Waves quest dialogue"
requires-python = ">=3.10"
dependencies = [
    "fastapi>=0.115.0",
    "uvicorn[standard]>=0.32.0",
    "itsdangerous>=2.2.0",
]

[dependency-groups]
dev = [
    "pytest>=8.0.0",
    "httpx>=0.27.0",   # TestClient + AsyncClient for FastAPI
]

[tool.uv]
package = false
```

- [ ] **Step 2: Sync deps**

Run: `cd wuwaid-quests && uv sync`
Expected: install succeeds, `pytest` and `httpx` resolve.

- [ ] **Step 3: Verify pytest runs**

Run: `cd wuwaid-quests && uv run pytest --collect-only`
Expected: "no tests ran" (0 collected), exit 0. No import errors.

- [ ] **Step 4: Commit**

```bash
cd wuwaid-quests && git add pyproject.toml uv.lock
git commit -m "build(deps): add itsdangerous + pytest dev group"
```

---

## Task 2: Schema migration in build_index.py

**Files:**
- Modify: `scripts/build_index.py:176-258` (`build_fts` function)

- [ ] **Step 1: Add the new CREATE TABLE statements to `build_fts`**

In `scripts/build_index.py`, inside `build_fts(db_path: Path, quests: list[dict]) -> int:`, **after** the existing `CREATE TABLE quests` and its indexes, add the following SQL. Make sure each statement is run before `con.commit()`:

```python
    cur.execute("""
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
            options_json TEXT,
            approved_by TEXT NOT NULL,
            approved_at TEXT NOT NULL,
            PRIMARY KEY (qid, line_id)
        )
    """)
    cur.execute("""
        CREATE TABLE inserted_lines (
            qid INTEGER NOT NULL,
            line_id INTEGER NOT NULL,
            position_after INTEGER,
            line_json TEXT NOT NULL,
            approved_by TEXT NOT NULL,
            approved_at TEXT NOT NULL,
            PRIMARY KEY (qid, line_id)
        )
    """)
    cur.execute("""
        CREATE TABLE line_order (
            qid INTEGER NOT NULL,
            line_id INTEGER NOT NULL,
            position_after INTEGER,
            approved_by TEXT NOT NULL,
            approved_at TEXT NOT NULL,
            PRIMARY KEY (qid, line_id)
        )
    """)
    cur.execute("""
        CREATE TABLE drafts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            qid INTEGER NOT NULL,
            line_id INTEGER NOT NULL,
            position_after INTEGER,
            patch_json TEXT NOT NULL,
            status TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            author_label TEXT,
            note TEXT
        )
    """)
    cur.execute("CREATE INDEX idx_drafts_status ON drafts(status)")
    cur.execute("CREATE INDEX idx_drafts_qid ON drafts(qid)")
    cur.execute("CREATE INDEX idx_drafts_author ON drafts(author_label)")
    cur.execute("""
        CREATE TABLE editor_session (
            token TEXT PRIMARY KEY,
            created_at TEXT NOT NULL,
            expires_at TEXT NOT NULL
        )
    """)
```

- [ ] **Step 2: Add the `--with-edits` flag (stub for now)**

Replace the `main()` function in `scripts/build_index.py` with the version below. The flag parses, prints a "not yet implemented" message, and exits successfully without doing anything destructive:

```python
def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--source", help="Path to export_quest_ordered/")
    p.add_argument("--data-dir", default=str(DATA_DIR))
    p.add_argument(
        "--with-edits",
        action="store_true",
        help="Re-apply approved edits to per-quest JSONs (deferred; see spec §9)",
    )
    args = p.parse_args()

    data_dir = Path(args.data_dir).resolve()
    quests_dir = data_dir / "quests"
    db_path = data_dir / "index.db"

    if args.with_edits:
        print("--with-edits is not yet implemented (see spec §9).")
        print("Exiting without changes.")
        return 0

    source = resolve_source(args.source)
    print(f"Source : {source}")
    print(f"Data   : {data_dir}")

    print("Scanning quests...")
    quests = collect_quests(source)
    quests.sort(key=lambda q: (q.get("side", 0), q.get("chapter_id", 0), q.get("order", 0), q.get("quest_id", 0)))
    print(f"  found {len(quests)} quests")

    print("Aggregating chapters + speakers...")
    chapters, speakers = aggregate(quests)
    print(f"  {len(chapters)} chapters, {len(speakers)} unique speakers")

    print(f"Writing per-quest JSON to {quests_dir}...")
    if quests_dir.exists():
        shutil.rmtree(quests_dir)
    quests_dir.mkdir(parents=True, exist_ok=True)
    n = 0
    for q in quests:
        with (quests_dir / f"{q['quest_id']}.json").open("w", encoding="utf-8") as f:
            json.dump(q, f, ensure_ascii=False)
        n += 1
    print(f"  wrote {n} files")

    print("Building FTS5 index...")
    rows = build_fts(db_path, quests)
    print(f"  indexed {rows} lines")

    (data_dir / "chapters.json").write_text(
        json.dumps(chapters, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (data_dir / "speakers.json").write_text(
        json.dumps(speakers, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"  wrote chapters.json + speakers.json")
    print("Done.")
    return 0
```

- [ ] **Step 3: Verify the build still works**

Run: `cd wuwaid-quests && uv run python scripts/build_index.py 2>&1 | tail -10`
Expected: build completes; output includes "indexed N lines" where N > 0. Inspect with `sqlite3 data/index.db ".tables"` and confirm `edits`, `inserted_lines`, `line_order`, `drafts`, `editor_session` are listed.

- [ ] **Step 4: Commit**

```bash
cd wuwaid-quests && git add scripts/build_index.py
git commit -m "feat(schema): add editor overlay + drafts tables to index.db"
```

---

## Task 3: `apply_edits` merge algorithm — write tests first

**Files:**
- Create: `app/test_apply_edits.py`
- Create: `app/conftest.py`

- [ ] **Step 1: Create `app/conftest.py` with shared fixtures**

Create `app/conftest.py`:

```python
"""Shared pytest fixtures for the editor tests."""
from __future__ import annotations

import json
import os
import sqlite3
from pathlib import Path

import pytest


@pytest.fixture
def sample_quest() -> dict:
    """A minimal quest with 3 lines in one state, one option."""
    return {
        "quest_id": 106000002,
        "quest_name": "Test Quest",
        "quest_type": 1,
        "languages": ["en", "zh-Hans", "ja"],
        "total_lines": 3,
        "flows": [],
        "all_lines": [
            {
                "id": 1,
                "state_item_id": 1,
                "type": "Talk",
                "state_key": "Flow_1_1",
                "text_key": "t1",
                "speaker_en": "Rover",
                "speaker_zh-Hans": "漂泊者",
                "speaker_ja": "漂泊者",
                "text_en": "Hello.",
                "text_zh-Hans": "你好。",
                "text_ja": "こんにちは。",
                "options": [],
            },
            {
                "id": 2,
                "state_item_id": 2,
                "type": "Talk",
                "state_key": "Flow_1_2",
                "text_key": "t2",
                "speaker_en": "Chixia",
                "speaker_zh-Hans": "炽霞",
                "speaker_ja": "熾霞",
                "text_en": "Stay close.",
                "text_zh-Hans": "靠近点。",
                "text_ja": "近づいて。",
                "options": [],
            },
            {
                "id": 3,
                "state_item_id": 1,
                "type": "Option",
                "state_key": "Flow_1_3",
                "text_key": "t3",
                "speaker_en": "",
                "speaker_zh-Hans": "",
                "speaker_ja": "",
                "text_en": "Agree to help",
                "text_zh-Hans": "同意帮忙",
                "text_ja": "助けることに同意する",
                "options": [
                    {
                        "text_key": "t3opt1",
                        "text_en": "Yes",
                        "text_zh-Hans": "好",
                        "text_ja": "はい",
                        "plot_line_key": "Flow_1_5",
                    }
                ],
            },
        ],
        "chapter_id": 1,
        "chapter_name": "Jinzhou Rising",
        "side": 0,
    }


@pytest.fixture
def tmp_db(tmp_path: Path, sample_quest: dict) -> Path:
    """Create a temp index.db with the editor tables; return its path."""
    db_path = tmp_path / "index.db"
    con = sqlite3.connect(db_path)
    con.executescript("""
        CREATE TABLE edits (
            qid INTEGER NOT NULL, line_id INTEGER NOT NULL,
            type TEXT, state_key TEXT,
            speaker_en TEXT, speaker_zh_hans TEXT, speaker_ja TEXT,
            text_en TEXT, text_zh_hans TEXT, text_ja TEXT,
            options_json TEXT,
            approved_by TEXT NOT NULL, approved_at TEXT NOT NULL,
            PRIMARY KEY (qid, line_id)
        );
        CREATE TABLE inserted_lines (
            qid INTEGER NOT NULL, line_id INTEGER NOT NULL,
            position_after INTEGER, line_json TEXT NOT NULL,
            approved_by TEXT NOT NULL, approved_at TEXT NOT NULL,
            PRIMARY KEY (qid, line_id)
        );
        CREATE TABLE line_order (
            qid INTEGER NOT NULL, line_id INTEGER NOT NULL,
            position_after INTEGER,
            approved_by TEXT NOT NULL, approved_at TEXT NOT NULL,
            PRIMARY KEY (qid, line_id)
        );
        CREATE TABLE drafts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            qid INTEGER NOT NULL, line_id INTEGER NOT NULL,
            position_after INTEGER, patch_json TEXT NOT NULL,
            status TEXT NOT NULL,
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
            author_label TEXT, note TEXT
        );
    """)
    con.commit()
    con.close()
    # Point the app's db module at this file for the duration of the test
    from app import db
    db.set_db_path(db_path)
    yield db_path
    db.set_db_path(None)  # type: ignore[arg-type]
```

- [ ] **Step 2: Write `app/test_apply_edits.py`**

Create `app/test_apply_edits.py`:

```python
"""Tests for apply_edits merge algorithm."""
from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pytest

from app import db


def _insert_edit(db_path: Path, **fields) -> None:
    con = sqlite3.connect(db_path)
    con.execute(
        """INSERT INTO edits (qid, line_id, type, state_key,
            speaker_en, speaker_zh_hans, speaker_ja,
            text_en, text_zh_hans, text_ja, options_json,
            approved_by, approved_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (
            fields.get("qid", 106000002),
            fields["line_id"],
            fields.get("type"),
            fields.get("state_key"),
            fields.get("speaker_en"),
            fields.get("speaker_zh_hans"),
            fields.get("speaker_ja"),
            fields.get("text_en"),
            fields.get("text_zh_hans"),
            fields.get("text_ja"),
            fields.get("options_json"),
            fields.get("approved_by", "tester"),
            fields.get("approved_at", "2026-06-02T00:00:00Z"),
        ),
    )
    con.commit()
    con.close()


def _insert_line(db_path: Path, qid: int, line_id: int, position_after: int | None, line: dict) -> None:
    con = sqlite3.connect(db_path)
    con.execute(
        "INSERT INTO inserted_lines VALUES (?,?,?,?,?,?)",
        (qid, line_id, position_after, json.dumps(line), "tester", "2026-06-02T00:00:00Z"),
    )
    con.commit()
    con.close()


def _insert_order(db_path: Path, qid: int, line_id: int, position_after: int | None) -> None:
    con = sqlite3.connect(db_path)
    con.execute(
        "INSERT INTO line_order VALUES (?,?,?,?,?)",
        (qid, line_id, position_after, "tester", "2026-06-02T00:00:00Z"),
    )
    con.commit()
    con.close()


def test_empty_overlay_is_identity(tmp_db, sample_quest):
    out = db.apply_edits(106000002, sample_quest)
    assert [l["id"] for l in out["all_lines"]] == [1, 2, 3]
    assert out["all_lines"][0]["text_en"] == "Hello."


def test_single_field_overlay(tmp_db, sample_quest):
    _insert_edit(tmp_db, line_id=1, text_en="Howdy.")
    out = db.apply_edits(106000002, sample_quest)
    assert out["all_lines"][0]["text_en"] == "Howdy."
    assert out["all_lines"][0]["text_zh-Hans"] == "你好。"  # untouched
    assert out["all_lines"][0]["speaker_en"] == "Rover"


def test_multi_field_overlay(tmp_db, sample_quest):
    _insert_edit(tmp_db, line_id=2,
                 text_en="Stay close, the mist is thick.",
                 text_zh_hans="靠近点，雾很浓。",
                 speaker_en="Chixia (E)")
    out = db.apply_edits(106000002, sample_quest)
    assert out["all_lines"][1]["text_en"] == "Stay close, the mist is thick."
    assert out["all_lines"][1]["text_zh-Hans"] == "靠近点，雾很浓。"
    assert out["all_lines"][1]["speaker_en"] == "Chixia (E)"
    assert out["all_lines"][1]["speaker_zh-Hans"] == "炽霞"  # untouched


def test_options_full_replacement(tmp_db, sample_quest):
    new_opts = [
        {"text_key": "t3opt1", "text_en": "Sure!",
         "text_zh-Hans": "当然！", "text_ja": "もちろん！",
         "plot_line_key": "Flow_1_5"}
    ]
    _insert_edit(tmp_db, line_id=3, options_json=json.dumps(new_opts))
    out = db.apply_edits(106000002, sample_quest)
    assert out["all_lines"][2]["options"] == new_opts


def test_insert_at_end(tmp_db, sample_quest):
    new_line = {
        "id": 99, "state_item_id": 1, "type": "Talk",
        "state_key": "Flow_1_99", "text_key": "t99",
        "speaker_en": "Outro", "speaker_zh-Hans": "", "speaker_ja": "",
        "text_en": "End.", "text_zh-Hans": "完。", "text_ja": "終わり。",
        "options": [],
    }
    _insert_line(tmp_db, 106000002, 99, position_after=None, line=new_line)
    out = db.apply_edits(106000002, sample_quest)
    assert [l["id"] for l in out["all_lines"]] == [1, 2, 3, 99]


def test_insert_after_existing(tmp_db, sample_quest):
    new_line = {
        "id": 50, "state_item_id": 1, "type": "Talk",
        "state_key": "Flow_1_50", "text_key": "t50",
        "speaker_en": "", "speaker_zh-Hans": "", "speaker_ja": "",
        "text_en": "(beat)", "text_zh-Hans": "", "text_ja": "",
        "options": [],
    }
    _insert_line(tmp_db, 106000002, 50, position_after=2, line=new_line)
    out = db.apply_edits(106000002, sample_quest)
    assert [l["id"] for l in out["all_lines"]] == [1, 2, 50, 3]


def test_reorder_one_line(tmp_db, sample_quest):
    _insert_order(tmp_db, 106000002, 3, position_after=1)
    out = db.apply_edits(106000002, sample_quest)
    assert [l["id"] for l in out["all_lines"]] == [1, 3, 2]


def test_reorder_untouched_lines_keep_relative_order(tmp_db, sample_quest):
    _insert_order(tmp_db, 106000002, 1, position_after=2)
    out = db.apply_edits(106000002, sample_quest)
    assert [l["id"] for l in out["all_lines"]] == [2, 1, 3]


def test_stale_edit_ignored(tmp_db, sample_quest):
    _insert_edit(tmp_db, qid=106000002, line_id=999, text_en="ghost")
    out = db.apply_edits(106000002, sample_quest)
    assert out["all_lines"][0]["text_en"] == "Hello."


def test_idempotency(tmp_db, sample_quest):
    _insert_edit(tmp_db, line_id=1, text_en="Howdy.")
    once = db.apply_edits(106000002, sample_quest)
    twice = db.apply_edits(106000002, once)
    assert once == twice
    assert twice["all_lines"][0]["text_en"] == "Howdy."
```

- [ ] **Step 3: Run the tests, expect them to FAIL**

Run: `cd wuwaid-quests && uv run pytest app/test_apply_edits.py -v 2>&1 | tail -20`
Expected: import error or `AttributeError: module 'app.db' has no attribute 'apply_edits'`.

- [ ] **Step 4: Commit the failing tests**

```bash
cd wuwaid-quests && git add app/test_apply_edits.py app/conftest.py
git commit -m "test(editor): add apply_edits merge algorithm tests"
```

---

## Task 4: Implement `apply_edits` in `app/db.py`

**Files:**
- Modify: `app/db.py` (append at end)

- [ ] **Step 1: Add `apply_edits` to `app/db.py`**

Append the following to `app/db.py` (it stays in the same module — small, focused, and only used by the read path):

```python
# ---------------------------------------------------------------------------
# Editor: overlay merge
# ---------------------------------------------------------------------------

# Field-name translation: storage column -> JSON key in the line dict.
# (zh-Hans uses a hyphen in JSON; we use zh_hans in the SQL column for SQL-safety.)
_EDIT_FIELD_MAP = {
    "type": "type",
    "state_key": "state_key",
    "speaker_en": "speaker_en",
    "speaker_zh_hans": "speaker_zh-Hans",
    "speaker_ja": "speaker_ja",
    "text_en": "text_en",
    "text_zh_hans": "text_zh-Hans",
    "text_ja": "text_ja",
}


def apply_edits(qid: int, quest: dict) -> dict:
    """Merge approved edits/inserts/reorders into a quest dict.

    Mutates and returns `quest`. Idempotent: re-running on a quest that
    already reflects all edits is a no-op.
    """
    con = _con()
    try:
        # 1. Field overlay
        for row in con.execute(
            "SELECT * FROM edits WHERE qid = ?", (qid,)
        ).fetchall():
            line = next(
                (l for l in quest["all_lines"] if l.get("id") == row["line_id"]),
                None,
            )
            if line is None:
                continue  # stale, ignore
            for col, json_key in _EDIT_FIELD_MAP.items():
                if row[col] is not None:
                    line[json_key] = row[col]
            if row["options_json"] is not None:
                line["options"] = json.loads(row["options_json"])

        # 2. Inserted lines (splice in by position_after; ties broken by approved_at, line_id)
        insertions = con.execute(
            "SELECT * FROM inserted_lines WHERE qid = ? "
            "ORDER BY position_after, approved_at, line_id",
            (qid,),
        ).fetchall()
        for ins in insertions:
            new_line = json.loads(ins["line_json"])
            anchor_id = ins["position_after"]
            if anchor_id is None:
                idx = len(quest["all_lines"])
            else:
                anchor = next(
                    (l for l in quest["all_lines"] if l.get("id") == anchor_id),
                    None,
                )
                idx = (quest["all_lines"].index(anchor) + 1) if anchor else len(quest["all_lines"])
            quest["all_lines"].insert(idx, new_line)

        # 3. Reorder overrides. Stable sort by (overridden_position_after, original_index).
        overrides = con.execute(
            "SELECT line_id, position_after FROM line_order WHERE qid = ?", (qid,)
        ).fetchall()
        if overrides:
            orig_index = {l["id"]: i for i, l in enumerate(quest["all_lines"])}
            pos = {row["line_id"]: row["position_after"] for row in overrides}
            quest["all_lines"].sort(
                key=lambda l: (pos.get(l["id"], 10**9), orig_index[l["id"]])
            )

    finally:
        con.close()
    return quest
```

Note: the function uses `json.loads` — add `import json` at the top of `app/db.py` if it's not there already. (It already is — see existing import at line 4.)

- [ ] **Step 2: Run the tests, expect them to PASS**

Run: `cd wuwaid-quests && uv run pytest app/test_apply_edits.py -v`
Expected: 10 passed.

- [ ] **Step 3: Commit**

```bash
cd wuwaid-quests && git add app/db.py
git commit -m "feat(editor): implement apply_edits overlay merge"
```

---

## Task 5: Wire `apply_edits` into the existing viewer read path

**Files:**
- Modify: `app/main.py:80-85` (`api_quest`), `app/main.py:88-98` (`api_search`)

- [ ] **Step 1: Update `api_quest` to merge edits**

Replace the `api_quest` function in `app/main.py` with:

```python
@app.get("/api/quests/{qid}")
def api_quest(qid: int):
    p = QUESTS_DIR / f"{qid}.json"
    if not p.is_file():
        raise HTTPException(404, f"quest {qid} not found")
    quest = json.loads(p.read_text(encoding="utf-8"))
    return JSONResponse(db.apply_edits(qid, quest))
```

- [ ] **Step 2: Update `api_search` to merge per-result quest names + texts**

In `app/main.py`, replace `api_search` with a version that re-merges each result's quest before returning. Add a small helper at the top of the API section, just below `@app.get("/api/quests")`:

```python
def _merged_quest_meta(qid: int) -> tuple[str, str, dict[int, dict]]:
    """Load + merge a quest; return (quest_name, chapter_name, line_overrides)."""
    p = QUESTS_DIR / f"{qid}.json"
    if not p.is_file():
        return ("", "", {})
    quest = json.loads(p.read_text(encoding="utf-8"))
    db.apply_edits(qid, quest)
    overrides = {l["id"]: l for l in quest["all_lines"]}
    return (
        quest.get("quest_name", ""),
        quest.get("chapter_name", ""),
        overrides,
    )
```

Then replace `api_search` with:

```python
@app.get("/api/search")
def api_search(
    q: str = Query(..., min_length=1),
    lang: str = Query("en", pattern="^(en|zh|ja)$"),
    side: int | None = Query(None, ge=0, le=1),
    quest_type: int | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
):
    hits = db.search(q, lang=lang, side=side, quest_type=quest_type, limit=limit)
    # Group by qid to merge each quest once
    by_qid: dict[int, list[dict]] = {}
    for h in hits:
        by_qid.setdefault(h["qid"], []).append(h)
    for qid, group in by_qid.items():
        _, _, overrides = _merged_quest_meta(qid)
        for h in group:
            line = overrides.get(h["line_id"])
            if line is None:
                continue
            text = line.get(f"text_{lang}", "")
            if text:
                h["text"] = text
    return JSONResponse(hits)
```

- [ ] **Step 3: Smoke-test against the running app**

Run in two terminals:
1. `cd wuwaid-quests && bun run dev` (or just `bun run dev:api` for backend)
2. `curl -s http://localhost:8000/api/quests/106000002 | python3 -m json.tool | head -20`

Expected: 200 OK, JSON of the quest (unchanged when no edits exist).

- [ ] **Step 4: Commit**

```bash
cd wuwaid-quests && git add app/main.py
git commit -m "feat(editor): merge approved edits into existing viewer routes"
```

---

## Task 6: `app/auth.py` — env password, cookie sign, `require_editor`

**Files:**
- Create: `app/auth.py`
- Create: `app/test_auth.py`

- [ ] **Step 1: Write the failing tests**

Create `app/test_auth.py`:

```python
"""Tests for the editor auth surface (password + signed cookie)."""
from __future__ import annotations

import os
import sqlite3

import pytest
from fastapi.testclient import TestClient

from app import db
from app.auth import (
    SESSION_COOKIE,
    check_password,
    make_session_token,
    read_session_cookie,
)
from app.main import app


@pytest.fixture
def client(tmp_path, monkeypatch):
    db_path = tmp_path / "index.db"
    con = sqlite3.connect(db_path)
    con.executescript("""
        CREATE TABLE editor_session (
            token TEXT PRIMARY KEY,
            created_at TEXT NOT NULL,
            expires_at TEXT NOT NULL
        );
    """)
    con.commit()
    con.close()
    db.set_db_path(db_path)
    monkeypatch.setenv("EDITOR_PASSWORD", "s3cr3t")
    monkeypatch.setenv("SESSION_SECRET", "test-secret-1234567890")
    yield TestClient(app)
    db.set_db_path(None)  # type: ignore[arg-type]


def test_check_password_constant_time(monkeypatch):
    monkeypatch.setenv("EDITOR_PASSWORD", "s3cr3t")
    assert check_password("s3cr3t") is True
    assert check_password("wrong") is False


def test_check_password_unset_env(monkeypatch):
    monkeypatch.delenv("EDITOR_PASSWORD", raising=False)
    assert check_password("anything") is False


def test_make_and_read_session_roundtrip():
    tok = make_session_token("editor")
    assert read_session_cookie(tok) == "editor"


def test_read_session_cookie_rejects_tampered():
    assert read_session_cookie("not-a-real-token") is None


def test_login_wrong_password_returns_401(client):
    r = client.post("/api/login", json={"password": "wrong"})
    assert r.status_code == 401


def test_login_correct_password_sets_cookie(client):
    r = client.post("/api/login", json={"password": "s3cr3t"})
    assert r.status_code == 200
    assert SESSION_COOKIE in r.cookies
    assert r.json()["role"] == "editor"


def test_logout_clears_session(client):
    client.post("/api/login", json={"password": "s3cr3t"})
    r = client.post("/api/logout")
    assert r.status_code == 200
    me = client.get("/api/me")
    assert me.json()["role"] == "anon"


def test_me_endpoint_anon_when_unauthenticated(client):
    r = client.get("/api/me")
    assert r.status_code == 200
    assert r.json()["role"] == "anon"
```

- [ ] **Step 2: Run the tests, expect import failure**

Run: `cd wuwaid-quests && uv run pytest app/test_auth.py -v 2>&1 | tail -10`
Expected: `ModuleNotFoundError: No module named 'app.auth'`.

- [ ] **Step 3: Implement `app/auth.py`**

Create `app/auth.py`:

```python
"""Editor-role auth: single shared password + signed cookie session.

- `EDITOR_PASSWORD` env var (required for approval; if unset, login returns 503)
- `SESSION_SECRET` env var (used to sign the session cookie; random fallback
  generated at startup and logged once)
- `SESSION_DAYS` env var, default 7
"""
from __future__ import annotations

import hmac
import logging
import os
import secrets
import sqlite3
from datetime import datetime, timedelta, timezone

from fastapi import Cookie, Depends, HTTPException, Response, status
from itsdangerous import BadSignature, URLSafeTimedSerializer

from . import db

log = logging.getLogger("wuwaid-quests.auth")

SESSION_COOKIE = "wuwaid_editor"
SESSION_MAX_AGE_DAYS = int(os.environ.get("SESSION_DAYS", "7"))


def _secret() -> bytes:
    s = os.environ.get("SESSION_SECRET")
    if s:
        return s.encode("utf-8")
    fallback = secrets.token_hex(32)
    log.warning(
        "SESSION_SECRET not set; generated a one-time fallback. "
        "Sessions will not survive a server restart. Set SESSION_SECRET in .env."
    )
    return fallback.encode("utf-8")


def _serializer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(_secret(), salt="wuwaid-editor-session")


def check_password(submitted: str) -> bool:
    expected = os.environ.get("EDITOR_PASSWORD", "")
    if not expected:
        return False
    return hmac.compare_digest(submitted.encode("utf-8"), expected.encode("utf-8"))


def make_session_token(role: str) -> str:
    """Mint a session token, persist it in editor_session, return signed cookie value."""
    raw = secrets.token_urlsafe(32)
    con = db._con()  # noqa: SLF001 — internal helper, acceptable for auth
    try:
        now = datetime.now(timezone.utc)
        expires = now + timedelta(days=SESSION_MAX_AGE_DAYS)
        con.execute(
            "INSERT INTO editor_session VALUES (?, ?, ?)",
            (raw, now.isoformat(), expires.isoformat()),
        )
        con.commit()
    finally:
        con.close()
    return _serializer().dumps({"token": raw, "role": role})


def read_session_cookie(cookie_value: str) -> str | None:
    """Verify a signed cookie value, look up the token, return role or None."""
    try:
        payload = _serializer().loads(cookie_value, max_age=SESSION_MAX_AGE_DAYS * 86400)
    except BadSignature:
        return None
    raw = payload.get("token")
    if not raw:
        return None
    con = db._con()  # noqa: SLF001
    try:
        row = con.execute(
            "SELECT expires_at FROM editor_session WHERE token = ?", (raw,)
        ).fetchone()
    finally:
        con.close()
    if row is None:
        return None
    expires_at = datetime.fromisoformat(row["expires_at"])
    if expires_at < datetime.now(timezone.utc):
        return None
    return payload.get("role", "editor")


def get_role(cookie: str | None = Cookie(default=None, alias=SESSION_COOKIE)) -> str:
    if not cookie:
        return "anon"
    role = read_session_cookie(cookie)
    return role or "anon"


def require_editor(role: str = Depends(get_role)) -> str:
    if role != "editor":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "editor login required")
    return role


def revoke_session(cookie_value: str | None) -> None:
    if not cookie_value:
        return
    role = read_session_cookie(cookie_value)
    if not role:
        return
    try:
        payload = _serializer().loads(cookie_value, max_age=SESSION_MAX_AGE_DAYS * 86400)
    except BadSignature:
        return
    raw = payload.get("token")
    if not raw:
        return
    con = db._con()  # noqa: SLF001
    try:
        con.execute("DELETE FROM editor_session WHERE token = ?", (raw,))
        con.commit()
    finally:
        con.close()
```

- [ ] **Step 4: Add the login/logout/me routes**

In `app/main.py`, **first** update the import block at the top of the file. Replace the existing `from fastapi import ...` line with:

```python
from fastapi import Depends, FastAPI, HTTPException, Query, Request
```

And add a new top-level import, right after the existing `from . import db` line:

```python
from .auth import (
    SESSION_COOKIE,
    SESSION_MAX_AGE_DAYS,
    check_password,
    get_role,
    make_session_token,
    require_editor,
    revoke_session,
)
```

**Then** add the auth routes just after `api_search` and before the static-file section:

```python
# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------


@app.post("/api/login")
def api_login(payload: dict, response: Response):
    if not os.environ.get("EDITOR_PASSWORD"):
        raise HTTPException(503, "editor login not configured (EDITOR_PASSWORD unset)")
    if not check_password(str(payload.get("password", ""))):
        raise HTTPException(401, "wrong password")
    token = make_session_token("editor")
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=SESSION_MAX_AGE_DAYS * 86400,
        httponly=True,
        samesite="lax",
    )
    return {"role": "editor"}


@app.post("/api/logout")
def api_logout(request: Request, response: Response):
    raw = request.cookies.get(SESSION_COOKIE)
    revoke_session(raw)
    response.delete_cookie(SESSION_COOKIE)
    return {"role": "anon"}


@app.get("/api/me")
def api_me(role: str = Depends(get_role)):
    return {"role": role}
```

- [ ] **Step 5: Run the auth tests**

Run: `cd wuwaid-quests && uv run pytest app/test_auth.py -v`
Expected: 8 passed.

- [ ] **Step 6: Commit**

```bash
cd wuwaid-quests && git add app/auth.py app/test_auth.py app/main.py
git commit -m "feat(editor): add password auth + signed cookie session"
```

---

## Task 7: Draft CRUD functions in `app/db.py`

**Files:**
- Modify: `app/db.py` (append)
- Create: `app/test_drafts.py`

- [ ] **Step 1: Write the failing tests**

Create `app/test_drafts.py`:

```python
"""Tests for the draft lifecycle (create, fetch, list, update, delete, approve, reject)."""
from __future__ import annotations

import json
import sqlite3

import pytest

from app import db


def test_create_draft_returns_id(tmp_db):
    did = db.create_draft(
        qid=106000002,
        line_id=1,
        patch={"text_en": "Howdy."},
        author_label="alice",
        note="tighten greeting",
    )
    assert isinstance(did, int) and did > 0


def test_get_draft_returns_full_row(tmp_db):
    did = db.create_draft(qid=106000002, line_id=1, patch={"text_en": "Howdy."})
    d = db.get_draft(did)
    assert d is not None
    assert d["qid"] == 106000002
    assert d["line_id"] == 1
    assert d["status"] == "pending"
    assert json.loads(d["patch_json"]) == {"text_en": "Howdy."}


def test_update_draft_only_owner_or_editor(tmp_db):
    did = db.create_draft(qid=106000002, line_id=1, patch={}, author_label="alice")
    db.update_draft(did, author_label="alice", patch={"text_en": "Hey."})
    d = db.get_draft(did)
    assert json.loads(d["patch_json"]) == {"text_en": "Hey."}
    with pytest.raises(PermissionError):
        db.update_draft(did, author_label="mallory", patch={"text_en": "x"})
    # editor (no author_label match) can still update
    db.update_draft(did, author_label=None, patch={"text_en": "Howdy."})


def test_delete_draft_only_owner_or_editor(tmp_db):
    did = db.create_draft(qid=106000002, line_id=1, patch={}, author_label="alice")
    with pytest.raises(PermissionError):
        db.delete_draft(did, author_label="mallory")
    db.delete_draft(did, author_label="alice")
    assert db.get_draft(did) is None


def test_list_drafts_filtered_by_author(tmp_db):
    db.create_draft(qid=106000002, line_id=1, patch={}, author_label="alice")
    db.create_draft(qid=106000002, line_id=2, patch={}, author_label="bob")
    db.create_draft(qid=106000002, line_id=3, patch={}, author_label="alice")
    alice_drafts = db.list_drafts(scope="mine", author_label="alice")
    assert len(alice_drafts) == 2
    all_drafts = db.list_drafts(scope="all", author_label=None)
    assert len(all_drafts) == 3


def test_approve_draft_writes_edit_and_marks_applied(tmp_db):
    did = db.create_draft(
        qid=106000002,
        line_id=1,
        patch={"text_en": "Howdy."},
        author_label="alice",
    )
    db.approve_draft(did, approver="editor-bob")
    d = db.get_draft(did)
    assert d["status"] == "applied"
    # Edit row exists with the right value
    con = db._con()  # noqa: SLF001
    try:
        row = con.execute(
            "SELECT text_en, approved_by FROM edits WHERE qid = ? AND line_id = ?",
            (106000002, 1),
        ).fetchone()
    finally:
        con.close()
    assert row["text_en"] == "Howdy."
    assert row["approved_by"] == "editor-bob"


def test_double_approve_raises(tmp_db):
    did = db.create_draft(qid=106000002, line_id=1, patch={})
    db.approve_draft(did, approver="bob")
    with pytest.raises(ValueError, match="already processed"):
        db.approve_draft(did, approver="carol")


def test_reject_draft_marks_rejected(tmp_db):
    did = db.create_draft(qid=106000002, line_id=1, patch={})
    db.reject_draft(did, approver="bob")
    d = db.get_draft(did)
    assert d["status"] == "rejected"


def test_approve_stale_line_target_raises(tmp_db):
    # Line 999 does not exist in sample_quest
    did = db.create_draft(qid=106000002, line_id=999, patch={"text_en": "ghost"})
    with pytest.raises(ValueError, match="target line"):
        db.approve_draft(did, approver="bob")


def test_approve_validates_branch_target(tmp_db):
    # An options patch with a bad branch target should fail approval
    bad_opts = [{"text_en": "Yes", "plot_line_key": "Flow_999_9"}]
    did = db.create_draft(
        qid=106000002,
        line_id=3,
        patch={"options": bad_opts},
    )
    with pytest.raises(ValueError, match="branch target"):
        db.approve_draft(did, approver="bob")
```

- [ ] **Step 2: Run the tests, expect them to FAIL**

Run: `cd wuwaid-quests && uv run pytest app/test_drafts.py -v 2>&1 | tail -10`
Expected: `AttributeError: module 'app.db' has no attribute 'create_draft'`.

- [ ] **Step 3: Implement the draft functions in `app/db.py`**

Append the following to `app/db.py`:

```python
# ---------------------------------------------------------------------------
# Editor: drafts
# ---------------------------------------------------------------------------


def _now() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


def create_draft(
    qid: int,
    line_id: int,
    patch: dict,
    *,
    author_label: str | None = None,
    note: str | None = None,
    position_after: int | None = None,
) -> int:
    con = _con()
    try:
        now = _now()
        cur = con.execute(
            """INSERT INTO drafts
               (qid, line_id, position_after, patch_json, status,
                created_at, updated_at, author_label, note)
               VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?)""",
            (qid, line_id, position_after, json.dumps(patch), now, now,
             author_label, note),
        )
        con.commit()
        return int(cur.lastrowid)
    finally:
        con.close()


def get_draft(draft_id: int) -> dict | None:
    con = _con()
    try:
        row = con.execute("SELECT * FROM drafts WHERE id = ?", (draft_id,)).fetchone()
    finally:
        con.close()
    return dict(row) if row else None


def update_draft(
    draft_id: int,
    *,
    author_label: str | None,
    patch: dict,
) -> None:
    con = _con()
    try:
        row = con.execute("SELECT * FROM drafts WHERE id = ?", (draft_id,)).fetchone()
        if row is None:
            raise ValueError("draft not found")
        if row["status"] != "pending":
            raise ValueError(f"draft already {row['status']}")
        # Owner check: anon label must match, editor (author_label=None) bypasses
        is_editor = author_label is None
        if not is_editor and row["author_label"] != author_label:
            raise PermissionError("not your draft")
        con.execute(
            "UPDATE drafts SET patch_json = ?, updated_at = ? WHERE id = ?",
            (json.dumps(patch), _now(), draft_id),
        )
        con.commit()
    finally:
        con.close()


def delete_draft(draft_id: int, *, author_label: str | None) -> None:
    con = _con()
    try:
        row = con.execute("SELECT * FROM drafts WHERE id = ?", (draft_id,)).fetchone()
        if row is None:
            return
        is_editor = author_label is None
        if not is_editor and row["author_label"] != author_label:
            raise PermissionError("not your draft")
        if row["status"] != "pending":
            raise ValueError(f"draft already {row['status']}")
        con.execute("DELETE FROM drafts WHERE id = ?", (draft_id,))
        con.commit()
    finally:
        con.close()


def list_drafts(*, scope: str, author_label: str | None) -> list[dict]:
    """scope: 'mine' filters by author_label; 'all' returns everything pending."""
    con = _con()
    try:
        if scope == "mine":
            rows = con.execute(
                "SELECT * FROM drafts WHERE author_label = ? "
                "AND status = 'pending' ORDER BY created_at DESC",
                (author_label,),
            ).fetchall()
        else:
            rows = con.execute(
                "SELECT * FROM drafts WHERE status = 'pending' "
                "ORDER BY created_at DESC"
            ).fetchall()
    finally:
        con.close()
    return [dict(r) for r in rows]


# ---------------------------------------------------------------------------
# Editor: approve / reject
# ---------------------------------------------------------------------------


# Map a JSON-side patch key to its DB column.
_PATCH_TO_COLUMN = {
    "type": "type",
    "state_key": "state_key",
    "speaker_en": "speaker_en",
    "speaker_zh-Hans": "speaker_zh_hans",
    "speaker_zh_hans": "speaker_zh_hans",  # accept both
    "speaker_ja": "speaker_ja",
    "text_en": "text_en",
    "text_zh-Hans": "text_zh_hans",
    "text_zh_hans": "text_zh_hans",
    "text_ja": "text_ja",
}


def approve_draft(draft_id: int, *, approver: str) -> None:
    con = _con()
    try:
        row = con.execute("SELECT * FROM drafts WHERE id = ?", (draft_id,)).fetchone()
        if row is None:
            raise ValueError("draft not found")
        if row["status"] != "pending":
            raise ValueError(f"draft already {row['status']}")

        patch = json.loads(row["patch_json"])
        qid = row["qid"]
        line_id = row["line_id"]

        # If this is an insert (line_id == 0) with a position_after, materialize.
        if line_id == 0:
            _materialize_insert(con, qid, row["position_after"], patch, approver)
        elif patch.get("_op") == "reorder":
            _materialize_reorder(con, qid, line_id, row["position_after"], approver)
        else:
            _materialize_field_edit(con, qid, line_id, patch, approver)

        con.execute(
            "UPDATE drafts SET status = 'applied', updated_at = ? WHERE id = ?",
            (_now(), draft_id),
        )
        con.commit()
    finally:
        con.close()


def reject_draft(draft_id: int, *, approver: str) -> None:
    con = _con()
    try:
        row = con.execute("SELECT * FROM drafts WHERE id = ?", (draft_id,)).fetchone()
        if row is None:
            raise ValueError("draft not found")
        if row["status"] != "pending":
            raise ValueError(f"draft already {row['status']}")
        con.execute(
            "UPDATE drafts SET status = 'rejected', updated_at = ? WHERE id = ?",
            (_now(), draft_id),
        )
        con.commit()
    finally:
        con.close()


def _load_quest_lines(con, qid: int) -> list[dict]:
    """Read the quest's all_lines[] for validation purposes.

    Reads from the per-quest JSON on disk; we don't have a quest dict at this
    layer. Approval validates against the source-of-truth, not the in-memory
    merged copy.
    """
    p = Path(DB_PATH).parent / "quests" / f"{qid}.json"  # type: ignore[arg-type]
    if not p.is_file():
        return []
    return json.loads(p.read_text(encoding="utf-8")).get("all_lines", [])


def _materialize_field_edit(con, qid: int, line_id: int, patch: dict, approver: str) -> None:
    lines = _load_quest_lines(con, qid)
    if not any(l.get("id") == line_id for l in lines):
        raise ValueError(f"target line {line_id} gone")
    # Validate branch targets inside options, if present
    if "options" in patch and patch["options"] is not None:
        for opt in patch["options"]:
            pk = opt.get("plot_line_key")
            if pk:
                # plot_line_key matches either another line's plot_line_key or text_key
                if not any(l.get("plot_line_key") == pk or l.get("text_key") == pk for l in lines):
                    raise ValueError(f"branch target {pk!r} not in this quest")
    # Validate state_key change, if present
    if patch.get("state_key") is not None:
        if not any(l.get("state_key") == patch["state_key"] for l in lines):
            raise ValueError(f"state_key {patch['state_key']!r} not in this quest")
    # Build (column, value) pairs
    cols: dict[str, object] = {}
    for k, v in patch.items():
        if k == "options":
            cols["options_json"] = json.dumps(v)
        elif k in _PATCH_TO_COLUMN:
            cols[_PATCH_TO_COLUMN[k]] = v
    if not cols:
        return  # nothing to do
    cols["approved_by"] = approver
    cols["approved_at"] = _now()
    placeholders = ", ".join("?" for _ in cols)
    col_names = ", ".join(cols.keys())
    update_set = ", ".join(f"{c} = ?" for c in cols if c not in ("qid", "line_id"))
    values = list(cols.values())
    con.execute(
        f"INSERT INTO edits (qid, line_id, {col_names}) VALUES (?, ?, {placeholders}) "
        f"ON CONFLICT(qid, line_id) DO UPDATE SET {update_set}",
        [qid, line_id] + values,
    )


def _materialize_insert(con, qid: int, position_after: int | None, patch: dict, approver: str) -> None:
    lines = _load_quest_lines(con, qid)
    # Assign a fresh line_id = max(existing) + 1
    new_id = max((l.get("id", 0) for l in lines), default=0) + 1
    if "id" not in patch:
        patch = {**patch, "id": new_id}
    if "options" not in patch:
        patch["options"] = []
    con.execute(
        "INSERT INTO inserted_lines VALUES (?,?,?,?,?,?)",
        (qid, new_id, position_after, json.dumps(patch), approver, _now()),
    )


def _materialize_reorder(con, qid: int, line_id: int, position_after: int | None, approver: str) -> None:
    lines = _load_quest_lines(con, qid)
    if not any(l.get("id") == line_id for l in lines):
        raise ValueError(f"target line {line_id} gone")
    con.execute(
        "INSERT INTO line_order VALUES (?,?,?,?,?) "
        "ON CONFLICT(qid, line_id) DO UPDATE SET position_after = ?, "
        "approved_by = ?, approved_at = ?",
        (qid, line_id, position_after, approver, _now(),
         position_after, approver, _now()),
    )
```

- [ ] **Step 4: Run the tests, expect them to PASS**

Run: `cd wuwaid-quests && uv run pytest app/test_drafts.py -v`
Expected: 10 passed.

- [ ] **Step 5: Commit**

```bash
cd wuwaid-quests && git add app/db.py app/test_drafts.py
git commit -m "feat(editor): draft CRUD + approve/reject with validation"
```

---

## Task 8: Editor + drafts routes in `app/main.py`

**Files:**
- Modify: `app/main.py` (add routes)
- Create: `app/test_editor_routes.py`

- [ ] **Step 1: Write the failing tests**

Create `app/test_editor_routes.py`:

```python
"""Tests for the editor + drafts HTTP routes."""
from __future__ import annotations

import json
import sqlite3

import pytest
from fastapi.testclient import TestClient

from app import db
from app.main import app


@pytest.fixture
def client(tmp_path, monkeypatch):
    import shutil
    from pathlib import Path
    data_dir = tmp_path / "data"
    quests_dir = data_dir / "quests"
    quests_dir.mkdir(parents=True)
    # Copy the real sample quest from the repo so the routes can find it
    repo_quest = Path(__file__).parent.parent / "data" / "quests" / "106000002.json"
    if repo_quest.is_file():
        shutil.copy(repo_quest, quests_dir / "106000002.json")
    else:
        # Fallback minimal quest
        quest = {
            "quest_id": 106000002, "quest_name": "X", "quest_type": 1,
            "languages": ["en"], "total_lines": 1, "flows": [],
            "all_lines": [
                {"id": 1, "type": "Talk", "state_key": "F_1_1", "text_key": "t1",
                 "speaker_en": "R", "speaker_zh-Hans": "", "speaker_ja": "",
                 "text_en": "Hi.", "text_zh-Hans": "", "text_ja": "", "options": []}
            ],
            "chapter_id": 0, "chapter_name": "X", "side": 0,
        }
        (quests_dir / "106000002.json").write_text(json.dumps(quest), encoding="utf-8")

    db_path = data_dir / "index.db"
    con = sqlite3.connect(db_path)
    con.executescript("""
        CREATE TABLE edits (qid INTEGER NOT NULL, line_id INTEGER NOT NULL,
            type TEXT, state_key TEXT, speaker_en TEXT, speaker_zh_hans TEXT,
            speaker_ja TEXT, text_en TEXT, text_zh_hans TEXT, text_ja TEXT,
            options_json TEXT, approved_by TEXT NOT NULL, approved_at TEXT NOT NULL,
            PRIMARY KEY (qid, line_id));
        CREATE TABLE inserted_lines (qid INTEGER NOT NULL, line_id INTEGER NOT NULL,
            position_after INTEGER, line_json TEXT NOT NULL,
            approved_by TEXT NOT NULL, approved_at TEXT NOT NULL,
            PRIMARY KEY (qid, line_id));
        CREATE TABLE line_order (qid INTEGER NOT NULL, line_id INTEGER NOT NULL,
            position_after INTEGER, approved_by TEXT NOT NULL, approved_at TEXT NOT NULL,
            PRIMARY KEY (qid, line_id));
        CREATE TABLE drafts (id INTEGER PRIMARY KEY AUTOINCREMENT, qid INTEGER NOT NULL,
            line_id INTEGER NOT NULL, position_after INTEGER, patch_json TEXT NOT NULL,
            status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
            author_label TEXT, note TEXT);
        CREATE TABLE editor_session (token TEXT PRIMARY KEY,
            created_at TEXT NOT NULL, expires_at TEXT NOT NULL);
    """)
    con.commit()
    con.close()
    db.set_db_path(db_path)
    monkeypatch.setenv("EDITOR_PASSWORD", "s3cr3t")
    monkeypatch.setenv("SESSION_SECRET", "test-secret-1234567890")

    # Override QUESTS_DIR at runtime so the route's _merged_quest_meta works.
    from app import main as appmain
    monkeypatch.setattr(appmain, "QUESTS_DIR", quests_dir)

    yield TestClient(app)
    db.set_db_path(None)  # type: ignore[arg-type]


def _login(client) -> None:
    r = client.post("/api/login", json={"password": "s3cr3t"})
    assert r.status_code == 200


def test_get_editor_quest_returns_merged(client):
    r = client.get("/api/editor/quest/106000002")
    assert r.status_code == 200
    body = r.json()
    assert "all_lines" in body


def test_create_draft_anonymous(client):
    r = client.post(
        "/api/editor/drafts",
        json={"qid": 106000002, "line_id": 1, "patch": {"text_en": "Howdy."}},
        headers={"X-Author-Label": "alice-uuid"},
    )
    assert r.status_code == 200
    assert "id" in r.json()


def test_list_drafts_anon_sees_own_only(client):
    client.post(
        "/api/editor/drafts",
        json={"qid": 106000002, "line_id": 1, "patch": {"text_en": "x"}},
        headers={"X-Author-Label": "alice"},
    )
    client.post(
        "/api/editor/drafts",
        json={"qid": 106000002, "line_id": 1, "patch": {"text_en": "y"}},
        headers={"X-Author-Label": "bob"},
    )
    r = client.get("/api/drafts", headers={"X-Author-Label": "alice"})
    assert r.status_code == 200
    assert len(r.json()) == 1


def test_list_drafts_editor_sees_all(client):
    _login(client)
    client.post(
        "/api/editor/drafts",
        json={"qid": 106000002, "line_id": 1, "patch": {"text_en": "x"}},
        headers={"X-Author-Label": "alice"},
    )
    r = client.get("/api/drafts")
    assert r.status_code == 200
    assert len(r.json()) == 1


def test_approve_requires_editor(client):
    # Create a draft anonymously
    cr = client.post(
        "/api/editor/drafts",
        json={"qid": 106000002, "line_id": 1, "patch": {"text_en": "Howdy."}},
        headers={"X-Author-Label": "alice"},
    )
    did = cr.json()["id"]
    # Anon attempt -> 401
    r = client.post(f"/api/drafts/{did}/approve")
    assert r.status_code == 401
    # Editor -> 200
    _login(client)
    r = client.post(f"/api/drafts/{did}/approve")
    assert r.status_code == 200
    # Re-fetch the quest and verify the edit is applied
    r2 = client.get("/api/quests/106000002")
    line1 = next(l for l in r2.json()["all_lines"] if l["id"] == 1)
    assert line1["text_en"] == "Howdy."


def test_drafts_route_validates_branch_target(client):
    _login(client)
    r = client.post(
        "/api/editor/drafts",
        json={
            "qid": 106000002, "line_id": 1,
            "patch": {"options": [{"text_en": "Yes", "plot_line_key": "GHOST_999"}]},
        },
        headers={"X-Author-Label": "alice"},
    )
    did = r.json()["id"]
    r2 = client.post(f"/api/drafts/{did}/approve")
    assert r2.status_code == 422
```

- [ ] **Step 2: Run the tests, expect them to FAIL (404 or import issues)**

Run: `cd wuwaid-quests && uv run pytest app/test_editor_routes.py -v 2>&1 | tail -20`
Expected: 404s on the new routes.

- [ ] **Step 3: Add the editor + drafts routes to `app/main.py`**

In `app/main.py`, add the following routes **after the `api_search` block** and **before the auth block**:

```python
# ---------------------------------------------------------------------------
# Editor: lines + drafts
# ---------------------------------------------------------------------------


@app.get("/api/editor/quest/{qid}")
def api_editor_quest(qid: int):
    p = QUESTS_DIR / f"{qid}.json"
    if not p.is_file():
        raise HTTPException(404, f"quest {qid} not found")
    quest = json.loads(p.read_text(encoding="utf-8"))
    return JSONResponse(db.apply_edits(qid, quest))


@app.get("/api/editor/quest/{qid}/lines")
def api_editor_quest_lines(qid: int):
    p = QUESTS_DIR / f"{qid}.json"
    if not p.is_file():
        raise HTTPException(404, f"quest {qid} not found")
    quest = json.loads(p.read_text(encoding="utf-8"))
    db.apply_edits(qid, quest)
    # Mark which lines have a live edit
    con = db._con()  # noqa: SLF001
    try:
        edited = {
            r["line_id"]
            for r in con.execute("SELECT line_id FROM edits WHERE qid = ?", (qid,)).fetchall()
        }
    finally:
        con.close()
    items = [
        {
            "id": l.get("id"),
            "type": l.get("type"),
            "state_key": l.get("state_key"),
            "speaker_en": l.get("speaker_en", ""),
            "text_en": l.get("text_en", ""),
            "is_edited": l.get("id") in edited,
        }
        for l in quest["all_lines"]
    ]
    return JSONResponse(items)


def _author_label(request: Request) -> str | None:
    return request.headers.get("X-Author-Label") or None


@app.post("/api/editor/drafts")
def api_create_draft(payload: dict, request: Request):
    qid = int(payload["qid"])
    line_id = int(payload["line_id"])
    patch = payload.get("patch", {})
    if not isinstance(patch, dict):
        raise HTTPException(422, "patch must be an object")
    position_after = payload.get("position_after")
    if position_after is not None:
        position_after = int(position_after)
    did = db.create_draft(
        qid=qid,
        line_id=line_id,
        patch=patch,
        author_label=_author_label(request),
        note=payload.get("note"),
        position_after=position_after,
    )
    return {"id": did}


@app.put("/api/editor/drafts/{draft_id}")
def api_update_draft(draft_id: int, payload: dict, request: Request):
    db.update_draft(
        draft_id,
        author_label=_author_label(request),
        patch=payload.get("patch", {}),
    )
    return {"ok": True}


@app.delete("/api/editor/drafts/{draft_id}")
def api_delete_draft(draft_id: int, request: Request):
    db.delete_draft(draft_id, author_label=_author_label(request))
    return {"ok": True}


@app.get("/api/drafts")
def api_list_drafts(request: Request, role: str = Depends(get_role)):
    if role == "editor":
        return JSONResponse(db.list_drafts(scope="all", author_label=None))
    return JSONResponse(
        db.list_drafts(scope="mine", author_label=_author_label(request))
    )


@app.get("/api/drafts/{draft_id}")
def api_get_draft(draft_id: int, request: Request, role: str = Depends(get_role)):
    d = db.get_draft(draft_id)
    if d is None:
        raise HTTPException(404, "draft not found")
    if role != "editor" and d["author_label"] != _author_label(request):
        raise HTTPException(403, "not your draft")
    return JSONResponse(d)


@app.post("/api/drafts/{draft_id}/approve")
def api_approve_draft(draft_id: int, _role: str = Depends(require_editor)):
    try:
        db.approve_draft(draft_id, approver=_role)
    except ValueError as e:
        msg = str(e)
        if "branch target" in msg:
            raise HTTPException(422, msg)
        if "target line" in msg:
            raise HTTPException(409, msg)
        if "already" in msg:
            raise HTTPException(409, msg)
        raise HTTPException(400, msg)
    return {"ok": True}


@app.post("/api/drafts/{draft_id}/reject")
def api_reject_draft(draft_id: int, _role: str = Depends(require_editor)):
    db.reject_draft(draft_id, approver=_role)
    return {"ok": True}
```

- [ ] **Step 4: Run the tests, expect them to PASS**

Run: `cd wuwaid-quests && uv run pytest app/test_editor_routes.py -v`
Expected: 6 passed.

- [ ] **Step 5: Run the entire backend test suite**

Run: `cd wuwaid-quests && uv run pytest -v`
Expected: 34 passed (10 apply_edits + 10 drafts + 8 auth + 6 routes). Fix any failures before moving on.

- [ ] **Step 6: Commit**

```bash
cd wuwaid-quests && git add app/main.py app/test_editor_routes.py
git commit -m "feat(editor): add editor + drafts HTTP routes"
```

---

## Task 9: Frontend types + api + session

**Files:**
- Modify: `web/src/lib/types.ts`
- Modify: `web/src/lib/api.ts`
- Create: `web/src/lib/session.ts`

- [ ] **Step 1: Extend `web/src/lib/types.ts`**

Append to `web/src/lib/types.ts`:

```typescript
// Editor mode types (mirrors app/db.py)

export type DraftStatus = "pending" | "applied" | "rejected" | "withdrawn";

export type EditableField =
  | "type"
  | "state_key"
  | "speaker_en"
  | "speaker_zh-Hans"
  | "speaker_ja"
  | "text_en"
  | "text_zh-Hans"
  | "text_ja"
  | "options";

/** Sparse overlay: only the fields being changed. */
export type DraftPatch = Partial<{
  type: string;
  state_key: string;
  speaker_en: string;
  "speaker_zh-Hans": string;
  speaker_ja: string;
  text_en: string;
  "text_zh-Hans": string;
  text_ja: string;
  options: DialogueLineOption[];
  _op: "reorder";
}>;

export interface Draft {
  id: number;
  qid: number;
  line_id: number;
  position_after: number | null;
  patch_json: string;       // JSON-encoded DraftPatch
  status: DraftStatus;
  created_at: string;
  updated_at: string;
  author_label: string | null;
  note: string | null;
}

export interface LineSummary {
  id: number;
  type: string;
  state_key: string;
  speaker_en: string;
  text_en: string;
  is_edited: boolean;
}

export interface MeResponse {
  role: "anon" | "editor";
}
```

- [ ] **Step 2: Extend `web/src/lib/api.ts`**

Replace `web/src/lib/api.ts` entirely with:

```typescript
import type {
  Chapter,
  Draft,
  DraftPatch,
  LineSummary,
  MeResponse,
  Quest,
  QuestListResponse,
  SearchHit,
  Speaker,
} from "./types";

const BASE = "/api";

async function get<T>(path: string): Promise<T> {
  const r = await fetch(BASE + path, { credentials: "include" });
  if (!r.ok) throw new Error(`${r.status} ${path}`);
  return (await r.json()) as T;
}

async function send<T>(
  method: "POST" | "PUT" | "DELETE",
  path: string,
  body?: unknown,
  extraHeaders?: Record<string, string>,
): Promise<T> {
  const r = await fetch(BASE + path, {
    method,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(extraHeaders ?? {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`${r.status} ${path} ${text}`);
  }
  return (await r.json()) as T;
}

export const api = {
  chapters: () => get<Chapter[]>(`/chapters`),
  speakers: () => get<Speaker[]>(`/speakers`),
  quests: (params: {
    side?: 0 | 1;
    quest_type?: number;
    spk?: string;
    has_options?: boolean;
    q?: string;
    sort?: "id" | "name" | "lines" | "lines_asc";
    page?: number;
    page_size?: number;
  }) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== "" && v !== null) u.set(k, String(v));
    }
    return get<QuestListResponse>(`/quests?${u.toString()}`);
  },
  quest: (qid: number) => get<Quest>(`/quests/${qid}`),
  search: (params: {
    q: string;
    lang?: "en" | "zh" | "ja";
    side?: 0 | 1;
    quest_type?: number;
    limit?: number;
  }) => {
    const u = new URLSearchParams();
    u.set("q", params.q);
    if (params.lang) u.set("lang", params.lang);
    if (params.side !== undefined) u.set("side", String(params.side));
    if (params.quest_type !== undefined) u.set("quest_type", String(params.quest_type));
    if (params.limit) u.set("limit", String(params.limit));
    return get<SearchHit[]>(`/search?${u.toString()}`);
  },

  // ----- editor + drafts + auth -----
  editorQuest: (qid: number) => get<Quest>(`/editor/quest/${qid}`),
  editorQuestLines: (qid: number) => get<LineSummary[]>(`/editor/quest/${qid}/lines`),
  createDraft: (params: {
    qid: number;
    line_id: number;
    patch: DraftPatch;
    position_after?: number | null;
    note?: string;
  }, authorLabel: string) =>
    send<{ id: number }>("POST", "/editor/drafts", params, {
      "X-Author-Label": authorLabel,
    }),
  updateDraft: (id: number, patch: DraftPatch, authorLabel: string | null) =>
    send<{ ok: true }>("PUT", `/editor/drafts/${id}`, { patch }, {
      "X-Author-Label": authorLabel ?? "",
    }),
  deleteDraft: (id: number, authorLabel: string | null) =>
    send<{ ok: true }>("DELETE", `/editor/drafts/${id}`, undefined, {
      "X-Author-Label": authorLabel ?? "",
    }),
  listDrafts: (authorLabel: string | null) =>
    get<Draft[]>(`/drafts`),
  getDraft: (id: number, authorLabel: string | null) =>
    get<Draft>(`/drafts/${id}`),
  approveDraft: (id: number) =>
    send<{ ok: true }>("POST", `/drafts/${id}/approve`),
  rejectDraft: (id: number) =>
    send<{ ok: true }>("POST", `/drafts/${id}/reject`),
  login: (password: string) =>
    send<{ role: "editor" }>("POST", "/login", { password }),
  logout: () => send<{ role: "anon" }>("POST", "/logout"),
  me: () => get<MeResponse>(`/me`),
};
```

- [ ] **Step 3: Create `web/src/lib/session.ts`**

```typescript
const KEY = "wuwaid.author_label";

function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return "u-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function getAuthorLabel(): string {
  if (typeof window === "undefined") return "anon";
  let v = localStorage.getItem(KEY);
  if (!v) {
    v = uuid();
    localStorage.setItem(KEY, v);
  }
  return v;
}
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd wuwaid-quests/web && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
cd wuwaid-quests && git add web/src/lib/types.ts web/src/lib/api.ts web/src/lib/session.ts
git commit -m "feat(editor): frontend types + api client + session helper"
```

---

## Task 10: LoginPage + useAuth hook

**Files:**
- Create: `web/src/routes/LoginPage.tsx`
- Create: `web/src/lib/auth.ts` (small `useAuth` hook)

- [ ] **Step 1: Create `web/src/lib/auth.ts`**

```typescript
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import type { MeResponse } from "./types";

const ME_KEY = ["me"] as const;

export function useMe() {
  return useQuery({
    queryKey: ME_KEY,
    queryFn: () => api.me(),
    staleTime: 30_000,
  });
}

export function useLogin() {
  const qc = useQueryClient();
  return async (password: string) => {
    await api.login(password);
    await qc.invalidateQueries({ queryKey: ME_KEY });
  };
}

export function useLogout() {
  const qc = useQueryClient();
  return async () => {
    await api.logout();
    await qc.invalidateQueries({ queryKey: ME_KEY });
  };
}
```

- [ ] **Step 2: Create `web/src/routes/LoginPage.tsx`**

```typescript
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useLogin } from "../lib/auth";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const login = useLogin();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const next = params.get("next") ?? "/drafts";

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(password);
      nav(next, { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container-narrow max-w-md">
      <h1 className="font-serif text-2xl text-slate-100">Editor login</h1>
      <p className="mt-1 text-sm text-slate-500">
        Editors can approve or reject draft edits. Anonymous contributors do not need to log in.
      </p>
      <form onSubmit={onSubmit} className="mt-6 space-y-3">
        <input
          type="password"
          autoFocus
          autoComplete="current-password"
          className="input"
          placeholder="Editor password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={busy}
        />
        {error && <div className="text-sm text-rose-400">{error}</div>}
        <button type="submit" className="btn" disabled={busy || !password}>
          {busy ? "Logging in…" : "Log in"}
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 3: Type-check**

Run: `cd wuwaid-quests/web && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
cd wuwaid-quests && git add web/src/lib/auth.ts web/src/routes/LoginPage.tsx
git commit -m "feat(editor): LoginPage + useAuth hook"
```

---

## Task 11: EditorPage skeleton + LineList (left pane)

**Files:**
- Create: `web/src/components/editor/LineList.tsx`
- Create: `web/src/routes/EditorPage.tsx`
- Modify: `web/src/App.tsx`

- [ ] **Step 1: Create `web/src/components/editor/LineList.tsx`**

```typescript
import type { LineSummary } from "../../lib/types";

export default function LineList({
  lines,
  selectedId,
  onSelect,
  pendingCounts,
}: {
  lines: LineSummary[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  pendingCounts: Record<number, number>;
}) {
  return (
    <div className="space-y-0.5">
      {lines.map((l) => {
        const pending = pendingCounts[l.id] ?? 0;
        const isSelected = l.id === selectedId;
        return (
          <button
            key={l.id}
            type="button"
            onClick={() => onSelect(l.id)}
            className={[
              "w-full text-left px-2 py-1.5 rounded text-xs font-mono transition-colors",
              isSelected
                ? "bg-accent-gold/10 text-accent-gold"
                : "text-slate-300 hover:bg-white/5",
            ].join(" ")}
          >
            <div className="flex items-center gap-1.5">
              <span className="text-slate-500">#{l.id}</span>
              <span className="text-slate-400">{l.type}</span>
              {l.speaker_en && (
                <span className="text-slate-500 truncate flex-1">{l.speaker_en}</span>
              )}
              {l.is_edited && (
                <span
                  className="text-[9px] px-1 py-0.5 rounded bg-accent-gold/20 text-accent-gold"
                  title="Has approved edits"
                >
                  edited
                </span>
              )}
              {pending > 0 && (
                <span
                  className="text-[9px] px-1 py-0.5 rounded bg-violet-500/20 text-violet-300"
                  title="Pending draft(s) for this line"
                >
                  ✎{pending}
                </span>
              )}
            </div>
            <div className="text-slate-500 text-[10px] truncate pl-7">
              {l.text_en || <em className="opacity-50">—</em>}
            </div>
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Create `web/src/routes/EditorPage.tsx`**

```typescript
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { useMemo, useState } from "react";
import { api } from "../lib/api";
import LineList from "../components/editor/LineList";

export default function EditorPage() {
  const { qid = "0" } = useParams();
  const qidN = Number(qid);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const linesQ = useQuery({
    queryKey: ["editor", "lines", qidN],
    queryFn: () => api.editorQuestLines(qidN),
    enabled: !!qidN,
  });

  const lines = useMemo(() => linesQ.data ?? [], [linesQ.data]);

  return (
    <div className="container-narrow">
      <div className="mb-3">
        <Link
          to={qidN ? `/quests/${qidN}` : "/"}
          className="link text-xs"
        >
          ← back to viewer
        </Link>
        <h1 className="mt-1 font-serif text-2xl text-slate-100">
          Editor · quest #{qidN}
        </h1>
      </div>
      <div className="grid grid-cols-[18rem_1fr] gap-4 min-h-[60vh]">
        <aside className="card p-2 overflow-auto max-h-[80vh]">
          {linesQ.isLoading && (
            <div className="text-xs text-slate-500 p-2">Loading lines…</div>
          )}
          {linesQ.error && (
            <div className="text-xs text-rose-400 p-2">Failed to load lines.</div>
          )}
          {lines.length > 0 && (
            <LineList
              lines={lines}
              selectedId={selectedId}
              onSelect={setSelectedId}
              pendingCounts={{}}
            />
          )}
        </aside>
        <section className="card p-4">
          {selectedId === null ? (
            <div className="text-sm text-slate-500">
              Select a line on the left to edit it. (Form coming in next task.)
            </div>
          ) : (
            <div className="text-sm text-slate-300">
              Editing line #{selectedId}. (Form coming in next task.)
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Register the route in `web/src/App.tsx`**

Replace `web/src/App.tsx` with:

```typescript
import { Routes, Route, Navigate } from "react-router-dom";
import Layout from "./components/Layout";
import HomePage from "./routes/HomePage";
import ChapterPage from "./routes/ChapterPage";
import SideQuestsPage from "./routes/SideQuestsPage";
import QuestPage from "./routes/QuestPage";
import SearchPage from "./routes/SearchPage";
import EditorPage from "./routes/EditorPage";
import DraftsPage from "./routes/DraftsPage";
import LoginPage from "./routes/LoginPage";

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/chapters/:chapterId" element={<ChapterPage />} />
        <Route path="/side-quests" element={<SideQuestsPage />} />
        <Route path="/quests/:qid" element={<QuestPage />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/editor/:qid" element={<EditorPage />} />
        <Route path="/drafts" element={<DraftsPage />} />
        <Route path="/drafts/:draftId" element={<DraftsPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
```

Note: `DraftsPage` and `DraftsPage/:draftId` share a component — see Task 14.

- [ ] **Step 4: Type-check**

Run: `cd wuwaid-quests/web && npx tsc --noEmit`
Expected: no errors. (If `tsc` complains that `DraftsPage` is missing, add this one-liner stub at `web/src/routes/DraftsPage.tsx` and remove it in Task 14:

```tsx
export default function DraftsPage() { return null; }
```)

- [ ] **Step 5: Commit**

```bash
cd wuwaid-quests && git add web/src/components/editor/LineList.tsx web/src/routes/EditorPage.tsx web/src/App.tsx
git commit -m "feat(editor): EditorPage skeleton with LineList"
```

---

## Task 12: LineForm + LangTabs + DiffField (right pane form)

**Files:**
- Create: `web/src/components/editor/LangTabs.tsx`
- Create: `web/src/components/editor/DiffField.tsx`
- Create: `web/src/components/editor/LineForm.tsx`

- [ ] **Step 1: Create `web/src/components/editor/LangTabs.tsx`**

```typescript
import type { Lang } from "../../lib/types";

export type MetaTab = "META";

export default function LangTabs({
  active,
  onChange,
}: {
  active: Lang | MetaTab;
  onChange: (t: Lang | MetaTab) => void;
}) {
  const tabs: Array<{ key: Lang | MetaTab; label: string }> = [
    { key: "en", label: "EN" },
    { key: "zh-Hans", label: "ZH-HANS" },
    { key: "ja", label: "JA" },
    { key: "META", label: "META" },
  ];
  return (
    <div className="flex items-center gap-0 border-b border-white/10 text-xs">
      {tabs.map((t) => {
        const isActive = active === t.key;
        return (
          <button
            key={t.key}
            type="button"
            onClick={() => onChange(t.key)}
            className={[
              "px-3 py-1.5 transition-colors",
              isActive
                ? "border-b-2 border-accent-gold text-accent-gold"
                : "text-slate-500 hover:text-slate-200",
            ].join(" ")}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Create `web/src/components/editor/DiffField.tsx`**

```typescript
export default function DiffField({
  label,
  value,
  original,
  onChange,
  multiline = false,
}: {
  label: string;
  value: string;
  original: string;
  onChange: (v: string) => void;
  multiline?: boolean;
}) {
  const changed = value !== original;
  const Cmp = (multiline ? "textarea" : "input") as "input" | "textarea";
  return (
    <label className="block">
      <div className="text-[10px] uppercase tracking-widest text-slate-500 mb-1 flex items-center gap-2">
        <span>{label}</span>
        {changed ? (
          <span className="text-accent-gold normal-case tracking-normal">
            edited
          </span>
        ) : original ? (
          <span className="text-slate-600 normal-case tracking-normal">unchanged</span>
        ) : null}
      </div>
      <Cmp
        className={[
          "input",
          changed ? "border-accent-gold/60 ring-1 ring-accent-gold/30" : "",
          multiline ? "min-h-[5rem] resize-y font-mono" : "",
        ].join(" ")}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {original && (
        <div className="mt-1 text-[10px] text-slate-600 italic">
          orig: {original}
        </div>
      )}
    </label>
  );
}
```

- [ ] **Step 3: Create `web/src/components/editor/LineForm.tsx`**

```typescript
import { useEffect, useState } from "react";
import type { DialogueLine, DraftPatch, Lang } from "../../lib/types";
import LangTabs, { type MetaTab } from "./LangTabs";
import DiffField from "./DiffField";

export default function LineForm({
  line,
  onSubmit,
  busy,
}: {
  line: DialogueLine;
  onSubmit: (patch: DraftPatch) => void;
  busy: boolean;
}) {
  const [tab, setTab] = useState<Lang | MetaTab>("en");

  // Working copy, initialized from the line. Reset on line change.
  const [working, setWorking] = useState<DialogueLine>(line);
  useEffect(() => setWorking(line), [line.id]);

  function patch(): DraftPatch {
    const p: DraftPatch = {};
    for (const k of [
      "type",
      "state_key",
      "speaker_en",
      "speaker_zh-Hans",
      "speaker_ja",
      "text_en",
      "text_zh-Hans",
      "text_ja",
    ] as const) {
      if (working[k] !== line[k]) (p as Record<string, unknown>)[k] = working[k];
    }
    return p;
  }

  const isEmpty = Object.keys(patch()).length === 0;

  return (
    <div className="space-y-3">
      <div className="text-[10px] uppercase tracking-widest text-slate-500">
        Line #{line.id} · {line.state_key || "—"}
      </div>
      <LangTabs active={tab} onChange={setTab} />
      {(tab === "en" || tab === "zh-Hans" || tab === "ja") && (
        <div className="space-y-3 pt-1">
          <DiffField
            label={`Speaker (${tab})`}
            value={(working[`speaker_${tab}` as keyof DialogueLine] as string) ?? ""}
            original={(line[`speaker_${tab}` as keyof DialogueLine] as string) ?? ""}
            onChange={(v) =>
              setWorking({ ...working, [`speaker_${tab}`]: v } as DialogueLine)
            }
          />
          <DiffField
            label={`Text (${tab})`}
            value={(working[`text_${tab}` as keyof DialogueLine] as string) ?? ""}
            original={(line[`text_${tab}` as keyof DialogueLine] as string) ?? ""}
            multiline
            onChange={(v) =>
              setWorking({ ...working, [`text_${tab}`]: v } as DialogueLine)
            }
          />
        </div>
      )}
      {tab === "META" && (
        <div className="space-y-3 pt-1">
          <DiffField
            label="Type"
            value={working.type ?? ""}
            original={line.type ?? ""}
            onChange={(v) => setWorking({ ...working, type: v })}
          />
          <DiffField
            label="State key"
            value={working.state_key ?? ""}
            original={line.state_key ?? ""}
            onChange={(v) => setWorking({ ...working, state_key: v })}
          />
        </div>
      )}
      <div className="flex items-center gap-2 pt-2 border-t border-white/5">
        <button
          type="button"
          className="btn"
          disabled={busy || isEmpty}
          onClick={() => onSubmit(patch())}
        >
          Save as draft
        </button>
        <button
          type="button"
          className="btn"
          disabled={busy || isEmpty}
          onClick={() => setWorking(line)}
        >
          Discard
        </button>
        {isEmpty && (
          <span className="text-[10px] text-slate-500">no changes yet</span>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Wire `LineForm` into `EditorPage`**

Replace the `<section className="card p-4">` block in `web/src/routes/EditorPage.tsx` with:

```tsx
      <section className="card p-4">
        {selectedId === null ? (
          <div className="text-sm text-slate-500">
            Select a line on the left to edit it.
          </div>
        ) : !questQ.data ? (
          <div className="text-sm text-slate-500">Loading quest…</div>
        ) : (() => {
          const line = questQ.data.all_lines.find((l) => l.id === selectedId);
          if (!line) return <div className="text-sm text-rose-400">Line not found.</div>;
          return (
            <LineForm
              line={line}
              busy={submitQ.isPending}
              onSubmit={(patch) => {
                submitQ.mutate(patch);
              }}
            />
          );
        })()}
      </section>
```

And **above** the `return (...)`, add these hooks (right after the existing `linesQ`):

```typescript
  const questQ = useQuery({
    queryKey: ["editor", "quest", qidN],
    queryFn: () => api.editorQuest(qidN),
    enabled: !!qidN,
  });

  const submitQ = useMutation({
    mutationFn: (patch: DraftPatch) =>
      api.createDraft(
        { qid: qidN, line_id: selectedId!, patch },
        getAuthorLabel(),
      ),
    onSuccess: () => {
      // Invalidate lines summary so the "✎N" badge appears
      void linesQ.refetch();
    },
  });
```

Also add these imports to the top of the file:

```typescript
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { DraftPatch } from "../lib/types";
import LineForm from "../components/editor/LineForm";
import { getAuthorLabel } from "../lib/session";
```

(Replace the existing `import { useQuery } from "@tanstack/react-query"` with the new combined import.)

- [ ] **Step 5: Type-check**

Run: `cd wuwaid-quests/web && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
cd wuwaid-quests && git add web/src/components/editor/LangTabs.tsx web/src/components/editor/DiffField.tsx web/src/components/editor/LineForm.tsx web/src/routes/EditorPage.tsx
git commit -m "feat(editor): LineForm with per-lang tabs + diff highlighting"
```

---

## Task 13: OptionsSubform + ReorderButtons + insert-new-line flow

**Files:**
- Create: `web/src/components/editor/OptionsSubform.tsx`
- Create: `web/src/components/editor/ReorderButtons.tsx`
- Create: `web/src/components/editor/ConfirmDialog.tsx`
- Modify: `web/src/components/editor/LineForm.tsx` (wire Options + Reorder)
- Modify: `web/src/components/editor/LineList.tsx` (wire insert/reorder buttons)

- [ ] **Step 1: Create `web/src/components/editor/OptionsSubform.tsx`**

```typescript
import type { DialogueLineOption, Lang } from "../../lib/types";
import DiffField from "./DiffField";

export default function OptionsSubform({
  options,
  originals,
  onChange,
}: {
  options: DialogueLineOption[];
  originals: DialogueLineOption[];
  onChange: (opts: DialogueLineOption[]) => void;
}) {
  function update(i: number, patch: Partial<DialogueLineOption>) {
    onChange(options.map((o, idx) => (idx === i ? { ...o, ...patch } : o)));
  }
  function add() {
    onChange([
      ...options,
      { text_key: "", text_en: "", "text_zh-Hans": "", text_ja: "" },
    ]);
  }
  function remove(i: number) {
    onChange(options.filter((_, idx) => idx !== i));
  }

  return (
    <div className="space-y-3">
      <div className="text-[10px] uppercase tracking-widest text-slate-500 flex items-center gap-2">
        <span>Options</span>
        <span className="text-slate-600 normal-case tracking-normal">
          ({options.length})
        </span>
        <button
          type="button"
          className="ml-auto text-accent-teal hover:text-accent-gold"
          onClick={add}
        >
          + Add option
        </button>
      </div>
      {options.map((opt, i) => {
        const orig = originals[i];
        return (
          <div key={i} className="card p-2 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-slate-500">Option {i + 1}</span>
              <button
                type="button"
                className="text-[10px] text-rose-400 hover:text-rose-300"
                onClick={() => remove(i)}
              >
                remove
              </button>
            </div>
            {(["en", "zh-Hans", "ja"] as Lang[]).map((l) => (
              <DiffField
                key={l}
                label={`Text (${l})`}
                value={opt[`text_${l}`] ?? ""}
                original={orig?.[`text_${l}`] ?? ""}
                onChange={(v) => update(i, { [`text_${l}`]: v } as Partial<DialogueLineOption>)}
              />
            ))}
            <label className="block">
              <div className="text-[10px] uppercase tracking-widest text-slate-500 mb-1">
                Branch target (text_key of target line)
              </div>
              <input
                className="input"
                value={opt.plot_line_key ?? ""}
                onChange={(e) => update(i, { plot_line_key: e.target.value })}
                placeholder="e.g. Flow_1_5"
              />
            </label>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Create `web/src/components/editor/ReorderButtons.tsx`**

```typescript
export default function ReorderButtons({
  onMoveUp,
  onMoveDown,
  onInsertAfter,
}: {
  onMoveUp: () => void;
  onMoveDown: () => void;
  onInsertAfter: () => void;
}) {
  return (
    <div className="flex items-center gap-1 text-[10px]">
      <button
        type="button"
        className="text-slate-500 hover:text-slate-200 px-1"
        onClick={onMoveUp}
        title="Move line up (creates a reorder draft)"
      >
        ↑
      </button>
      <button
        type="button"
        className="text-slate-500 hover:text-slate-200 px-1"
        onClick={onMoveDown}
        title="Move line down (creates a reorder draft)"
      >
        ↓
      </button>
      <button
        type="button"
        className="text-accent-teal hover:text-accent-gold px-1"
        onClick={onInsertAfter}
        title="Insert a new line after this one (creates a draft)"
      >
        + insert
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Create `web/src/components/editor/ConfirmDialog.tsx`**

```typescript
export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  destructive = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60"
      onClick={onCancel}
    >
      <div
        className="card p-4 max-w-sm w-[90%]"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-serif text-lg text-slate-100">{title}</h2>
        <p className="mt-1 text-sm text-slate-300">{message}</p>
        <div className="mt-4 flex items-center justify-end gap-2">
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className={destructive ? "btn border-rose-500/50 text-rose-300" : "btn"}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Wire options + reorder into `LineForm`**

Replace `web/src/components/editor/LineForm.tsx` with this expanded version:

```typescript
import { useEffect, useState } from "react";
import type { DialogueLine, DialogueLineOption, DraftPatch, Lang } from "../../lib/types";
import LangTabs, { type MetaTab } from "./LangTabs";
import DiffField from "./DiffField";
import OptionsSubform from "./OptionsSubform";

export default function LineForm({
  line,
  onSubmit,
  busy,
}: {
  line: DialogueLine;
  onSubmit: (patch: DraftPatch) => void;
  busy: boolean;
}) {
  const [tab, setTab] = useState<Lang | MetaTab>("en");
  const [working, setWorking] = useState<DialogueLine>(line);
  useEffect(() => setWorking(line), [line.id]);

  function patch(): DraftPatch {
    const p: DraftPatch = {};
    for (const k of [
      "type",
      "state_key",
      "speaker_en",
      "speaker_zh-Hans",
      "speaker_ja",
      "text_en",
      "text_zh-Hans",
      "text_ja",
    ] as const) {
      if (working[k] !== line[k]) (p as Record<string, unknown>)[k] = working[k];
    }
    // Options: deep compare via JSON
    const a = JSON.stringify(working.options ?? []);
    const b = JSON.stringify(line.options ?? []);
    if (a !== b) p.options = working.options ?? [];
    return p;
  }

  const isEmpty = Object.keys(patch()).length === 0;

  return (
    <div className="space-y-3">
      <div className="text-[10px] uppercase tracking-widest text-slate-500">
        Line #{line.id} · {line.state_key || "—"}
      </div>
      <LangTabs active={tab} onChange={setTab} />
      {(tab === "en" || tab === "zh-Hans" || tab === "ja") && (
        <div className="space-y-3 pt-1">
          <DiffField
            label={`Speaker (${tab})`}
            value={(working[`speaker_${tab}` as keyof DialogueLine] as string) ?? ""}
            original={(line[`speaker_${tab}` as keyof DialogueLine] as string) ?? ""}
            onChange={(v) =>
              setWorking({ ...working, [`speaker_${tab}`]: v } as DialogueLine)
            }
          />
          <DiffField
            label={`Text (${tab})`}
            value={(working[`text_${tab}` as keyof DialogueLine] as string) ?? ""}
            original={(line[`text_${tab}` as keyof DialogueLine] as string) ?? ""}
            multiline
            onChange={(v) =>
              setWorking({ ...working, [`text_${tab}`]: v } as DialogueLine)
            }
          />
        </div>
      )}
      {tab === "META" && (
        <div className="space-y-3 pt-1">
          <DiffField
            label="Type"
            value={working.type ?? ""}
            original={line.type ?? ""}
            onChange={(v) => setWorking({ ...working, type: v })}
          />
          <DiffField
            label="State key"
            value={working.state_key ?? ""}
            original={line.state_key ?? ""}
            onChange={(v) => setWorking({ ...working, state_key: v })}
          />
          <OptionsSubform
            options={working.options ?? []}
            originals={line.options ?? []}
            onChange={(opts) =>
              setWorking({ ...working, options: opts as DialogueLineOption[] })
            }
          />
        </div>
      )}
      <div className="flex items-center gap-2 pt-2 border-t border-white/5">
        <button
          type="button"
          className="btn"
          disabled={busy || isEmpty}
          onClick={() => onSubmit(patch())}
        >
          Save as draft
        </button>
        <button
          type="button"
          className="btn"
          disabled={busy || isEmpty}
          onClick={() => setWorking(line)}
        >
          Discard
        </button>
        {isEmpty && (
          <span className="text-[10px] text-slate-500">no changes yet</span>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Type-check**

Run: `cd wuwaid-quests/web && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
cd wuwaid-quests && git add web/src/components/editor/OptionsSubform.tsx web/src/components/editor/ReorderButtons.tsx web/src/components/editor/ConfirmDialog.tsx web/src/components/editor/LineForm.tsx
git commit -m "feat(editor): options subform, reorder buttons, confirm dialog"
```

---

## Task 14: DraftsPage (queue + single-draft review)

**Files:**
- Create: `web/src/routes/DraftsPage.tsx`

- [ ] **Step 1: Create `web/src/routes/DraftsPage.tsx`**

```typescript
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { useState } from "react";
import { api } from "../lib/api";
import { useMe, useLogout } from "../lib/auth";
import { getAuthorLabel } from "../lib/session";
import type { Draft, DraftPatch } from "../lib/types";

function PatchPreview({ patch }: { patch: DraftPatch }) {
  const keys = Object.keys(patch).filter((k) => k !== "_op");
  if (patch._op === "reorder") return <em className="text-slate-500">reorder</em>;
  if (keys.length === 0) return <em className="text-slate-500">no fields</em>;
  return (
    <ul className="text-[10px] text-slate-400 space-y-0.5">
      {keys.map((k) => (
        <li key={k}>
          <span className="text-slate-500">{k}:</span>{" "}
          <span className="text-slate-300">
            {String((patch as Record<string, unknown>)[k] ?? "").slice(0, 60)}
          </span>
        </li>
      ))}
    </ul>
  );
}

export default function DraftsPage() {
  const { draftId } = useParams();
  const me = useMe();
  const label = getAuthorLabel();
  const qc = useQueryClient();
  const logout = useLogout();

  const draftsQ = useQuery({
    queryKey: ["drafts", label, me.data?.role],
    queryFn: () => api.listDrafts(me.data?.role === "editor" ? null : label),
    enabled: !!me.data,
  });

  const draftQ = useQuery({
    queryKey: ["draft", draftId],
    queryFn: () => api.getDraft(Number(draftId), me.data?.role === "editor" ? null : label),
    enabled: !!draftId,
  });

  const approve = useMutation({
    mutationFn: (id: number) => api.approveDraft(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["drafts"] });
      void qc.invalidateQueries({ queryKey: ["editor"] });
    },
  });
  const reject = useMutation({
    mutationFn: (id: number) => api.rejectDraft(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["drafts"] }),
  });

  if (draftId && draftQ.data) {
    const d = draftQ.data;
    const patch = JSON.parse(d.patch_json) as DraftPatch;
    return (
      <div className="container-narrow max-w-3xl space-y-3">
        <Link to="/drafts" className="link text-xs">← queue</Link>
        <h1 className="font-serif text-2xl text-slate-100">
          Draft #{d.id} · quest {d.qid} · line {d.line_id || "(new)"}
        </h1>
        <div className="text-xs text-slate-500">
          by {d.author_label ?? "anon"} · {d.created_at}
        </div>
        {d.note && (
          <div className="card p-3 text-sm text-slate-300">“{d.note}”</div>
        )}
        <div className="card p-3">
          <div className="text-[10px] uppercase tracking-widest text-slate-500 mb-1">
            patch
          </div>
          <PatchPreview patch={patch} />
        </div>
        {me.data?.role === "editor" && d.status === "pending" && (
          <div className="flex gap-2">
            <button
              className="btn"
              disabled={approve.isPending}
              onClick={() => approve.mutate(d.id)}
            >
              {approve.isPending ? "Approving…" : "✓ Approve"}
            </button>
            <button
              className="btn border-rose-500/50 text-rose-300"
              disabled={reject.isPending}
              onClick={() => reject.mutate(d.id)}
            >
              {reject.isPending ? "Rejecting…" : "✗ Reject"}
            </button>
            {approve.error && (
              <span className="text-xs text-rose-400 self-center">
                {String(approve.error)}
              </span>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="container-narrow space-y-3">
      <div className="flex items-center gap-2">
        <h1 className="font-serif text-2xl text-slate-100">Drafts</h1>
        <div className="ml-auto flex items-center gap-2 text-xs">
          <span className="text-slate-500">
            {me.data?.role === "editor" ? "editor" : "anon"}
          </span>
          {me.data?.role === "editor" ? (
            <button className="btn" onClick={() => void logout()}>Log out</button>
          ) : (
            <Link to="/login?next=/drafts" className="btn">Log in</Link>
          )}
        </div>
      </div>
      {draftsQ.isLoading && <div className="text-sm text-slate-500">Loading…</div>}
      {draftsQ.data && draftsQ.data.length === 0 && (
        <div className="text-sm text-slate-500">No pending drafts.</div>
      )}
      {draftsQ.data && draftsQ.data.length > 0 && (
        <div className="card divide-y divide-white/5">
          {draftsQ.data.map((d: Draft) => {
            const patch = JSON.parse(d.patch_json) as DraftPatch;
            return (
              <Link
                key={d.id}
                to={`/drafts/${d.id}`}
                className="block p-3 hover:bg-white/5 transition-colors"
              >
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-mono text-slate-500">#{d.id}</span>
                  <span className="text-slate-300">q{d.qid} · L{d.line_id || "new"}</span>
                  <span className="ml-auto text-[10px] text-slate-500">
                    {d.author_label ?? "anon"} · {d.created_at}
                  </span>
                </div>
                <div className="mt-1">
                  <PatchPreview patch={patch} />
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `cd wuwaid-quests/web && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd wuwaid-quests && git add web/src/routes/DraftsPage.tsx
git commit -m "feat(editor): DraftsPage (queue + single-draft review)"
```

---

## Task 15: DraftBanner + Edit link in QuestPage

**Files:**
- Create: `web/src/components/editor/DraftBanner.tsx`
- Modify: `web/src/routes/EditorPage.tsx` (mount banner)
- Modify: `web/src/routes/QuestPage.tsx` (add Edit link)

- [ ] **Step 1: Create `web/src/components/editor/DraftBanner.tsx`**

```typescript
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";
import { getAuthorLabel } from "../../lib/session";
import { useMe } from "../../lib/auth";

export default function DraftBanner({ qid }: { qid: number }) {
  const me = useMe();
  const label = getAuthorLabel();
  const draftsQ = useQuery({
    queryKey: ["drafts", label, me.data?.role, qid],
    queryFn: async () => {
      const all = await api.listDrafts(me.data?.role === "editor" ? null : label);
      return all.filter((d) => d.qid === qid);
    },
    enabled: !!me.data,
  });
  const count = draftsQ.data?.length ?? 0;
  if (count === 0) return null;
  return (
    <div className="card border-accent-gold/30 bg-accent-gold/5 p-2 px-3 text-xs flex items-center gap-2">
      <span className="text-accent-gold">{count} pending draft{count > 1 ? "s" : ""} for this quest</span>
      <Link to="/drafts" className="link ml-auto">Review →</Link>
    </div>
  );
}
```

- [ ] **Step 2: Mount the banner on EditorPage**

In `web/src/routes/EditorPage.tsx`, replace the `<h1>` block with:

```tsx
      <div className="mb-3 space-y-2">
        <Link
          to={qidN ? `/quests/${qidN}` : "/"}
          className="link text-xs"
        >
          ← back to viewer
        </Link>
        <h1 className="font-serif text-2xl text-slate-100">
          Editor · quest #{qidN}
        </h1>
        <DraftBanner qid={qidN} />
      </div>
```

And add the import:

```typescript
import DraftBanner from "../components/editor/DraftBanner";
```

- [ ] **Step 3: Add the "Edit" link on QuestPage**

In `web/src/routes/QuestPage.tsx`, in the header block, add an Edit link. Replace the entire `<div>` block that contains the back-link + h1 with:

```tsx
      <div>
        <Link to={quest.side === 1 ? "/side-quests" : `/chapters/${quest.chapter_id ?? 0}`} className="link text-xs">
          ← {quest.side === 1 ? "side quests" : (quest.chapter_name ?? "chapter")}
        </Link>
        <div className="mt-1 flex items-start gap-3">
          <h1 className="font-serif text-2xl text-slate-100">
            {quest.quest_name}
          </h1>
          <Link
            to={`/editor/${quest.quest_id}`}
            className="btn ml-auto text-xs"
            title="Open the editor for this quest"
          >
            Edit
          </Link>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <span className="font-mono">#{quest.quest_id}</span>
          {quest.chapter_name && quest.side === 0 && (
            <span className="text-accent-teal">{quest.chapter_name}</span>
          )}
          <span>{quest.total_lines} lines</span>
        </div>
      </div>
```

- [ ] **Step 4: Type-check + full test suite**

Run: `cd wuwaid-quests/web && npx tsc --noEmit && cd .. && uv run pytest -v`
Expected: tsc clean, all backend tests pass.

- [ ] **Step 5: Commit**

```bash
cd wuwaid-quests && git add web/src/components/editor/DraftBanner.tsx web/src/routes/EditorPage.tsx web/src/routes/QuestPage.tsx
git commit -m "feat(editor): DraftBanner + Edit link from QuestPage"
```

---

## Task 16: Manual test script + visual checklist

**Files:**
- Create: `scripts/manual-editor-test.sh`
- Create: `web/src/__manual__/editor-flow.md`

- [ ] **Step 1: Create `scripts/manual-editor-test.sh`**

```bash
#!/usr/bin/env bash
# End-to-end curl walkthrough for the editor.
# Run with: bash scripts/manual-editor-test.sh
# Requires: server running on :8000, EDITOR_PASSWORD set in server env,
#           data/quests/106000002.json present.
set -euo pipefail

BASE="${BASE:-http://localhost:8000}"
QID="${QID:-106000002}"
LINE_ID="${LINE_ID:-1}"
PASSWORD="${EDITOR_PASSWORD:?set EDITOR_PASSWORD in the env}"

echo "== /api/me (anon)"
curl -sS -c /tmp/cookies.txt "$BASE/api/me" | tee /tmp/me.json
echo

echo "== POST /api/login"
curl -sS -c /tmp/cookies.txt -X POST -H "Content-Type: application/json" \
  -d "{\"password\":\"$PASSWORD\"}" "$BASE/api/login" | tee /tmp/login.json
echo

echo "== /api/me (editor)"
curl -sS -b /tmp/cookies.txt "$BASE/api/me" | tee /tmp/me.json
echo

echo "== POST /api/editor/drafts (anonymous — set X-Author-Label)"
curl -sS -X POST -H "Content-Type: application/json" -H "X-Author-Label: test-$(date +%s)" \
  -d "{\"qid\":$QID,\"line_id\":$LINE_ID,\"patch\":{\"text_en\":\"Howdy.\"}}" \
  "$BASE/api/editor/drafts" | tee /tmp/draft.json
DID=$(python3 -c "import json; print(json.load(open('/tmp/draft.json'))['id'])")
echo "draft id: $DID"

echo "== GET /api/drafts (editor sees it)"
curl -sS -b /tmp/cookies.txt "$BASE/api/drafts" | python3 -m json.tool | head -20

echo "== POST /api/drafts/$DID/approve"
curl -sS -b /tmp/cookies.txt -X POST "$BASE/api/drafts/$DID/approve"
echo

echo "== GET /api/quests/$QID — verify text_en on line $LINE_ID"
curl -sS "$BASE/api/quests/$QID" | python3 -c "
import json, sys
q = json.load(sys.stdin)
line = next(l for l in q['all_lines'] if l['id'] == $LINE_ID)
print('text_en:', repr(line['text_en']))
assert line['text_en'] == 'Howdy.', 'edit not visible'
print('OK — edit visible in viewer')
"
```

- [ ] **Step 2: Make it executable + commit**

```bash
chmod +x wuwaid-quests/scripts/manual-editor-test.sh
cd wuwaid-quests && git add scripts/manual-editor-test.sh
git commit -m "test(editor): add curl walkthrough script"
```

- [ ] **Step 3: Create `web/src/__manual__/editor-flow.md`**

```markdown
# Editor mode — manual verification checklist

Run `bun run dev`, then walk through this list. Each step should match the expected outcome.

## Anonymous draft flow

- [ ] Open `/quests/106000002`. "Edit" link is visible in the header.
- [ ] Click "Edit". Lands on `/editor/106000002`. Left pane lists all lines.
- [ ] Click a line. Right pane shows per-lang tabs (EN | ZH-HANS | JA | META).
- [ ] Edit `text_en` on a Talk line. "edited" pill appears next to the field.
- [ ] Click "Save as draft". The line in the left pane now shows "✎1".
- [ ] Open `/drafts`. Your draft is listed.
- [ ] Click the row. Side-by-side preview renders.
- [ ] Refresh `/quests/106000002`. The text is unchanged (draft is pending, not applied).

## Editor approval flow

- [ ] Set `EDITOR_PASSWORD=dev` in `.env`, restart server.
- [ ] Log in at `/login`. Cookie is set. `/api/me` returns `{"role":"editor"}`.
- [ ] Open `/drafts`. All pending drafts (including your own) are visible.
- [ ] Click a row. Side-by-side view shows original vs draft.
- [ ] Click "✓ Approve". Draft disappears from the queue.
- [ ] Refresh `/quests/<qid>`. The text is now updated.
- [ ] Open `/editor/<qid>`. The left pane shows "edited" badge for the line.

## Edge cases

- [ ] Try to approve a draft whose target line was deleted by an earlier approval — should get 409.
- [ ] Try to save a draft with `options[].plot_line_key` set to a non-existent line — approval should fail with 422.
- [ ] Open `/editor/<qid>` in two tabs. Edit the same line in both. Save both drafts. Editor approves one, then the other. Second approval should fail (line may have moved).
- [ ] Log out via `/drafts`. Try to approve another draft — should be 401.

## Regression: viewer

- [ ] `/quests/106000002` shows approved edits to text/speaker.
- [ ] `/search?q=<text from approved edit>` finds the line.
- [ ] Chapter pages and side-quest pages still render.
```

- [ ] **Step 4: Commit**

```bash
cd wuwaid-quests && git add web/src/__manual__/editor-flow.md
git commit -m "docs(editor): manual verification checklist"
```

---

## Task 17: Final smoke + summary

- [ ] **Step 1: Run the full test suite**

Run: `cd wuwaid-quests && uv run pytest -v`
Expected: all pass.

- [ ] **Step 2: Run the type-check**

Run: `cd wuwaid-quests/web && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Run the manual curl script**

Run: `cd wuwaid-quests && EDITOR_PASSWORD=dev bash scripts/manual-editor-test.sh 2>&1 | tail -20`
Expected: ends with "OK — edit visible in viewer".

- [ ] **Step 4: Build the production bundle**

Run: `cd wuwaid-quests && bun run build`
Expected: `web/dist/` builds without errors.

- [ ] **Step 5: Commit any straggler edits**

```bash
cd wuwaid-quests && git status
# If anything is unstaged:
git add -A && git commit -m "chore(editor): end-of-implementation cleanup"
```

---

## Done

Spec: `docs/superpowers/specs/2026-06-02-editor-mode-design.md`
Plan: this file.

What got built:
- 5 new SQLite tables in `index.db` (edits, inserted_lines, line_order, drafts, editor_session) — created by `scripts/build_index.py`
- `apply_edits(qid, quest)` merge function with 10 tests
- 14 new HTTP routes: editor quest + lines, draft CRUD, list/get/approve/reject, login/logout/me
- Single shared password auth via signed cookie, gated editor-only routes
- Three new frontend routes: `/editor/:qid`, `/drafts`, `/login`
- Two-pane editor with per-lang tabs and diff highlighting
- Global drafts queue with side-by-side review
- "Edit" link in QuestPage header
- `scripts/manual-editor-test.sh` curl walkthrough + visual checklist
