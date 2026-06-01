"""Editor-role auth: single shared password + signed cookie session.

- `EDITOR_PASSWORD` env var (required for approval; if unset, login returns 503)
- `SESSION_SECRET` env var (used to sign the session cookie; random fallback
  generated at startup and logged once)
- `SESSION_DAYS` env var, default 7
"""
from __future__ import annotations

import hmac
import logging
import os
import secrets
import sqlite3
from datetime import datetime, timedelta, timezone

from fastapi import Cookie, Depends, HTTPException, Response, status
from itsdangerous import BadSignature, URLSafeTimedSerializer

from . import db

log = logging.getLogger("wuwaid-quests.auth")

SESSION_COOKIE = "wuwaid_editor"
SESSION_MAX_AGE_DAYS = int(os.environ.get("SESSION_DAYS", "7"))


def _secret() -> bytes:
    s = os.environ.get("SESSION_SECRET")
    if s:
        return s.encode("utf-8")
    fallback = secrets.token_hex(32)
    log.warning(
        "SESSION_SECRET not set; generated a one-time fallback. "
        "Sessions will not survive a server restart. Set SESSION_SECRET in .env."
    )
    return fallback.encode("utf-8")


def _serializer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(_secret(), salt="wuwaid-editor-session")


def check_password(submitted: str) -> bool:
    expected = os.environ.get("EDITOR_PASSWORD", "")
    if not expected:
        return False
    return hmac.compare_digest(submitted.encode("utf-8"), expected.encode("utf-8"))


def make_session_token(role: str) -> str:
    """Mint a session token, persist it in editor_session, return signed cookie value."""
    raw = secrets.token_urlsafe(32)
    con = db._con()  # noqa: SLF001 — internal helper, acceptable for auth
    try:
        now = datetime.now(timezone.utc)
        expires = now + timedelta(days=SESSION_MAX_AGE_DAYS)
        con.execute(
            "INSERT INTO editor_session VALUES (?, ?, ?)",
            (raw, now.isoformat(), expires.isoformat()),
        )
        con.commit()
    finally:
        con.close()
    return _serializer().dumps({"token": raw, "role": role})


def read_session_cookie(cookie_value: str) -> str | None:
    """Verify a signed cookie value, look up the token, return role or None."""
    try:
        payload = _serializer().loads(cookie_value, max_age=SESSION_MAX_AGE_DAYS * 86400)
    except BadSignature:
        return None
    raw = payload.get("token")
    if not raw:
        return None
    con = db._con()  # noqa: SLF001
    try:
        row = con.execute(
            "SELECT expires_at FROM editor_session WHERE token = ?", (raw,)
        ).fetchone()
    finally:
        con.close()
    if row is None:
        return None
    expires_at = datetime.fromisoformat(row["expires_at"])
    if expires_at < datetime.now(timezone.utc):
        return None
    return payload.get("role", "editor")


def get_role(cookie: str | None = Cookie(default=None, alias=SESSION_COOKIE)) -> str:
    if not cookie:
        return "anon"
    role = read_session_cookie(cookie)
    return role or "anon"


def require_editor(role: str = Depends(get_role)) -> str:
    if role != "editor":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "editor login required")
    return role


def revoke_session(cookie_value: str | None) -> None:
    if not cookie_value:
        return
    role = read_session_cookie(cookie_value)
    if not role:
        return
    try:
        payload = _serializer().loads(cookie_value, max_age=SESSION_MAX_AGE_DAYS * 86400)
    except BadSignature:
        return
    raw = payload.get("token")
    if not raw:
        return
    con = db._con()  # noqa: SLF001
    try:
        con.execute("DELETE FROM editor_session WHERE token = ?", (raw,))
        con.commit()
    finally:
        con.close()
