"""FastAPI app: static dist + /api/* endpoints."""
from __future__ import annotations

import json
import os
import re
import tempfile
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from functools import lru_cache
from starlette.background import BackgroundTask
from scripts.translate_id.glossary import load_glossary, terms_for_state

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


def _prepare_category_fts_query(q: str, lang: str) -> str:
    if lang in ("zh", "ja"):
        return db._prepare_fts_query(q, lang)  # type: ignore[attr-defined]
    tokens = re.findall(r"\w+", q, flags=re.UNICODE)
    return " ".join(f'"{token}"*' for token in tokens)


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


@lru_cache(maxsize=4)
def _load_glossary_cached(path: str, mtime_ns: int) -> dict[str, dict]:
    return load_glossary(Path(path))


def _glossary() -> dict[str, dict]:
    path = DATA_DIR / "glossary.json"
    if not path.is_file():
        return {}
    return _load_glossary_cached(str(path), path.stat().st_mtime_ns)


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
            lid = entry.get("line_id") or entry.get("id")
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

    # Merge approved edits from category_edits
    con = db.connect()
    try:
        has_table = con.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='category_edits'").fetchone()
        edits = {}
        if has_table:
            edits = {
                row["key"]: row["text_id"]
                for row in con.execute("SELECT key, text_id FROM category_edits WHERE category = ?", (name,)).fetchall()
            }
    finally:
        con.close()

    entries = []
    for key, value in cat_data.items():
        if not isinstance(value, dict):
            continue
        text_id = edits.get(key)
        if text_id is None or text_id == "":
            text_id = id_map.get(key)
        entries.append({
            "key": key,
            "zh-Hans": value.get("zh-Hans", ""),
            "en": value.get("en", ""),
            "ja": value.get("ja", ""),
            "id": text_id,
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
            fts_query = _prepare_category_fts_query(q, lang)
            fts_part = f"SELECT category, key, text_en, text_id, 0 AS is_key_match FROM {table} WHERE {text_col} MATCH ?"
            key_part = f"SELECT category, key, text_en, text_id, 1 AS is_key_match FROM {table} WHERE key LIKE ?"
            sql = f"""
                SELECT category, key, text_en, text_id, is_key_match
                FROM (
                    {fts_part}
                    UNION ALL
                    {key_part}
                )
                ORDER BY is_key_match DESC
            """
            try:
                if fts_query:
                    cur = con.execute(sql, (fts_query, f"%{q}%"))
                    rows = cur.fetchall()
                else:
                    cur = con.execute(
                        f"SELECT category, key, text_en, text_id, 1 AS is_key_match FROM {table} WHERE key LIKE ?",
                        (f"%{q}%",),
                    )
                    rows = cur.fetchall()
            except _sqlite3.OperationalError:
                cur = con.execute(
                    f"SELECT category, key, text_en, text_id, 1 AS is_key_match FROM {table} WHERE key LIKE ?",
                    (f"%{q}%",),
                )
                rows = cur.fetchall()
            
            seen = set()
            results = []
            for row in rows:
                item_key = (row["category"], row["key"])
                if item_key in seen:
                    continue
                seen.add(item_key)
                results.append({
                    "category": row["category"],
                    "key": row["key"],
                    "text": row["text_id"] or row["text_en"]
                })
                if len(results) >= limit:
                    break
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
# Official-text version history (editor only)
# ---------------------------------------------------------------------------

def _version_history_path() -> Path:
    return DATA_DIR / "version_history.db"


def _default_version_pair(base: str | None, target: str | None) -> tuple[str, str]:
    if base and target:
        return base, target
    from .text_versions import list_versions
    versions = list_versions(_version_history_path())
    if len(versions) < 2:
        raise HTTPException(409, "at least two saved versions are required")
    return base or versions[1]["tag"], target or versions[0]["tag"]


@app.get("/api/editor/versions")
def api_versions(role: str = Depends(require_editor)):
    from .text_versions import list_versions
    return _json(list_versions(_version_history_path()))


@app.post("/api/editor/versions")
def api_create_version(payload: dict, role: str = Depends(require_editor)):
    from .text_versions import create_snapshot
    tag = str(payload.get("tag") or "").strip()
    note = payload.get("note")
    if note is not None and not isinstance(note, str):
        raise HTTPException(422, "note must be a string")
    try:
        return _json(create_snapshot(_version_history_path(), DATA_DIR, tag, note))
    except (FileNotFoundError, ValueError, json.JSONDecodeError) as exc:
        raise HTTPException(400, str(exc)) from exc


@app.get("/api/editor/versions/diff")
def api_version_diff(
    base: str | None = Query(None),
    target: str | None = Query(None),
    lang: str = Query("en"),
    status: str = Query("added,removed,changed"),
    q: str | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(100, ge=1, le=500),
    role: str = Depends(require_editor),
):
    from .text_versions import diff_page
    base, target = _default_version_pair(base, target)
    try:
        result = diff_page(
            _version_history_path(), DATA_DIR, base, target, lang,  # type: ignore[arg-type]
            [part for part in status.split(",") if part], q, page, page_size,
        )
        return _json(result)
    except (FileNotFoundError, ValueError, json.JSONDecodeError) as exc:
        raise HTTPException(400, str(exc)) from exc


@app.get("/api/editor/versions/diff/groups")
def api_version_diff_groups(
    base: str | None = Query(None),
    target: str | None = Query(None),
    lang: str = Query("en"),
    role: str = Depends(require_editor),
):
    from .text_versions import diff_groups
    base, target = _default_version_pair(base, target)
    try:
        return _json(diff_groups(
            _version_history_path(), DATA_DIR, base, target, lang  # type: ignore[arg-type]
        ))
    except (FileNotFoundError, ValueError, json.JSONDecodeError) as exc:
        raise HTTPException(400, str(exc)) from exc


@app.post("/api/editor/versions/diff/export-structured")
def api_export_structured_version_diff(
    payload: dict,
    role: str = Depends(require_editor),
):
    from .text_versions import export_structured_zip
    base, target = _default_version_pair(payload.get("base"), payload.get("target"))
    lang = str(payload.get("lang") or "en")
    groups = payload.get("groups")
    if not isinstance(groups, list) or not all(isinstance(group, str) for group in groups):
        raise HTTPException(422, "groups must be a list of group ids")
    fd, raw_path = tempfile.mkstemp(prefix="wuwaid-structured-diff-", suffix=".zip")
    os.close(fd)
    output = Path(raw_path)
    try:
        export_structured_zip(
            output, _version_history_path(), DATA_DIR, base, target,
            lang, groups,  # type: ignore[arg-type]
        )
    except (FileNotFoundError, ValueError, json.JSONDecodeError) as exc:
        output.unlink(missing_ok=True)
        raise HTTPException(400, str(exc)) from exc
    except Exception:
        output.unlink(missing_ok=True)
        raise
    safe_base = re.sub(r"[^A-Za-z0-9._-]+", "-", base)
    safe_target = re.sub(r"[^A-Za-z0-9._-]+", "-", target)
    filename = f"{safe_base}_to_{safe_target}_{lang}_structured.zip"
    return FileResponse(
        output,
        filename=filename,
        media_type="application/zip",
        background=BackgroundTask(output.unlink, missing_ok=True),
    )


@app.get("/api/editor/versions/diff/export")
def api_export_version_diff(
    format: str = Query(..., pattern="^(sqlite|csv)$"),
    base: str | None = Query(None),
    target: str | None = Query(None),
    lang: str = Query("en"),
    role: str = Depends(require_editor),
):
    from .text_versions import diff_rows, export_csv, export_sqlite
    base, target = _default_version_pair(base, target)
    try:
        rows, _summary = diff_rows(
            _version_history_path(), DATA_DIR, base, target, lang  # type: ignore[arg-type]
        )
    except (FileNotFoundError, ValueError, json.JSONDecodeError) as exc:
        raise HTTPException(400, str(exc)) from exc
    suffix = ".db" if format == "sqlite" else ".csv"
    fd, raw_path = tempfile.mkstemp(prefix="wuwaid-version-diff-", suffix=suffix)
    os.close(fd)
    output = Path(raw_path)
    try:
        (export_sqlite if format == "sqlite" else export_csv)(output, rows)
    except Exception:
        output.unlink(missing_ok=True)
        raise
    safe_base = re.sub(r"[^A-Za-z0-9._-]+", "-", base)
    safe_target = re.sub(r"[^A-Za-z0-9._-]+", "-", target)
    filename = f"{safe_base}_to_{safe_target}_{lang}{suffix}"
    media_type = "application/vnd.sqlite3" if format == "sqlite" else "text/csv; charset=utf-8"
    return FileResponse(
        output,
        filename=filename,
        media_type=media_type,
        background=BackgroundTask(output.unlink, missing_ok=True),
    )


# ---------------------------------------------------------------------------
# Editor: lines + drafts
# ---------------------------------------------------------------------------


@app.get("/api/editor/quest/{qid}")
def api_editor_quest(qid: int):
    quest = _load_quest(qid)
    if quest is None:
        raise HTTPException(404, f"quest {qid} not found")
    _merge_id_translation(quest, qid)
    return _json(db.apply_edits(qid, quest))


@app.get("/api/editor/quest/{qid}/lines")
def api_editor_quest_lines(qid: int):
    quest = _load_quest(qid)
    if quest is None:
        raise HTTPException(404, f"quest {qid} not found")
    _merge_id_translation(quest, qid)
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


@app.get("/api/editor/category/{name}/entries")
def api_editor_category_entries(name: str):
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

    # Merge approved edits from category_edits
    con = db.connect()
    try:
        has_table = con.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='category_edits'").fetchone()
        edits = {}
        if has_table:
            edits = {
                row["key"]: row["text_id"]
                for row in con.execute("SELECT key, text_id FROM category_edits WHERE category = ?", (name,)).fetchall()
            }
    finally:
        con.close()

    entries = []
    for key, value in cat_data.items():
        if not isinstance(value, dict):
            continue
        text_id = edits.get(key)
        if text_id is None or text_id == "":
            text_id = id_map.get(key)
        entries.append({
            "key": key,
            "prefix": key.split("_", 1)[0] if "_" in key else "NoPrefix",
            "zh-Hans": value.get("zh-Hans", ""),
            "en": value.get("en", ""),
            "ja": value.get("ja", ""),
            "id": text_id,
            "is_edited": key in edits,
        })
    return _json(entries)


@app.post("/api/editor/category/drafts")
def api_create_category_draft(payload: dict, request: Request):
    category = payload["category"]
    key = payload["key"]
    patch = payload.get("patch", {})
    if not isinstance(patch, dict):
        raise HTTPException(422, "patch must be an object")
    did = db.create_category_draft(
        category=category,
        key=key,
        patch=patch,
        author_label=_author_label(request),
        note=payload.get("note"),
    )
    return {"id": did}


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
        update_args = {
            "author_label": author_label,
            "patch": payload.get("patch", {}),
        }
        if "note" in payload:
            note = payload["note"]
            if note is not None and not isinstance(note, str):
                raise HTTPException(422, "note must be a string or null")
            update_args["note"] = note
        db.update_draft(draft_id, **update_args)
    except PermissionError as e:
        raise HTTPException(403, str(e))
    except ValueError as e:
        msg = str(e)
        raise HTTPException(409 if "already" in msg else 404, msg)
    return {"ok": True}


@app.post("/api/editor/glossary/matches")
def api_glossary_matches(payload: dict):
    texts = payload.get("texts")
    if not isinstance(texts, list) or not all(isinstance(text, str) for text in texts):
        raise HTTPException(422, "texts must be an array of strings")
    if len(texts) > 32 or sum(len(text) for text in texts) > 20_000:
        raise HTTPException(422, "texts payload is too large")
    glossary = _glossary()
    terms = terms_for_state(glossary, [{"text_en": " ".join(texts), "options": []}])
    terms.sort(key=lambda term: (-len(term), term.casefold()))
    matches = []
    for term in terms[:50]:
        entry = glossary.get(term, {})
        matches.append({
            "term": term,
            "indonesian_translation": str(entry.get("indonesian_translation", "")),
            "category": str(entry.get("category", "")),
        })
    return _json(matches)


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
        export_mode = payload.get("export_mode") if payload else None
        only_untranslated = (
            export_mode == "untranslated"
            or (not export_mode and (payload.get("only_untranslated", False) if payload else False))
        )
        english_full = export_mode == "english_full"
        prefix_filters = payload.get("prefix_filters") if payload else None
        type_filters = payload.get("type_filters") if payload else None
        search_filter = payload.get("search_filter") if payload else None
        
        if quest_ids or category_names:
            from .export import export_selective_translations
            exported = export_selective_translations(
                REPO_ROOT,
                quest_ids=quest_ids,
                category_names=category_names,
                only_untranslated=only_untranslated,
                english_full=english_full,
                prefix_filters=prefix_filters,
                type_filters=type_filters,
                search_filter=search_filter,
            )
            return {"ok": True, "files": exported}
        else:
            if english_full:
                from .export import export_english_translations
                files = export_english_translations(REPO_ROOT)
            else:
                from .export import export_indonesian_translations
                export_indonesian_translations(REPO_ROOT, only_untranslated=only_untranslated)
                files = ["lang_multi_text.db", "lang_multi_text_1sthalf.db"]
                if (REPO_ROOT / "output_db" / "id" / "lang_multi_text_2ndhalf.db").is_file():
                    files.append("lang_multi_text_2ndhalf.db")
            return {"ok": True, "files": files}
    except Exception as e:
        raise HTTPException(500, f"Export failed: {e}")


@app.post("/api/editor/clear-translations")
def api_clear_translations(role: str = Depends(require_editor)):
    import shutil
    try:
        # 1. Clear machine translations JSON folders
        quests_id_dir = DATA_DIR / "quests_id"
        if quests_id_dir.is_dir():
            shutil.rmtree(quests_id_dir)
        quests_id_dir.mkdir(parents=True, exist_ok=True)
            
        categories_id_dir = DATA_DIR / "categories_id"
        if categories_id_dir.is_dir():
            shutil.rmtree(categories_id_dir)
        categories_id_dir.mkdir(parents=True, exist_ok=True)
            
        # 2. Clear translation memory cache
        tm_path = DATA_DIR / "_translation_memory.json"
        if tm_path.is_file():
            tm_path.unlink()
            
        # 3. Clear database edits & drafts
        con = db.connect()
        try:
            con.execute("UPDATE edits SET text_id = NULL, speaker_id = NULL")
            # Clean options_json in edits (remove text_id keys)
            for row in con.execute("SELECT qid, line_id, options_json FROM edits WHERE options_json IS NOT NULL").fetchall():
                try:
                    opts = json.loads(row["options_json"])
                    if isinstance(opts, list):
                        cleaned = []
                        for opt in opts:
                            if isinstance(opt, dict):
                                cleaned_opt = dict(opt)
                                cleaned_opt.pop("text_id", None)
                                cleaned.append(cleaned_opt)
                            else:
                                cleaned.append(opt)
                        con.execute(
                            "UPDATE edits SET options_json = ? WHERE qid = ? AND line_id = ?",
                            (json.dumps(cleaned), row["qid"], row["line_id"])
                        )
                except Exception:
                    pass
            
            # Clear category edits
            has_cat_edits = con.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='category_edits'").fetchone()
            if has_cat_edits:
                con.execute("DELETE FROM category_edits")
                
            # Clear drafts
            con.execute("DELETE FROM drafts WHERE status = 'applied'")
            has_cat_drafts = con.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='category_drafts'").fetchone()
            if has_cat_drafts:
                con.execute("DELETE FROM category_drafts")
                
            # Update quests translated count to 0
            con.execute("UPDATE quests SET translated_count = 0")
            con.commit()
        finally:
            con.close()
            
        # 4. Rebuild search indexes
        from scripts.build_index import build_fts, build_category_fts, collect_quests, resolve_source
        source = resolve_source(None)
        quests = collect_quests(source)
        quests.sort(key=lambda q: (q.get("side", 0), q.get("chapter_id", 0), q.get("order", 0), q.get("quest_id", 0)))
        
        build_fts(DATA_DIR / "index.db", quests)
        build_category_fts(DATA_DIR / "index.db", DATA_DIR)
        
        return {"ok": True}
    except Exception as e:
        raise HTTPException(500, f"Failed to clear translations: {e}")


@app.delete("/api/editor/quest/{qid}/translation")
def api_delete_quest_translation(qid: int, role: str = Depends(require_editor)):
    try:
        # 1. Delete MT file
        id_path = DATA_DIR / "quests_id" / f"{qid}.json"
        if id_path.is_file():
            id_path.unlink()
            
        # 2. Clear quest edits & drafts from DB
        db.clear_quest_translation_db(qid)
        
        # 3. Rebuild search indexes to reflect deletion
        from scripts.build_index import build_fts, collect_quests, resolve_source
        source = resolve_source(None)
        quests = collect_quests(source)
        quests.sort(key=lambda q: (q.get("side", 0), q.get("chapter_id", 0), q.get("order", 0), q.get("quest_id", 0)))
        build_fts(DATA_DIR / "index.db", quests)
        
        return {"ok": True}
    except Exception as e:
        raise HTTPException(500, f"Failed to delete quest translation: {e}")


@app.delete("/api/editor/category/{name}/translation")
def api_delete_category_translation(name: str, role: str = Depends(require_editor)):
    try:
        # 1. Delete MT file
        id_path = DATA_DIR / "categories_id" / f"{name}.json"
        if id_path.is_file():
            id_path.unlink()
            
        # 2. Clear category edits & drafts from DB
        db.clear_category_translation_db(name)
        
        # 3. Rebuild category search index to reflect deletion
        from scripts.build_index import build_category_fts
        build_category_fts(DATA_DIR / "index.db", DATA_DIR)
        
        return {"ok": True}
    except Exception as e:
        raise HTTPException(500, f"Failed to delete category translation: {e}")


@app.post("/api/editor/import")
def api_import_translations(payload: dict, role: str = Depends(get_role)):
    if role != "editor":
        raise HTTPException(403, "editor role required to import")
    db_path_str = payload.get("db_path")
    if not db_path_str:
        raise HTTPException(422, "db_path parameter is required")
        
    import glob
    db_paths_raw = [p.strip() for p in db_path_str.split(",") if p.strip()]
    resolved_paths = []
    
    for raw in db_paths_raw:
        if "*" in raw or "?" in raw:
            matches = glob.glob(raw)
            for m in matches:
                p = Path(m)
                if p.is_file() and p.suffix == ".db":
                    resolved_paths.append(p)
        else:
            p = Path(raw)
            if p.is_dir():
                resolved_paths.extend(sorted(p.glob("*.db")))
            else:
                resolved_paths.append(p)

    if not resolved_paths:
        raise HTTPException(404, f"No database files found matching: {db_path_str}")
        
    try:
        from .import_translations import build_import_context, import_translation_map, load_translations_from_db
        combined_stats = {
            "categories_updated": 0,
            "quests_updated": 0,
            "total_keys_imported": 0,
            "skipped_keys": 0,
            "files_imported": 0,
            "duplicate_keys_merged": 0,
            "message": ""
        }
        context = build_import_context(REPO_ROOT)
        
        imported_files = []
        merged_translations = {}
        duplicate_keys_merged = 0
        for path in resolved_paths:
            if not path.is_file():
                raise HTTPException(404, f"Database file not found: {path}")
            translations = load_translations_from_db(path)
            duplicate_keys_merged += sum(1 for key in translations if key in merged_translations)
            merged_translations.update(translations)
            combined_stats["files_imported"] += 1
            imported_files.append(path.name)

        stats = import_translation_map(REPO_ROOT, merged_translations, rebuild_index=True, context=context)
        combined_stats["categories_updated"] = stats.get("categories_updated", 0)
        combined_stats["quests_updated"] = stats.get("quests_updated", 0)
        combined_stats["total_keys_imported"] = stats.get("total_keys_imported", 0)
        combined_stats["skipped_keys"] = stats.get("skipped_keys", 0)
        combined_stats["duplicate_keys_merged"] = duplicate_keys_merged
            
        if len(imported_files) <= 10:
            combined_stats["message"] = f"Imported: {', '.join(imported_files)}"
        else:
            preview = ", ".join(imported_files[:10])
            remaining = len(imported_files) - 10
            combined_stats["message"] = f"Imported {len(imported_files)} files: {preview}, and {remaining} more."
        return {"ok": True, "stats": combined_stats}
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
