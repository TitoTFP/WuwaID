"""Tests for preserving editor state when rebuilding index.db."""
from __future__ import annotations

import sqlite3
from pathlib import Path

from scripts import build_index


def _rows(db_path: Path, table: str) -> list[sqlite3.Row]:
    con = sqlite3.connect(db_path)
    con.row_factory = sqlite3.Row
    try:
        return con.execute(f"SELECT * FROM {table} ORDER BY qid, line_id").fetchall()
    finally:
        con.close()


def test_build_fts_preserves_approved_reorder_rows(tmp_path: Path, sample_quest: dict) -> None:
    db_path = tmp_path / "index.db"
    build_index.build_fts(db_path, [sample_quest])

    con = sqlite3.connect(db_path)
    con.execute(
        "INSERT INTO line_order VALUES (?,?,?,?,?)",
        (106000002, 3, 1, "editor", "2026-06-02T00:00:00Z"),
    )
    con.commit()
    con.close()

    build_index.build_fts(db_path, [sample_quest])

    rows = _rows(db_path, "line_order")
    assert len(rows) == 1
    assert dict(rows[0]) == {
        "qid": 106000002,
        "line_id": 3,
        "position_after": 1,
        "approved_by": "editor",
        "approved_at": "2026-06-02T00:00:00Z",
    }


def test_build_fts_skips_stale_editor_rows(tmp_path: Path, sample_quest: dict) -> None:
    db_path = tmp_path / "index.db"
    build_index.build_fts(db_path, [sample_quest])

    con = sqlite3.connect(db_path)
    con.execute(
        "INSERT INTO line_order VALUES (?,?,?,?,?)",
        (106000002, 3, 1, "editor", "2026-06-02T00:00:00Z"),
    )
    con.execute(
        "INSERT INTO line_order VALUES (?,?,?,?,?)",
        (106000002, 999, 1, "editor", "2026-06-02T00:00:00Z"),
    )
    con.commit()
    con.close()

    updated = {
        **sample_quest,
        "all_lines": [line for line in sample_quest["all_lines"] if line["id"] != 3],
        "total_lines": 2,
    }
    build_index.build_fts(db_path, [updated])

    assert _rows(db_path, "line_order") == []


def test_build_fts_preserves_field_edits_and_drafts(tmp_path: Path, sample_quest: dict) -> None:
    db_path = tmp_path / "index.db"
    build_index.build_fts(db_path, [sample_quest])

    con = sqlite3.connect(db_path)
    con.execute(
        """INSERT INTO edits (qid, line_id, text_en, approved_by, approved_at)
           VALUES (?,?,?,?,?)""",
        (106000002, 1, "Persistent edit", "editor", "2026-06-02T00:00:00Z"),
    )
    con.execute(
        """INSERT INTO drafts
           (qid, line_id, position_after, patch_json, status, created_at, updated_at, author_label, note)
           VALUES (?,?,?,?,?,?,?,?,?)""",
        (
            106000002,
            2,
            None,
            '{"text_en":"Pending edit"}',
            "pending",
            "2026-06-02T00:00:00Z",
            "2026-06-02T00:00:00Z",
            "author-1",
            None,
        ),
    )
    con.commit()
    con.close()

    build_index.build_fts(db_path, [sample_quest])

    edits = _rows(db_path, "edits")
    drafts = _rows(db_path, "drafts")
    assert len(edits) == 1
    assert edits[0]["text_en"] == "Persistent edit"
    assert len(drafts) == 1
    assert drafts[0]["patch_json"] == '{"text_en":"Pending edit"}'
