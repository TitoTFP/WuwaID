"""FastAPI app: static dist + /api/* endpoints."""
from __future__ import annotations

import json
import os
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from functools import lru_cache

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
app.add_middleware(GZipMiddleware, minimum_size=500)


def _json(payload: object) -> Response:
    return Response(
        content=json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8"),
        media_type="application/json",
    )


@lru_cache(maxsize=64)
def _load_quest_cached(qid: int, mtime_ns: int) -> dict:
    """Cache loaded quest JSON. mtime_ns invalidates the entry on file change."""
    p = QUESTS_DIR / f"{qid}.json"
    return json.loads(p.read_text(encoding="utf-8"))


def _load_quest(qid: int) -> dict | None:
    p = QUESTS_DIR / f"{qid}.json"
    if not p.is_file():
        return None
    st = p.stat()
    return _load_quest_cached(qid, st.st_mtime_ns)


def _merge_id_translation(quest: dict, qid: int) -> bool:
    """Overlay `text_id` / `speaker_id` from data/quests_id/<qid>.json onto
    `quest['all_lines']`. Returns True iff at least one line was merged.

    Editor overlays from `apply_edits` are already in `quest['all_lines']`
    when this function runs. We respect any already-set `text_id` /
    `speaker_id` / `options[i].text_id` (editor-wins).
    """
    import sys
    quests_id_dir = DATA_DIR / "quests_id"
    id_path = quests_id_dir / f"{qid}.json"
    if not id_path.is_file():
        return False
    try:
        id_data = json.loads(id_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as e:
        print(f"WARN: cannot read {id_path}: {e}", file=sys.stderr)
        return False

    # Build a text_key → entry map; line_id as fallback.
    by_text_key: dict[str, dict] = {}
    by_line_id: dict[int, dict] = {}
    for state in (id_data.get("states") or {}).values():
        if not isinstance(state, dict) or "error" in state:
            continue
        for entry in (state.get("lines") or []):
            if not isinstance(entry, dict):
                continue
            tk = entry.get("text_key")
            lid = entry.get("line_id")
            if tk:
                by_text_key.setdefault(tk, entry)
            if lid is not None:
                by_line_id.setdefault(int(lid), entry)

    merged_count = 0
    for line in quest.get("all_lines") or []:
        tk = line.get("text_key")
        lid = line.get("id")
        entry = by_text_key.get(tk) if tk else None
        if entry is None and lid is not None:
            entry = by_line_id.get(int(lid))
        if entry is None:
            continue
        # Editor-wins: skip if already set.
        if not line.get("text_id"):
            tid = entry.get("text_id")
            if tid is not None:
                line["text_id"] = tid
                merged_count += 1
        if not line.get("speaker_id"):
            sid = entry.get("speaker_id")
            if sid is not None:
                line["speaker_id"] = sid
        # Options: build a text_key → text_id map from the entry, then overlay.
        if line.get("options") and entry.get("options"):
            opt_lookup = {
                o.get("text_key"): o.get("text_id")
                for o in entry["options"]
                if isinstance(o, dict) and o.get("text_key")
            }
            for opt in line["options"]:
                if opt.get("text_id"):
                    continue  # editor wins
                otk = opt.get("text_key")
                if otk and otk in opt_lookup and opt_lookup[otk] is not None:
                    opt["text_id"] = opt_lookup[otk]
    return merged_count > 0


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
    return _json(json.loads(p.read_text(encoding="utf-8")))


@app.get("/api/speakers")
def api_speakers():
    return _json(db.list_speakers())


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
    quest = _load_quest(qid)
    if quest is None:
        return {}
    db.apply_edits(qid, quest)
    _merge_id_translation(quest, qid)
    return {l["id"]: l for l in quest["all_lines"]}


@app.get("/api/quests/{qid}")
def api_quest(qid: int):
    quest = _load_quest(qid)
    if quest is None:
        raise HTTPException(404, f"quest {qid} not found")
    db.apply_edits(qid, quest)  # EN/ZH/JA/ID overlay (text_id/speaker_id)
    id_merged = _merge_id_translation(quest, qid)  # NEW: overlay MT output
    plot_mode_by_state: dict[str, str] = {}
    for f in quest.get("flows", []):
        for s in f.get("states") or []:
            plot_mode_by_state[s["state_key"]] = s["plot_mode"]
    languages = list(quest.get("languages") or [])
    if id_merged and "id" not in languages:
        languages.append("id")
    return _json({
        "quest_id": quest["quest_id"],
        "quest_name": quest["quest_name"],
        "quest_type": quest["quest_type"],
        "languages": languages,
        "total_lines": quest["total_lines"],
        "all_lines": quest["all_lines"],
        "plot_mode_by_state": plot_mode_by_state,
        "side": quest.get("side", 0),
        "chapter_id": quest.get("chapter_id"),
        "chapter_name": quest.get("chapter_name"),
    })


@app.get("/api/categories")
def api_categories():
    cat_dir = DATA_DIR / "categories"
    if not cat_dir.is_dir():
        return _json([])
    files = sorted(cat_dir.glob("*.json"))
    categories = [f.stem for f in files]
    # Try to enrich with DB metadata if available
    import sqlite3 as _sqlite3
    db_path = DATA_DIR / "index.db"
    if db_path.is_file():
        try:
            con = _sqlite3.connect(str(db_path))
            rows = con.execute(
                "SELECT name, key_count, translated_count FROM categories ORDER BY name"
            ).fetchall()
            con.close()
            meta = {n: (kc, tc) for n, kc, tc in rows}
            enriched = []
            for name in categories:
                kc, tc = meta.get(name, (0, 0))
                enriched.append({"name": name, "key_count": kc, "translated_count": tc})
            return _json(enriched)
        except Exception:
            pass
    return _json([{"name": n, "key_count": 0, "translated_count": 0} for n in categories])


@app.get("/api/categories/{name}")
def api_category(
    name: str,
    q: str | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(100, ge=1, le=1000),
):
    p = DATA_DIR / "categories" / f"{name}.json"
    if not p.is_file():
        raise HTTPException(404, f"Category {name} not found")
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except Exception as e:
        raise HTTPException(500, f"Error reading category file: {e}")

    items = []
    for k, val in data.items():
        item = {"key": k}
        item.update(val)
        items.append(item)

    if q:
        q_lower = q.lower()
        items = [
            i for i in items
            if q_lower in i["key"].lower()
            or any(q_lower in str(v).lower() for k, v in i.items() if k != "key")
        ]

    total = len(items)
    start = (page - 1) * page_size
    end = start + page_size
    return _json({
        "category": name,
        "total": total,
        "page": page,
        "page_size": page_size,
        "items": items[start:end]
    })


@app.get("/api/category/{name}")
def api_category_single(name: str):
    """Get a single category's entries, merged with `id` translation if available."""
    cat_path = DATA_DIR / "categories" / f"{name}.json"
    if not cat_path.is_file():
        raise HTTPException(404, f"Category {name} not found")
    with cat_path.open(encoding="utf-8") as f:
        cat_data = json.load(f)
    id_map: dict[str, str] = {}
    id_path = DATA_DIR / "categories_id" / f"{name}.json"
    if id_path.is_file():
        try:
            id_data = json.loads(id_path.read_text(encoding="utf-8"))
            for k, v in id_data.items():
                if isinstance(v, dict) and v.get("id"):
                    id_map[k] = v["id"]
        except (json.JSONDecodeError, OSError):
            pass

    entries = []
    for key, value in cat_data.items():
        if not isinstance(value, dict):
            continue
        entries.append({
            "key": key,
            "zh-Hans": value.get("zh-Hans", ""),
            "en": value.get("en", ""),
            "ja": value.get("ja", ""),
            "id": id_map.get(key),
        })

    return _json({
        "name": name,
        "languages": ["zh-Hans", "en", "ja", "id"],
        "entries": entries,
    })


@app.get("/api/search")
def api_search(
    q: str = Query(..., min_length=1),
    lang: str = Query("en", pattern="^(en|zh|ja|id)$"),
    side: int | None = Query(None, ge=0, le=1),
    quest_type: int | None = Query(None),
    scope: str = Query("quest", pattern="^(quest|category)$"),
    limit: int = Query(50, ge=1, le=200),
):
    import sqlite3 as _sqlite3
    if scope == "category":
        data_dir = DATA_DIR
        db_path = data_dir / "index.db"
        if not db_path.is_file():
            return _json({"results": [], "total": 0})
        con = _sqlite3.connect(str(db_path))
        con.row_factory = _sqlite3.Row
        table = "category_text_idx"
        text_col = f"text_{lang}"
        try:
            cur = con.execute(
                f"SELECT category, key, text_en, text_id FROM {table} WHERE {text_col} MATCH ? LIMIT ?",
                (q, limit),
            )
            results = [
                {"category": row["category"], "key": row["key"], "text": row["text_id"] or row["text_en"]}
                for row in cur.fetchall()
            ]
        finally:
            con.close()
        return _json({"results": results, "total": len(results)})
    hits = db.search(q, lang=lang, side=side, quest_type=quest_type, limit=limit)
    by_qid: dict[int, list[dict]] = {}
    for h in hits:
        by_qid.setdefault(h["qid"], []).append(h)
    for qid, group in by_qid.items():
        overrides = _load_quest_overrides(qid)
        text_key = {
            "en": "text_en",
            "zh": "text_zh-Hans",
            "ja": "text_ja",
            "id": "text_id",
        }[lang]
        for h in group:
            line = overrides.get(h["line_id"])
            if line is None:
                continue
            text = line.get(text_key, "")
            if text:
                h["text"] = text
    seen = {(h["qid"], h["line_id"]) for h in hits}
    remaining = max(0, limit - len(hits))
    if remaining:
        for h in db.search_overlays(q, lang=lang, side=side, quest_type=quest_type, limit=remaining):
            key = (h["qid"], h["line_id"])
            if key in seen:
                continue
            hits.append(h)
            seen.add(key)
            if len(hits) >= limit:
                break
    return _json(hits)


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
    quest = _load_quest(qid)
    if quest is None:
        raise HTTPException(404, f"quest {qid} not found")
    return _json(db.apply_edits(qid, quest))


@app.get("/api/editor/quest/{qid}/lines")
def api_editor_quest_lines(qid: int):
    quest = _load_quest(qid)
    if quest is None:
        raise HTTPException(404, f"quest {qid} not found")
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
    return _json(items)


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
def api_update_draft(draft_id: int, payload: dict, request: Request, role: str = Depends(get_role)):
    author_label = None if role == "editor" else _author_label(request)
    if role != "editor" and author_label is None:
        raise HTTPException(403, "author label required")
    try:
        db.update_draft(draft_id, author_label=author_label, patch=payload.get("patch", {}))
    except PermissionError as e:
        raise HTTPException(403, str(e))
    except ValueError as e:
        msg = str(e)
        raise HTTPException(409 if "already" in msg else 404, msg)
    return {"ok": True}


@app.delete("/api/editor/drafts/{draft_id}")
def api_delete_draft(draft_id: int, request: Request, role: str = Depends(get_role)):
    author_label = None if role == "editor" else _author_label(request)
    if role != "editor" and author_label is None:
        raise HTTPException(403, "author label required")
    try:
        db.delete_draft(draft_id, author_label=author_label)
    except PermissionError as e:
        raise HTTPException(403, str(e))
    except ValueError as e:
        raise HTTPException(409, str(e))
    return {"ok": True}


@app.get("/api/drafts")
def api_list_drafts(request: Request, role: str = Depends(get_role)):
    if role == "editor":
        return _json(db.list_drafts(scope="all", author_label=None))
    return _json(
        db.list_drafts(scope="mine", author_label=_author_label(request))
    )


@app.get("/api/drafts/{draft_id}")
def api_get_draft(draft_id: int, request: Request, role: str = Depends(get_role)):
    d = db.get_draft_with_diff(draft_id)
    if d is None:
        raise HTTPException(404, "draft not found")
    if role != "editor" and d["author_label"] != _author_label(request):
        raise HTTPException(403, "not your draft")
    return _json(d)


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


@app.post("/api/editor/export")
def api_export_translations(payload: dict | None = None, role: str = Depends(get_role)):
    if role != "editor":
        raise HTTPException(403, "editor role required to export")
    try:
        quest_ids = payload.get("quest_ids") if payload else None
        category_names = payload.get("category_names") if payload else None
        only_untranslated = payload.get("only_untranslated", False) if payload else False
        
        if quest_ids or category_names:
            from .export import export_selective_translations
            exported = export_selective_translations(REPO_ROOT, quest_ids, category_names, only_untranslated)
            return {"ok": True, "files": exported}
        else:
            from .export import export_indonesian_translations
            export_indonesian_translations(REPO_ROOT)
            return {"ok": True, "files": ["lang_multi_text.db", "lang_multi_text_1sthalf.db"]}
    except Exception as e:
        raise HTTPException(500, f"Export failed: {e}")


@app.post("/api/editor/import")
def api_import_translations(payload: dict, role: str = Depends(get_role)):
    if role != "editor":
        raise HTTPException(403, "editor role required to import")
    db_path_str = payload.get("db_path")
    if not db_path_str:
        raise HTTPException(422, "db_path parameter is required")
    db_path = Path(db_path_str)
    if not db_path.is_file():
        raise HTTPException(404, f"Database file not found at: {db_path_str}")
        
    try:
        from .import_translations import import_translations_from_db
        stats = import_translations_from_db(REPO_ROOT, db_path)
        return {"ok": True, "stats": stats}
    except Exception as e:
        raise HTTPException(500, f"Import failed: {str(e)}")


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
        return _json(
            {
                "detail": "web/dist not built. Run `bun run build` then `bun run serve`.",
                "api_docs": "/docs",
            }
        )
