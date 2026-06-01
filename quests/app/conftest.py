"""Shared pytest fixtures for the editor tests."""
from __future__ import annotations

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
    from app import db
    db.set_db_path(db_path)
    yield db_path
    db.set_db_path(None)
