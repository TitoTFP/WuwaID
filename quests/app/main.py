"""FastAPI app: static dist + /api/* endpoints."""
from __future__ import annotations

import json
import os
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import db

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


def _merged_quest_meta(qid: int) -> tuple[str, str, dict[int, dict]]:
    """Load + merge a quest; return (quest_name, chapter_name, line_overrides)."""
    p = QUESTS_DIR / f"{qid}.json"
    if not p.is_file():
        return ("", "", {})
    quest = json.loads(p.read_text(encoding="utf-8"))
    db.apply_edits(qid, quest)
    overrides = {l["id"]: l for l in quest["all_lines"]}
    return (
        quest.get("quest_name", ""),
        quest.get("chapter_name", ""),
        overrides,
    )


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
        _, _, overrides = _merged_quest_meta(qid)
        for h in group:
            line = overrides.get(h["line_id"])
            if line is None:
                continue
            text = line.get(f"text_{lang}", "")
            if text:
                h["text"] = text
    return JSONResponse(hits)


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
