"""FastAPI app: static dist + /api/* endpoints."""
from __future__ import annotations

import json
import os
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import db
from .auth import (
    SESSION_COOKIE,
    SESSION_MAX_AGE_DAYS,
    check_password,
    get_role,
    make_session_token,
    require_editor,  # noqa: F401 — wired to /api/drafts/{id}/approve in Task 7+
    revoke_session,
)

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = REPO_ROOT / "data"
QUESTS_DIR = DATA_DIR / "quests"
DIST_DIR = REPO_ROOT / "web" / "dist"

app = FastAPI(title="wuwaid-quests", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def _startup():
    if not (DATA_DIR / "index.db").is_file():
        raise RuntimeError(
            f"index.db not found at {DATA_DIR / 'index.db'}. "
            "Run `uv run python scripts/build_index.py` first."
        )
    db.set_db_path(DATA_DIR / "index.db")
    db.ensure_editor_schema()


# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------

@app.get("/api/chapters")
def api_chapters():
    p = DATA_DIR / "chapters.json"
    if not p.is_file():
        raise HTTPException(404, "chapters.json missing")
    return JSONResponse(json.loads(p.read_text(encoding="utf-8")))


@app.get("/api/speakers")
def api_speakers():
    return JSONResponse(db.list_speakers())


@app.get("/api/quests")
def api_quests(
    side: int | None = Query(None, ge=0, le=1),
    type: int | None = Query(None, alias="quest_type"),
    spk: str | None = Query(None),
    has_options: bool | None = Query(None),
    q: str | None = Query(None),
    sort: str = Query("id"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
):
    return db.list_quests(
        side=side,
        quest_type=type,
        speaker=spk,
        has_options=has_options,
        q=q,
        sort=sort,
        page=page,
        page_size=page_size,
    )


def _load_quest_overrides(qid: int) -> dict[int, dict]:
    """Load + merge a quest; return a {line_id: line} map post-merge.

    Returns an empty dict if the quest JSON is missing (e.g. stale search
    hit). Callers should treat that as "no override to apply".
    """
    p = QUESTS_DIR / f"{qid}.json"
    if not p.is_file():
        return {}
    quest = json.loads(p.read_text(encoding="utf-8"))
    db.apply_edits(qid, quest)
    return {l["id"]: l for l in quest["all_lines"]}


@app.get("/api/quests/{qid}")
def api_quest(qid: int):
    p = QUESTS_DIR / f"{qid}.json"
    if not p.is_file():
        raise HTTPException(404, f"quest {qid} not found")
    quest = json.loads(p.read_text(encoding="utf-8"))
    return JSONResponse(db.apply_edits(qid, quest))


@app.get("/api/search")
def api_search(
    q: str = Query(..., min_length=1),
    lang: str = Query("en", pattern="^(en|zh|ja)$"),
    side: int | None = Query(None, ge=0, le=1),
    quest_type: int | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
):
    hits = db.search(q, lang=lang, side=side, quest_type=quest_type, limit=limit)
    by_qid: dict[int, list[dict]] = {}
    for h in hits:
        by_qid.setdefault(h["qid"], []).append(h)
    for qid, group in by_qid.items():
        overrides = _load_quest_overrides(qid)
        for h in group:
            line = overrides.get(h["line_id"])
            if line is None:
                continue
            text = line.get(f"text_{lang}", "")
            if text:
                h["text"] = text
    return JSONResponse(hits)


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------


@app.post("/api/login")
def api_login(payload: dict, response: Response):
    if not os.environ.get("EDITOR_PASSWORD"):
        raise HTTPException(503, "editor login not configured (EDITOR_PASSWORD unset)")
    if not check_password(str(payload.get("password", ""))):
        raise HTTPException(401, "wrong password")
    token = make_session_token("editor")
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=SESSION_MAX_AGE_DAYS * 86400,
        httponly=True,
        samesite="lax",
    )
    return {"role": "editor"}


@app.post("/api/logout")
def api_logout(request: Request, response: Response):
    raw = request.cookies.get(SESSION_COOKIE)
    revoke_session(raw)
    response.delete_cookie(SESSION_COOKIE)
    return {"role": "anon"}


@app.get("/api/me")
def api_me(role: str = Depends(get_role)):
    return {"role": role}


# ---------------------------------------------------------------------------
# Editor: lines + drafts
# ---------------------------------------------------------------------------


@app.get("/api/editor/quest/{qid}")
def api_editor_quest(qid: int):
    p = QUESTS_DIR / f"{qid}.json"
    if not p.is_file():
        raise HTTPException(404, f"quest {qid} not found")
    quest = json.loads(p.read_text(encoding="utf-8"))
    return JSONResponse(db.apply_edits(qid, quest))


@app.get("/api/editor/quest/{qid}/lines")
def api_editor_quest_lines(qid: int):
    p = QUESTS_DIR / f"{qid}.json"
    if not p.is_file():
        raise HTTPException(404, f"quest {qid} not found")
    quest = json.loads(p.read_text(encoding="utf-8"))
    db.apply_edits(qid, quest)
    con = db.connect()
    try:
        edited = {
            r["line_id"]
            for r in con.execute("SELECT line_id FROM edits WHERE qid = ?", (qid,)).fetchall()
        }
    finally:
        con.close()
    items = [
        {
            "id": l.get("id"),
            "type": l.get("type"),
            "state_key": l.get("state_key"),
            "speaker_en": l.get("speaker_en", ""),
            "text_en": l.get("text_en", ""),
            "is_edited": l.get("id") in edited,
        }
        for l in quest["all_lines"]
    ]
    return JSONResponse(items)


def _author_label(request: Request) -> str | None:
    return request.headers.get("X-Author-Label") or None


@app.post("/api/editor/drafts")
def api_create_draft(payload: dict, request: Request):
    qid = int(payload["qid"])
    line_id = int(payload["line_id"])
    patch = payload.get("patch", {})
    if not isinstance(patch, dict):
        raise HTTPException(422, "patch must be an object")
    position_after = payload.get("position_after")
    if position_after is not None:
        position_after = int(position_after)
    did = db.create_draft(
        qid=qid,
        line_id=line_id,
        patch=patch,
        author_label=_author_label(request),
        note=payload.get("note"),
        position_after=position_after,
    )
    return {"id": did}


@app.put("/api/editor/drafts/{draft_id}")
def api_update_draft(draft_id: int, payload: dict, request: Request):
    db.update_draft(
        draft_id,
        author_label=_author_label(request),
        patch=payload.get("patch", {}),
    )
    return {"ok": True}


@app.delete("/api/editor/drafts/{draft_id}")
def api_delete_draft(draft_id: int, request: Request):
    db.delete_draft(draft_id, author_label=_author_label(request))
    return {"ok": True}


@app.get("/api/drafts")
def api_list_drafts(request: Request, role: str = Depends(get_role)):
    if role == "editor":
        return JSONResponse(db.list_drafts(scope="all", author_label=None))
    return JSONResponse(
        db.list_drafts(scope="mine", author_label=_author_label(request))
    )


@app.get("/api/drafts/{draft_id}")
def api_get_draft(draft_id: int, request: Request, role: str = Depends(get_role)):
    d = db.get_draft(draft_id)
    if d is None:
        raise HTTPException(404, "draft not found")
    if role != "editor" and d["author_label"] != _author_label(request):
        raise HTTPException(403, "not your draft")
    return JSONResponse(d)


@app.post("/api/drafts/{draft_id}/approve")
def api_approve_draft(draft_id: int, role: str = Depends(require_editor)):
    try:
        db.approve_draft(draft_id, approver=role)
    except ValueError as e:
        msg = str(e)
        if "branch target" in msg or "state_key" in msg:
            raise HTTPException(422, msg)
        if "target line" in msg:
            raise HTTPException(409, msg)
        if "already" in msg:
            raise HTTPException(409, msg)
        raise HTTPException(400, msg)
    return {"ok": True}


@app.post("/api/drafts/{draft_id}/reject")
def api_reject_draft(draft_id: int, role: str = Depends(require_editor)):
    try:
        db.reject_draft(draft_id, approver=role)
    except ValueError as e:
        msg = str(e)
        if "already" in msg:
            raise HTTPException(409, msg)
        raise HTTPException(400, msg)
    return {"ok": True}


# ---------------------------------------------------------------------------
# Static (web/dist if built)
# ---------------------------------------------------------------------------

if DIST_DIR.is_dir():
    # Serve assets and SPA fallback to index.html
    app.mount(
        "/assets",
        StaticFiles(directory=str(DIST_DIR / "assets")),
        name="assets",
    )

    @app.api_route("/{full_path:path}", methods=["GET", "HEAD"])
    def spa_fallback(full_path: str):
        # Don't shadow /api
        if full_path.startswith("api/"):
            raise HTTPException(404)
        candidate = DIST_DIR / full_path
        if candidate.is_file():
            return FileResponse(str(candidate))
        return FileResponse(str(DIST_DIR / "index.html"))

    @app.api_route("/", methods=["GET", "HEAD"])
    def root():
        return FileResponse(str(DIST_DIR / "index.html"))
else:
    @app.api_route("/", methods=["GET", "HEAD"])
    def root_no_build():
        return JSONResponse(
            {
                "detail": "web/dist not built. Run `bun run build` then `bun run serve`.",
                "api_docs": "/docs",
            }
        )
