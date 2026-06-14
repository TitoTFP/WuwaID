"""Tests for the /api/editor/export route."""
from __future__ import annotations

from unittest.mock import patch
import pytest
from fastapi.testclient import TestClient

from app.main import app

@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("EDITOR_PASSWORD", "s3cr3t")
    monkeypatch.setenv("SESSION_SECRET", "test-secret-1234567890")
    
    # Mock index.db schemas and path to prevent actual db initialization failures
    import sqlite3
    db_path = tmp_path / "index.db"
    con = sqlite3.connect(db_path)
    con.executescript("""
        CREATE TABLE editor_session (token TEXT PRIMARY KEY,
            created_at TEXT NOT NULL, expires_at TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'editor');
    """)
    con.commit()
    con.close()
    
    from app import db
    db.set_db_path(db_path)
    
    yield TestClient(app)
    db.set_db_path(None)

def _login(client) -> None:
    r = client.post("/api/login", json={"password": "s3cr3t"})
    assert r.status_code == 200

def test_export_requires_editor(client):
    # Anonymous request should return 401/403 depending on auth middleware
    r = client.post("/api/editor/export")
    assert r.status_code in (401, 403)

def test_export_succeeds_for_editor(client):
    _login(client)
    with patch("app.export.export_indonesian_translations") as mock_export:
        r = client.post("/api/editor/export")
        assert r.status_code == 200
        assert r.json()["ok"] is True
        assert "files" in r.json()
        mock_export.assert_called_once()

def test_selective_export_succeeds_for_editor(client):
    _login(client)
    with patch("app.export.export_selective_translations") as mock_export:
        mock_export.return_value = ["test_quest.db"]
        r = client.post("/api/editor/export", json={"quest_ids": [123]})
        assert r.status_code == 200
        assert r.json() == {"ok": True, "files": ["test_quest.db"]}
        mock_export.assert_called_once()
