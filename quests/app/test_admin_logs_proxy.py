"""Tests for the admin-only log-server proxy boundary."""
from __future__ import annotations

import sqlite3

import httpx
import pytest
import respx
from fastapi.testclient import TestClient

from app import db
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
    monkeypatch.setenv("EDITOR_PASSWORD", "editor-s3cr3t")
    monkeypatch.setenv("ADMIN_PASSWORD", "admin-s3cr3t")
    monkeypatch.setenv("SESSION_SECRET", "test-secret-1234567890")
    monkeypatch.setenv("WUWAID_LOG_SERVER_URL", "http://logs.test")
    monkeypatch.setenv("WUWAID_ADMIN_TOKEN", "service-token")
    yield TestClient(app)
    db.set_db_path(None)


def _admin_login(client: TestClient) -> None:
    response = client.post("/api/admin/login", json={"password": "admin-s3cr3t"})
    assert response.status_code == 200


def test_log_proxy_rejects_anon_and_editor(client: TestClient) -> None:
    assert client.get("/api/admin/logs/uploads").status_code == 401
    assert client.post("/api/login", json={"password": "editor-s3cr3t"}).status_code == 200
    assert client.get("/api/admin/logs/uploads").status_code == 401


@respx.mock
def test_log_proxy_injects_service_token_for_admin(client: TestClient) -> None:
    route = respx.get("http://logs.test/admin/api/logs").mock(
        return_value=httpx.Response(200, json=[{"id": "upload-1"}])
    )
    _admin_login(client)

    response = client.get("/api/admin/logs/uploads")

    assert response.status_code == 200
    assert response.json() == [{"id": "upload-1"}]
    assert route.called
    assert route.calls.last.request.headers["X-Admin-Token"] == "service-token"
    assert "service-token" not in response.text


@respx.mock
def test_log_proxy_preserves_download_headers(client: TestClient) -> None:
    respx.get("http://logs.test/admin/api/logs/upload-1/download").mock(
        return_value=httpx.Response(
            200,
            content=b"zip bytes",
            headers={
                "content-type": "application/zip",
                "content-disposition": 'attachment; filename="logs.zip"',
            },
        )
    )
    _admin_login(client)

    response = client.get("/api/admin/logs/uploads/upload-1/download")

    assert response.status_code == 200
    assert response.content == b"zip bytes"
    assert response.headers["content-type"].startswith("application/zip")
    assert response.headers["content-disposition"] == 'attachment; filename="logs.zip"'


def test_log_proxy_does_not_offer_arbitrary_upstream_paths(client: TestClient) -> None:
    _admin_login(client)

    assert client.get("/api/admin/logs/not-an-upstream-route").status_code == 404


def test_log_proxy_requires_server_side_token(client: TestClient, monkeypatch) -> None:
    monkeypatch.delenv("WUWAID_ADMIN_TOKEN")
    _admin_login(client)

    assert client.get("/api/admin/logs/uploads").status_code == 503


@respx.mock
def test_log_proxy_hides_upstream_connection_details(client: TestClient) -> None:
    respx.get("http://logs.test/admin/api/logs").mock(
        side_effect=httpx.ConnectError("private upstream details")
    )
    _admin_login(client)

    response = client.get("/api/admin/logs/uploads")

    assert response.status_code == 502
    assert "private upstream details" not in response.text


def test_cors_origins_from_env(monkeypatch):
    """WUWAID_ORIGINS drives CORS; localhost defaults otherwise."""
    from app.main import _allowed_origins

    monkeypatch.setenv("WUWAID_ORIGINS", "https://wuwaid.titotfp.my.id, https://alt.example")
    assert _allowed_origins() == ["https://wuwaid.titotfp.my.id", "https://alt.example"]

    monkeypatch.delenv("WUWAID_ORIGINS", raising=False)
    assert _allowed_origins() == ["http://localhost:5173", "http://127.0.0.1:5173"]
