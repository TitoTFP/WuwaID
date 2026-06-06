"""Tests for gzip middleware, ensure_ascii=False, JSON cache, and viewer payload shape."""
import json
import os
import shutil
import sqlite3
import time
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
    quest = {
        "quest_id": 1, "quest_name": "测试文本", "quest_type": 100,
        "languages": ["en", "zh-Hans", "ja"], "total_lines": 1, "side": 1,
        "chapter_id": 0, "chapter_name": "Side Quests",
        "flows": [
            {
                "flow_list_name": "Flow", "flow_id": 1, "state_id": 1,
                "states": [{"state_key": "Flow_1_1", "plot_mode": "Normal", "actions": []}],
                "dialogue": [
                    {
                        "id": 1, "type": "Talk", "state_key": "Flow_1_1", "text_key": "t1",
                        "speaker_en": "R", "speaker_zh-Hans": "测试", "speaker_ja": "テスト",
                        "text_en": "Hi.", "text_zh-Hans": "你好。", "text_ja": "こんにちは。",
                        "options": [],
                    }
                ],
            }
        ],
        "all_lines": [
            {
                "id": 1, "type": "Talk", "state_key": "Flow_1_1", "text_key": "t1",
                "speaker_en": "R", "speaker_zh-Hans": "测试", "speaker_ja": "テスト",
                "text_en": "Hi.", "text_zh-Hans": "你好。", "text_ja": "こんにちは。",
                "options": [],
            }
        ],
    }
    (quests_dir / "1.json").write_text(json.dumps(quest, ensure_ascii=False), encoding="utf-8")
    (data_dir / "chapters.json").write_text(
        json.dumps([{"id": 0, "name": "Side Quests", "quest_count": 1, "line_count": 1}], ensure_ascii=False),
        encoding="utf-8",
    )

    db_path = data_dir / "index.db"
    con = sqlite3.connect(db_path)
    con.executescript("""
        CREATE TABLE quests (qid INTEGER PRIMARY KEY, quest_name TEXT, quest_type INTEGER,
            side INTEGER, chapter_id INTEGER, chapter_name TEXT, ord INTEGER, total_lines INTEGER);
        INSERT INTO quests VALUES (1, '测试文本', 100, 1, 0, 'Side Quests', 1, 1);
        CREATE TABLE edits (qid INTEGER NOT NULL, line_id INTEGER NOT NULL,
            type TEXT, state_key TEXT, speaker_en TEXT, speaker_zh_hans TEXT, speaker_ja TEXT,
            text_en TEXT, text_zh_hans TEXT, text_ja TEXT, options_json TEXT,
            approved_by TEXT NOT NULL, approved_at TEXT NOT NULL,
            PRIMARY KEY (qid, line_id));
        CREATE TABLE inserted_lines (qid INTEGER NOT NULL, line_id INTEGER NOT NULL,
            position_after INTEGER, line_json TEXT NOT NULL,
            approved_by TEXT NOT NULL, approved_at TEXT NOT NULL,
            PRIMARY KEY (qid, line_id));
        CREATE TABLE line_order (qid INTEGER NOT NULL, line_id INTEGER NOT NULL,
            position_after INTEGER, approved_by TEXT NOT NULL, approved_at TEXT NOT NULL,
            PRIMARY KEY (qid, line_id));
        CREATE TABLE drafts (id INTEGER PRIMARY KEY AUTOINCREMENT,
            qid INTEGER NOT NULL, line_id INTEGER NOT NULL, position_after INTEGER,
            patch_json TEXT NOT NULL, status TEXT NOT NULL,
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
            author_label TEXT, note TEXT);
    """)
    con.commit()
    con.close()
    db.set_db_path(db_path)
    db.ensure_editor_schema()
    monkeypatch.setenv("EDITOR_PASSWORD", "s3cr3t")
    monkeypatch.setenv("SESSION_SECRET", "test-secret-1234567890")

    from app import main as appmain
    monkeypatch.setattr(appmain, "QUESTS_DIR", quests_dir)
    monkeypatch.setattr(appmain, "DATA_DIR", data_dir)

    yield TestClient(app)
    db.set_db_path(None)


def test_gzip_enabled(client):
    from starlette.middleware.gzip import GZipMiddleware
    from app.main import app
    has_gzip = any(m.cls is GZipMiddleware for m in app.user_middleware)
    assert has_gzip, "GZipMiddleware not registered"
    # Verify gzip actually fires on a payload above minimum_size=500.
    # Inject a large quest and fetch it with Accept-Encoding: gzip.
    import os
    from app import main
    data_dir = main.DATA_DIR
    quests_dir = data_dir / "quests"
    big_lines = [
        {
            "id": i, "type": "Talk", "state_key": f"F_1_{i}", "text_key": f"t{i}",
            "speaker_en": "R" * 50, "speaker_zh-Hans": "测试" * 30, "speaker_ja": "テスト" * 30,
            "text_en": "Hello world " * 50, "text_zh-Hans": "你好世界" * 30, "text_ja": "こんにちは" * 30,
            "options": [],
        }
        for i in range(1, 30)
    ]
    big_quest = {
        "quest_id": 999, "quest_name": "Big", "quest_type": 1, "languages": ["en"],
        "total_lines": len(big_lines), "side": 0, "chapter_id": 0, "chapter_name": "X",
        "flows": [
            {
                "flow_list_name": "F", "flow_id": 1, "state_id": 1,
                "states": [{"state_key": f"F_1_{i}", "plot_mode": "Normal", "actions": []} for i in range(1, 30)],
                "dialogue": big_lines,
            }
        ],
        "all_lines": big_lines,
    }
    (quests_dir / "999.json").write_text(json.dumps(big_quest, ensure_ascii=False), encoding="utf-8")
    main._load_quest_cached.cache_clear()
    r = client.get("/api/quests/999", headers={"Accept-Encoding": "gzip"})
    assert r.status_code == 200
    assert r.headers.get("content-encoding") == "gzip"


def test_json_not_escaped(client):
    r = client.get("/api/chapters", headers={"Accept-Encoding": "identity"})
    assert r.status_code == 200
    raw = r.content
    assert "Side Quests".encode("utf-8") in raw
    assert "\\u" not in raw.decode("utf-8")


def test_small_response_not_gzipped(client):
    r = client.get("/api/me", headers={"Accept-Encoding": "gzip"})
    assert r.status_code == 200
    assert r.headers.get("content-encoding") != "gzip"


def test_quest_cached_across_calls(client, tmp_path, monkeypatch):
    from app import main
    p = tmp_path / "1.json"
    p.write_text(json.dumps({"quest_id": 1, "all_lines": [{"id": 1}], "flows": []}))
    monkeypatch.setattr(main, "QUESTS_DIR", tmp_path)
    main._load_quest_cached.cache_clear()
    q1 = main._load_quest(1)
    q2 = main._load_quest(1)
    assert q1 is q2
    time.sleep(0.02)
    os.utime(p, None)
    q3 = main._load_quest(1)
    assert q3 is not q1


def test_quest_cache_returns_none_when_missing(client, tmp_path, monkeypatch):
    from app import main
    monkeypatch.setattr(main, "QUESTS_DIR", tmp_path)
    main._load_quest_cached.cache_clear()
    assert main._load_quest(999999) is None


def test_viewer_payload_omits_flows(client):
    r = client.get("/api/quests/1")
    assert r.status_code == 200
    data = r.json()
    assert "flows" not in data
    assert "plot_mode_by_state" in data
    assert "all_lines" in data
    assert data["quest_id"] == 1
    assert data["plot_mode_by_state"] == {"Flow_1_1": "Normal"}


def test_editor_payload_still_has_flows(client):
    r = client.get("/api/editor/quest/1")
    assert r.status_code == 200
    data = r.json()
    assert "flows" in data
    assert "all_lines" in data
