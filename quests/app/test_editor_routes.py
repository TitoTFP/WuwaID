"""Tests for the editor + drafts HTTP routes."""
from __future__ import annotations

import json
import shutil
import sqlite3
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import db
from app.main import app


@pytest.fixture
def client(tmp_path, monkeypatch):
    data_dir = tmp_path / "data"
    quests_dir = data_dir / "quests"
    quests_dir.mkdir(parents=True)
    # Copy the real sample quest from the repo so routes can find it
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
            text_id TEXT, speaker_id TEXT,
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
            created_at TEXT NOT NULL, expires_at TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'editor');
        CREATE TABLE quests (qid INTEGER PRIMARY KEY, quest_name TEXT, quest_type INTEGER,
            side INTEGER, chapter_id INTEGER, chapter_name TEXT, ord INTEGER, total_lines INTEGER);
        INSERT INTO quests VALUES (106000002, 'Test Quest', 1, 0, 1, 'Test Chapter', 1, 1);
        CREATE VIRTUAL TABLE dialogue_idx USING fts5(
            qid UNINDEXED, line_id UNINDEXED, quest_name UNINDEXED, chapter_name UNINDEXED,
            side UNINDEXED, speaker_en, line_type UNINDEXED, has_options UNINDEXED,
            text_en, text_zh, text_ja);
        INSERT INTO dialogue_idx VALUES (106000002, 1, 'Test Quest', 'Test Chapter', 0,
            'Rover', 'Talk', 0, 'Original only.', '', '');
    """)
    con.commit()
    con.close()
    db.set_db_path(db_path)
    monkeypatch.setenv("EDITOR_PASSWORD", "s3cr3t")
    monkeypatch.setenv("SESSION_SECRET", "test-secret-1234567890")

    from app import main as appmain
    monkeypatch.setattr(appmain, "QUESTS_DIR", quests_dir)

    yield TestClient(app)
    db.set_db_path(None)


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


def test_anon_cannot_update_or_delete_without_author_label(client):
    cr = client.post(
        "/api/editor/drafts",
        json={"qid": 106000002, "line_id": 1, "patch": {"text_en": "owner"}},
        headers={"X-Author-Label": "alice"},
    )
    did = cr.json()["id"]

    r = client.put(f"/api/editor/drafts/{did}", json={"patch": {"text_en": "hacked"}})
    assert r.status_code == 403
    r = client.delete(f"/api/editor/drafts/{did}")
    assert r.status_code == 403

    r = client.put(
        f"/api/editor/drafts/{did}",
        json={"patch": {"text_en": "hacked"}},
        headers={"X-Author-Label": "mallory"},
    )
    assert r.status_code == 403


def test_search_finds_approved_overlay_text(client):
    _login(client)
    cr = client.post(
        "/api/editor/drafts",
        json={"qid": 106000002, "line_id": 1, "patch": {"text_en": "HowdyUnique"}},
        headers={"X-Author-Label": "alice"},
    )
    assert client.post(f"/api/drafts/{cr.json()['id']}/approve").status_code == 200

    r = client.get("/api/search", params={"q": "HowdyUnique", "lang": "en"})
    assert r.status_code == 200
    hits = r.json()
    assert any(hit["qid"] == 106000002 and hit["line_id"] == 1 for hit in hits)
    hit = next(hit for hit in hits if hit["qid"] == 106000002 and hit["line_id"] == 1)
    assert hit["quest_name"] == "Test Quest"
    assert isinstance(hit["speaker_en"], str)
    assert hit["text"] == "HowdyUnique"
