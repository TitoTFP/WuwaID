"""Tests for the ID-translation merge in /api/quests/{qid}."""
from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import db, main


@pytest.fixture
def client(tmp_path: Path, sample_quest: dict) -> TestClient:
    """Spin up a FastAPI test client pointed at a temp data dir."""
    quests_dir = tmp_path / "quests"
    quests_dir.mkdir()
    (quests_dir / "106000002.json").write_text(
        json.dumps(sample_quest), encoding="utf-8"
    )
    quests_id_dir = tmp_path / "quests_id"
    quests_id_dir.mkdir()
    db_path = tmp_path / "index.db"
    # Pre-create the editor tables so that db.ensure_editor_schema() can run
    # its ALTER TABLE migration and apply_edits() can SELECT from them.
    con = sqlite3.connect(db_path)
    con.executescript(
        """
        CREATE TABLE IF NOT EXISTS edits (
            qid INTEGER NOT NULL, line_id INTEGER NOT NULL,
            type TEXT, state_key TEXT,
            speaker_en TEXT, speaker_zh_hans TEXT, speaker_ja TEXT,
            text_en TEXT, text_zh_hans TEXT, text_ja TEXT,
            text_id TEXT, speaker_id TEXT,
            options_json TEXT,
            approved_by TEXT NOT NULL, approved_at TEXT NOT NULL,
            PRIMARY KEY (qid, line_id)
        );
        CREATE TABLE IF NOT EXISTS inserted_lines (
            qid INTEGER NOT NULL, line_id INTEGER NOT NULL,
            position_after INTEGER, line_json TEXT NOT NULL,
            approved_by TEXT NOT NULL, approved_at TEXT NOT NULL,
            PRIMARY KEY (qid, line_id)
        );
        CREATE TABLE IF NOT EXISTS line_order (
            qid INTEGER NOT NULL, line_id INTEGER NOT NULL,
            position_after INTEGER,
            approved_by TEXT NOT NULL, approved_at TEXT NOT NULL,
            PRIMARY KEY (qid, line_id)
        );
        """
    )
    con.commit()
    con.close()
    db.set_db_path(db_path)
    db.ensure_editor_schema()
    main.DATA_DIR = tmp_path
    main.QUESTS_DIR = quests_dir
    return TestClient(main.app)


def _write_id_file(tmp_path: Path, qid: int, payload: dict) -> None:
    (tmp_path / "quests_id" / f"{qid}.json").write_text(
        json.dumps(payload), encoding="utf-8"
    )


def test_merge_id_missing_file_is_noop(client: TestClient) -> None:
    """No ID file → response has no text_id fields, languages unchanged."""
    r = client.get("/api/quests/106000002")
    assert r.status_code == 200
    body = r.json()
    assert "id" not in body["languages"]
    for line in body["all_lines"]:
        assert "text_id" not in line
        assert "speaker_id" not in line


def test_merge_id_present_populates_lines(client: TestClient, tmp_path: Path) -> None:
    """ID file present → text_id and speaker_id populated; 'id' in languages."""
    _write_id_file(tmp_path, 106000002, {
        "quest_id": 106000002,
        "quest_name": "Test Quest",
        "chapter_id": 1,
        "chapter_name": "Jinzhou Rising",
        "translated_at": "2026-06-07T00:00:00Z",
        "model": "test",
        "states": {
            "Flow_1_1": {
                "plot_mode": "Normal",
                "lines": [
                    {"line_id": 1, "type": "Talk", "text_key": "t1",
                     "speaker_id": "Rover", "text_id": "Halo.", "flags": []}
                ]
            },
            "Flow_1_2": {
                "plot_mode": "Normal",
                "lines": [
                    {"line_id": 2, "type": "Talk", "text_key": "t2",
                     "speaker_id": "Chixia", "text_id": "Dekat sini.", "flags": []}
                ]
            },
            "Flow_1_3": {
                "plot_mode": "Normal",
                "lines": [
                    {"line_id": 3, "type": "Option", "text_key": "t3",
                     "speaker_id": "", "text_id": "Setuju membantu",
                     "options": [
                         {"text_key": "t3opt1", "text_id": "Ya"}
                     ],
                     "flags": []}
                ]
            },
        },
    })
    r = client.get("/api/quests/106000002")
    body = r.json()
    assert "id" in body["languages"]
    line1 = next(l for l in body["all_lines"] if l["id"] == 1)
    assert line1["text_id"] == "Halo."
    assert line1["speaker_id"] == "Rover"
    line3 = next(l for l in body["all_lines"] if l["id"] == 3)
    assert line3["text_id"] == "Setuju membantu"
    assert line3["options"][0]["text_id"] == "Ya"


def test_merge_id_corrupt_file_is_noop(client: TestClient, tmp_path: Path) -> None:
    """Corrupt ID file → treated as missing."""
    (tmp_path / "quests_id" / "106000002.json").write_text("not json {{{", encoding="utf-8")
    r = client.get("/api/quests/106000002")
    body = r.json()
    assert "id" not in body["languages"]


def test_merge_id_empty_file_is_noop(client: TestClient, tmp_path: Path) -> None:
    """ID file with no states → treated as missing."""
    _write_id_file(tmp_path, 106000002, {
        "quest_id": 106000002, "quest_name": "x",
        "chapter_id": 1, "chapter_name": "x",
        "translated_at": "2026-06-07T00:00:00Z", "model": "test",
        "states": {},
    })
    r = client.get("/api/quests/106000002")
    body = r.json()
    assert "id" not in body["languages"]


def test_merge_id_options_match_by_text_key(client: TestClient, tmp_path: Path) -> None:
    """Options[] in the ID file match source options by text_key."""
    _write_id_file(tmp_path, 106000002, {
        "quest_id": 106000002, "quest_name": "x",
        "chapter_id": 1, "chapter_name": "x",
        "translated_at": "2026-06-07T00:00:00Z", "model": "test",
        "states": {
            "Flow_1_3": {
                "plot_mode": "Normal",
                "lines": [
                    {"line_id": 3, "type": "Option", "text_key": "t3",
                     "speaker_id": "", "text_id": "Setuju",
                     "options": [
                         {"text_key": "t3opt1", "text_id": "Ya"},
                         # out-of-order: option order in the ID file differs from source
                         {"text_key": "t3optX", "text_id": "Tidak"},
                     ],
                     "flags": []}
                ]
            }
        },
    })
    r = client.get("/api/quests/106000002")
    body = r.json()
    line3 = next(l for l in body["all_lines"] if l["id"] == 3)
    # t3optX doesn't exist in the source — only the matching t3opt1 gets merged
    assert line3["options"][0]["text_id"] == "Ya"
    assert "text_id" not in line3["options"][0] or line3["options"][0].get("text_id") == "Ya"


def test_merge_id_state_with_error_skipped(client: TestClient, tmp_path: Path) -> None:
    """A state with `error` field → its lines are skipped, others still merge."""
    _write_id_file(tmp_path, 106000002, {
        "quest_id": 106000002, "quest_name": "x",
        "chapter_id": 1, "chapter_name": "x",
        "translated_at": "2026-06-07T00:00:00Z", "model": "test",
        "states": {
            "Flow_1_1": {
                "plot_mode": "Normal",
                "lines": [
                    {"line_id": 1, "type": "Talk", "text_key": "t1",
                     "speaker_id": "Rover", "text_id": "Halo.", "flags": []}
                ]
            },
            "Flow_1_2": {"error": "LLM timed out"},
        },
    })
    r = client.get("/api/quests/106000002")
    body = r.json()
    line1 = next(l for l in body["all_lines"] if l["id"] == 1)
    assert line1["text_id"] == "Halo."
    line2 = next(l for l in body["all_lines"] if l["id"] == 2)
    assert "text_id" not in line2  # skipped


def test_merge_id_editor_wins(client: TestClient, tmp_path: Path) -> None:
    """An approved editor edit on text_id wins over the MT output."""
    # Add an edits row overriding line 1's text_id
    con = sqlite3.connect(tmp_path / "index.db")
    con.execute(
        """INSERT INTO edits (qid, line_id, type, state_key,
           speaker_en, speaker_zh_hans, speaker_ja,
           text_en, text_zh_hans, text_ja, text_id, speaker_id, options_json,
           approved_by, approved_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (106000002, 1, None, None, None, None, None, None, None, None,
         "EDIT-WINS", None, None, "tester", "2026-06-07T00:00:00Z"),
    )
    con.commit()
    con.close()

    _write_id_file(tmp_path, 106000002, {
        "quest_id": 106000002, "quest_name": "x",
        "chapter_id": 1, "chapter_name": "x",
        "translated_at": "2026-06-07T00:00:00Z", "model": "test",
        "states": {
            "Flow_1_1": {
                "plot_mode": "Normal",
                "lines": [
                    {"line_id": 1, "type": "Talk", "text_key": "t1",
                     "speaker_id": "Rover", "text_id": "FROM-MT", "flags": []}
                ]
            },
        },
    })
    r = client.get("/api/quests/106000002")
    body = r.json()
    line1 = next(l for l in body["all_lines"] if l["id"] == 1)
    assert line1["text_id"] == "EDIT-WINS"
