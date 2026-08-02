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
    assert out["all_lines"][0]["text_zh-Hans"] == "你好。"
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
    assert out["all_lines"][1]["speaker_zh-Hans"] == "炽霞"


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


def test_insertions_with_same_anchor_keep_approval_order_and_are_idempotent(tmp_db, sample_quest):
    first = {
        "id": 50, "state_item_id": 1, "type": "Talk",
        "state_key": "Flow_1_50", "text_key": "t50",
        "speaker_en": "", "speaker_zh-Hans": "", "speaker_ja": "",
        "text_en": "First.", "text_zh-Hans": "", "text_ja": "",
        "options": [],
    }
    second = {**first, "id": 51, "text_key": "t51", "text_en": "Second."}
    _insert_line(tmp_db, 106000002, 50, position_after=2, line=first)
    con = sqlite3.connect(tmp_db)
    con.execute(
        "INSERT INTO inserted_lines VALUES (?,?,?,?,?,?)",
        (106000002, 51, 2, json.dumps(second), "tester", "2026-06-02T00:00:01Z"),
    )
    con.commit()
    con.close()

    once = db.apply_edits(106000002, sample_quest)
    twice = db.apply_edits(106000002, once)
    assert [l["id"] for l in once["all_lines"]] == [1, 2, 50, 51, 3]
    assert twice == once


def test_reorder_one_line(tmp_db, sample_quest):
    _insert_order(tmp_db, 106000002, 3, position_after=1)
    out = db.apply_edits(106000002, sample_quest)
    assert [l["id"] for l in out["all_lines"]] == [1, 3, 2]


def test_reorder_untouched_lines_keep_relative_order(tmp_db, sample_quest):
    _insert_order(tmp_db, 106000002, 1, position_after=2)
    out = db.apply_edits(106000002, sample_quest)
    assert [l["id"] for l in out["all_lines"]] == [2, 1, 3]


def test_reorder_to_top_is_idempotent(tmp_db, sample_quest):
    _insert_order(tmp_db, 106000002, 2, position_after=None)

    once = db.apply_edits(106000002, sample_quest)
    twice = db.apply_edits(106000002, once)

    assert [l["id"] for l in once["all_lines"]] == [2, 1, 3]
    assert [l["id"] for l in twice["all_lines"]] == [2, 1, 3]
    assert twice == once


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
