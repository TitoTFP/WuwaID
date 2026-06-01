"""Tests for the editor auth surface (password + signed cookie)."""
from __future__ import annotations

import os
import sqlite3

import pytest
from fastapi.testclient import TestClient

from app import db
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
            expires_at TEXT NOT NULL
        );
    """)
    con.commit()
    con.close()
    db.set_db_path(db_path)
    monkeypatch.setenv("EDITOR_PASSWORD", "s3cr3t")
    monkeypatch.setenv("SESSION_SECRET", "test-secret-1234567890")
    yield TestClient(app)
    db.set_db_path(None)  # type: ignore[arg-type]


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
