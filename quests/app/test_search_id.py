"""Tests for /api/search with lang=id (Indonesian FTS5 column)."""
from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import db, main


@pytest.fixture
def indexed_client(tmp_path: Path, sample_quest: dict) -> TestClient:
    """Build a temp FTS5 index with a single quest that has ID text."""
    quests_dir = tmp_path / "quests"
    quests_dir.mkdir()
    (quests_dir / "106000002.json").write_text(
        json.dumps(sample_quest), encoding="utf-8"
    )
    db_path = tmp_path / "index.db"
    db.set_db_path(db_path)

    con = sqlite3.connect(db_path)
    con.executescript("""
        CREATE TABLE edits (
            qid INTEGER NOT NULL, line_id INTEGER NOT NULL,
            type TEXT, state_key TEXT,
            speaker_en TEXT, speaker_zh_hans TEXT, speaker_ja TEXT,
            text_en TEXT, text_zh_hans TEXT, text_ja TEXT,
            text_id TEXT, speaker_id TEXT,
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
        CREATE VIRTUAL TABLE dialogue_idx USING fts5(
            qid UNINDEXED, line_id UNINDEXED, side UNINDEXED,
            chapter_id UNINDEXED, chapter_name, quest_name,
            quest_type UNINDEXED, line_type UNINDEXED, has_options UNINDEXED,
            speaker_en, text_en, text_zh, text_ja, text_id,
            tokenize = 'unicode61 remove_diacritics 2'
        );
        CREATE TABLE quests (
            qid INTEGER PRIMARY KEY, quest_name TEXT, quest_type INTEGER,
            side INTEGER, chapter_id INTEGER, chapter_name TEXT, ord INTEGER,
            total_lines INTEGER
        );
    """)
    con.execute(
        "INSERT INTO dialogue_idx VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (106000002, 1, 0, 1, "Jinzhou Rising", "Test Quest", 1, "Talk", 0,
         "Rover", "Hello.", "你好。", "こんにちは。", "Halo dunia."),
    )
    con.execute(
        "INSERT INTO quests VALUES (?,?,?,?,?,?,?,?)",
        (106000002, "Test Quest", 1, 0, 1, "Jinzhou Rising", 1, 3),
    )
    con.commit()
    con.close()
    db.ensure_editor_schema()

    main.DATA_DIR = tmp_path
    main.QUESTS_DIR = quests_dir
    return TestClient(main.app)


def test_search_id_routes_to_text_id_column(indexed_client: TestClient) -> None:
    r = indexed_client.get("/api/search", params={"q": "Halo", "lang": "id"})
    assert r.status_code == 200
    hits = r.json()
    assert len(hits) == 1
    assert hits[0]["qid"] == 106000002
    assert hits[0]["line_id"] == 1
    assert "Halo" in hits[0]["snippet"]


def test_search_id_does_not_match_other_columns(indexed_client: TestClient) -> None:
    """A query that only matches text_en must not appear in lang=id results."""
    r = indexed_client.get("/api/search", params={"q": "Hello", "lang": "id"})
    assert r.json() == []


def test_search_id_empty_query_returns_empty(indexed_client: TestClient) -> None:
    r = indexed_client.get("/api/search", params={"q": "x", "lang": "id"})
    assert r.json() == []
