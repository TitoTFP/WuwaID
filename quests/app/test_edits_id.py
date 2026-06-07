"""Tests for apply_edits overlay of text_id / speaker_id."""
from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from app import db


def _insert_edit(db_path: Path, **fields) -> None:
    con = sqlite3.connect(db_path)
    con.execute(
        """INSERT INTO edits (qid, line_id, type, state_key,
            speaker_en, speaker_zh_hans, speaker_ja,
            text_en, text_zh_hans, text_ja, text_id, speaker_id, options_json,
            approved_by, approved_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
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
            fields.get("text_id"),
            fields.get("speaker_id"),
            fields.get("options_json"),
            fields.get("approved_by", "tester"),
            fields.get("approved_at", "2026-06-07T00:00:00Z"),
        ),
    )
    con.commit()
    con.close()


def test_edit_text_id_overlays_line(tmp_db, sample_quest):
    _insert_edit(tmp_db, line_id=1, text_id="Halo editor.")
    out = db.apply_edits(106000002, sample_quest)
    assert out["all_lines"][0]["text_id"] == "Halo editor."


def test_edit_speaker_id_overlays_line(tmp_db, sample_quest):
    _insert_edit(tmp_db, line_id=1, speaker_id="Pelancong")
    out = db.apply_edits(106000002, sample_quest)
    assert out["all_lines"][0]["speaker_id"] == "Pelancong"


def test_idempotency_preserved_with_id_overlays(tmp_db, sample_quest):
    _insert_edit(tmp_db, line_id=1, text_id="Halo editor.")
    once = db.apply_edits(106000002, sample_quest)
    twice = db.apply_edits(106000002, once)
    assert once == twice
    assert twice["all_lines"][0]["text_id"] == "Halo editor."


def test_no_id_overlay_when_column_is_null(tmp_db, sample_quest):
    """An edits row with text_id NULL must not introduce a text_id field."""
    _insert_edit(tmp_db, line_id=1, text_en="Halo.")
    out = db.apply_edits(106000002, sample_quest)
    assert "text_id" not in out["all_lines"][0]


def test_stale_id_edit_ignored(tmp_db, sample_quest):
    _insert_edit(tmp_db, qid=106000002, line_id=999, text_id="ghost")
    out = db.apply_edits(106000002, sample_quest)
    for line in out["all_lines"]:
        assert "text_id" not in line
