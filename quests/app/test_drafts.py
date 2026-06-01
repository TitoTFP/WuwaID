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
    # editor (no author_label) can still update
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
    con = db.connect()
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
