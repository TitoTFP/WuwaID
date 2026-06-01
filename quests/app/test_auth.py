"""Tests for the editor auth surface (password + signed cookie)."""
from __future__ import annotations

import sqlite3

import pytest
from fastapi.testclient import TestClient

from app import auth, db
from app.auth import (
    SESSION_COOKIE,
    check_password,
    make_session_token,
    read_session_cookie,
)
from app.main import app


@pytest.fixture
def client(tmp_path, monkeypatch):
    db_path = tmp_path / "index.db"
    con = sqlite3.connect(db_path)
    con.executescript("""
        CREATE TABLE editor_session (
            token TEXT PRIMARY KEY,
            created_at TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'editor'
        );
    """)
    con.commit()
    con.close()
    db.set_db_path(db_path)
    monkeypatch.setenv("EDITOR_PASSWORD", "s3cr3t")
    monkeypatch.setenv("SESSION_SECRET", "test-secret-1234567890")
    yield TestClient(app)
    db.set_db_path(None)


def test_check_password_constant_time(monkeypatch):
    monkeypatch.setenv("EDITOR_PASSWORD", "s3cr3t")
    assert check_password("s3cr3t") is True
    assert check_password("wrong") is False


def test_check_password_unset_env(monkeypatch):
    monkeypatch.delenv("EDITOR_PASSWORD", raising=False)
    assert check_password("anything") is False


def test_make_and_read_session_roundtrip(client):
    tok = make_session_token("editor")
    assert read_session_cookie(tok) == "editor"


def test_read_session_cookie_rejects_tampered():
    assert read_session_cookie("not-a-real-token") is None


def test_login_wrong_password_returns_401(client):
    r = client.post("/api/login", json={"password": "wrong"})
    assert r.status_code == 401


def test_login_correct_password_sets_cookie(client):
    r = client.post("/api/login", json={"password": "s3cr3t"})
    assert r.status_code == 200
    assert SESSION_COOKIE in r.cookies
    assert r.json()["role"] == "editor"


def test_logout_clears_session(client):
    client.post("/api/login", json={"password": "s3cr3t"})
    r = client.post("/api/logout")
    assert r.status_code == 200
    me = client.get("/api/me")
    assert me.json()["role"] == "anon"


def test_me_endpoint_anon_when_unauthenticated(client):
    r = client.get("/api/me")
    assert r.status_code == 200
    assert r.json()["role"] == "anon"


def test_session_secret_unset_uses_cached_fallback(tmp_path, monkeypatch):
    """Regression: SESSION_SECRET unset → fallback must be cached at first
    call, not regenerated per call. Login (sign with fallback) and
    read_session_cookie (verify with same fallback) must both succeed.
    """
    db_path = tmp_path / "index.db"
    con = sqlite3.connect(db_path)
    con.executescript("""
        CREATE TABLE editor_session (
            token TEXT PRIMARY KEY,
            created_at TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'editor'
        );
    """)
    con.commit()
    con.close()
    db.set_db_path(db_path)
    monkeypatch.setenv("EDITOR_PASSWORD", "s3cr3t")
    monkeypatch.delenv("SESSION_SECRET", raising=False)
    # Reset the module cache so this test exercises lazy init from scratch.
    auth._FALLBACK_SECRET = None  # noqa: SLF001

    try:
        tok = auth.make_session_token("editor")
        cached_once = auth._FALLBACK_SECRET  # noqa: SLF001
        assert cached_once is not None and len(cached_once) == 64

        # Verify the cookie with the same auth module — must succeed.
        assert auth.read_session_cookie(tok) == "editor"

        # Second mint+read — cache should be reused (same value).
        tok2 = auth.make_session_token("editor")
        assert auth.read_session_cookie(tok2) == "editor"
        assert auth._FALLBACK_SECRET == cached_once  # noqa: SLF001
    finally:
        db.set_db_path(None)
        # Reset so subsequent tests aren't affected.
        auth._FALLBACK_SECRET = None  # noqa: SLF001


def test_session_secret_unset_end_to_end(tmp_path, monkeypatch):
    """End-to-end: full /api/login + /api/me flow without SESSION_SECRET."""
    db_path = tmp_path / "index.db"
    con = sqlite3.connect(db_path)
    con.executescript("""
        CREATE TABLE editor_session (
            token TEXT PRIMARY KEY,
            created_at TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'editor'
        );
    """)
    con.commit()
    con.close()
    db.set_db_path(db_path)
    monkeypatch.setenv("EDITOR_PASSWORD", "s3cr3t")
    monkeypatch.delenv("SESSION_SECRET", raising=False)
    auth._FALLBACK_SECRET = None  # noqa: SLF001

    try:
        c = TestClient(app)
        r = c.post("/api/login", json={"password": "s3cr3t"})
        assert r.status_code == 200
        me = c.get("/api/me")
        assert me.status_code == 200
        assert me.json()["role"] == "editor"
    finally:
        db.set_db_path(None)
        auth._FALLBACK_SECRET = None  # noqa: SLF001
