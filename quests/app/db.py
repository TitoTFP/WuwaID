"""SQLite FTS5 wrapper for quest search."""
from __future__ import annotations

import json
import re
import sqlite3
from pathlib import Path

DB_PATH: Path | None = None


def set_db_path(path: Path | None) -> None:
    global DB_PATH
    DB_PATH = path


def connect() -> sqlite3.Connection:
    if DB_PATH is None:
        raise RuntimeError("DB_PATH not set; call set_db_path() first")
    con = sqlite3.connect(str(DB_PATH))
    con.row_factory = sqlite3.Row
    return con


def ensure_editor_schema() -> None:
    """Create the editor_session table if it doesn't exist (idempotent)."""
    con = connect()
    try:
        con.execute(
            """
            CREATE TABLE IF NOT EXISTS editor_session (
                token TEXT PRIMARY KEY,
                created_at TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'editor'
            )
            """
        )
        cols = {r["name"] for r in con.execute("PRAGMA table_info(editor_session)").fetchall()}
        if "role" not in cols:
            con.execute("ALTER TABLE editor_session ADD COLUMN role TEXT NOT NULL DEFAULT 'editor'")
        con.commit()
    finally:
        con.close()


def _cjk_bigrams(s: str) -> str:
    """Mirror of build_index.cjk_bigrams. Each CJK char becomes its own token
    so single-char queries match. ASCII runs are passed through."""
    if not s:
        return ""
    out: list[str] = []
    buf: list[str] = []
    for ch in s:
        cp = ord(ch)
        is_cjk = (
            0x3040 <= cp <= 0x30FF
            or 0x3400 <= cp <= 0x4DBF
            or 0x4E00 <= cp <= 0x9FFF
            or 0xAC00 <= cp <= 0xD7AF
            or 0xF900 <= cp <= 0xFAFF
            or 0xFF66 <= cp <= 0xFF9D
        )
        if is_cjk:
            if buf:
                out.append(" ".join(buf))
                buf = []
            out.append(ch)
        else:
            buf.append(ch)
    if buf:
        out.append(" ".join(buf))
    return " ".join(out)


def _prepare_fts_query(q: str, lang: str) -> str:
    """Convert user query into an FTS5 MATCH expression.

    For CJK languages we bigram-ize the query so unicode61 tokenization
    matches the indexed text.

    For English we quote each token and append ``*`` so partial words match
    (e.g. ``"Towa"*`` matches ``Towards``). This is a strict superset of
    exact match. If the user supplies an explicit FTS5 expression
    (NEAR(...), AND, OR, NOT, *, column:term, "..."), we pass it through
    verbatim so power-users can write raw queries.
    """
    q = q.strip()
    if not q:
        return ""
    if lang in ("zh", "ja"):
        return _cjk_bigrams(q)
    # en: if it contains FTS5 operators, pass through
    if re.search(r"\b(NEAR|AND|OR|NOT)\b|[*:\(\)\"]", q):
        return q
    tokens = q.split()
    if not tokens:
        return ""
    out: list[str] = []
    for t in tokens:
        if t.endswith("*"):
            out.append(f'"{t}"')
        else:
            out.append(f'"{t}"*')
    return " ".join(out)


def search(
    q: str,
    lang: str = "en",
    limit: int = 50,
    side: int | None = None,
    quest_type: int | None = None,
) -> list[dict]:
    """Full-text search over dialogue lines.

    lang: 'en' (text_en), 'zh' (text_zh), 'ja' (text_ja)
    side: 0 = main story, 1 = side quest, None = both
    quest_type: filter by questdata.Type
    """
    fts_q = _prepare_fts_query(q, lang)
    if not fts_q:
        return []
    col = {"en": "text_en", "zh": "text_zh", "ja": "text_ja"}[lang]
    col_idx = {"en": 10, "zh": 11, "ja": 12}[lang]

    where = ["dialogue_idx MATCH ?"]
    params: list = [fts_q]
    if side is not None:
        where.append("side = ?")
        params.append(side)
    if quest_type is not None:
        where.append("qid IN (SELECT qid FROM quests WHERE quest_type = ?)")
        params.append(quest_type)

    where_sql = " AND ".join(where)
    sql = f"""
        SELECT qid, line_id, quest_name, chapter_name, side,
               speaker_en, {col} AS text, line_type, has_options,
               snippet(dialogue_idx, {col_idx}, '[', ']', '...', 12) AS snippet
        FROM dialogue_idx
        WHERE {where_sql}
        ORDER BY rank
        LIMIT ?
    """
    params.append(limit)
    con = connect()
    try:
        rows = con.execute(sql, params).fetchall()
    finally:
        con.close()
    return [dict(r) for r in rows]


def search_overlays(
    q: str,
    lang: str = "en",
    limit: int = 50,
    side: int | None = None,
    quest_type: int | None = None,
) -> list[dict]:
    """Simple substring search over approved overlays and inserted lines."""
    needle = q.strip().lower()
    if not needle:
        return []
    edit_col = {"en": "text_en", "zh": "text_zh_hans", "ja": "text_ja"}[lang]
    json_key = {"en": "text_en", "zh": "text_zh-Hans", "ja": "text_ja"}[lang]
    results: list[dict] = []
    con = connect()
    try:
        quest_where: list[str] = []
        params: list = []
        if side is not None:
            quest_where.append("side = ?")
            params.append(side)
        if quest_type is not None:
            quest_where.append("quest_type = ?")
            params.append(quest_type)
        quest_sql = ("WHERE " + " AND ".join(quest_where)) if quest_where else ""
        quests = {
            r["qid"]: dict(r)
            for r in con.execute(
                f"SELECT qid, quest_name, quest_type, side, chapter_name FROM quests {quest_sql}",
                params,
            ).fetchall()
        }
        if not quests:
            return []

        for row in con.execute(
            f"SELECT qid, line_id, {edit_col} AS text FROM edits WHERE {edit_col} IS NOT NULL"
        ).fetchall():
            if len(results) >= limit:
                break
            if row["qid"] not in quests or needle not in row["text"].lower():
                continue
            line = next((l for l in _load_quest_lines(con, row["qid"]) if l.get("id") == row["line_id"]), {})
            quest = quests[row["qid"]]
            results.append({
                "qid": row["qid"],
                "line_id": row["line_id"],
                "quest_name": quest["quest_name"],
                "chapter_name": quest["chapter_name"] or "",
                "side": quest["side"],
                "speaker_en": line.get("speaker_en", ""),
                "text": row["text"],
                "line_type": line.get("type", ""),
                "has_options": 1 if line.get("options") else 0,
                "snippet": row["text"],
            })

        for row in con.execute(
            "SELECT qid, line_id, line_json FROM inserted_lines ORDER BY approved_at, line_id"
        ).fetchall():
            if len(results) >= limit:
                break
            if row["qid"] not in quests:
                continue
            line = json.loads(row["line_json"])
            text = line.get(json_key, "")
            if needle not in text.lower():
                continue
            quest = quests[row["qid"]]
            results.append({
                "qid": row["qid"],
                "line_id": row["line_id"],
                "quest_name": quest["quest_name"],
                "chapter_name": quest["chapter_name"] or "",
                "side": quest["side"],
                "speaker_en": line.get("speaker_en", ""),
                "text": text,
                "line_type": line.get("type", ""),
                "has_options": 1 if line.get("options") else 0,
                "snippet": text,
            })
    finally:
        con.close()
    return results


def list_quests(
    side: int | None = None,
    quest_type: int | None = None,
    speaker: str | None = None,
    has_options: bool | None = None,
    q: str | None = None,
    sort: str = "id",
    page: int = 1,
    page_size: int = 50,
) -> dict:
    """List quests with filters + pagination."""
    where: list[str] = []
    params: list = []
    if side is not None:
        where.append("q.side = ?")
        params.append(side)
    if quest_type is not None:
        where.append("q.quest_type = ?")
        params.append(quest_type)
    if speaker:
        where.append(
            "q.qid IN (SELECT DISTINCT qid FROM dialogue_idx WHERE speaker_en = ?)"
        )
        params.append(speaker)
    if has_options is not None:
        where.append(
            "q.qid IN (SELECT qid FROM dialogue_idx WHERE has_options = ? GROUP BY qid)"
        )
        params.append(1 if has_options else 0)
    if q:
        fts_q = _prepare_fts_query(q, "en")
        if fts_q:
            where.append(
                "q.qid IN (SELECT DISTINCT qid FROM dialogue_idx WHERE dialogue_idx MATCH ?)"
            )
            params.append(fts_q)

    where_sql = ("WHERE " + " AND ".join(where)) if where else ""
    sort_sql = {
        "id": "q.chapter_id, q.ord, q.qid",
        "name": "q.quest_name",
        "lines": "q.total_lines DESC",
        "lines_asc": "q.total_lines",
    }.get(sort, "q.chapter_id, q.ord, q.qid")

    page = max(1, page)
    page_size = max(1, min(200, page_size))
    offset = (page - 1) * page_size

    con = connect()
    try:
        total = con.execute(
            f"SELECT COUNT(*) FROM quests q {where_sql}", params
        ).fetchone()[0]
        rows = con.execute(
            f"""
            SELECT q.qid, q.quest_name, q.quest_type, q.side,
                   q.chapter_id, q.chapter_name, q.ord, q.total_lines
            FROM quests q
            {where_sql}
            ORDER BY q.side, {sort_sql}
            LIMIT ? OFFSET ?
            """,
            params + [page_size, offset],
        ).fetchall()
    finally:
        con.close()
    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "items": [dict(r) for r in rows],
    }


def list_speakers() -> list[dict]:
    con = connect()
    try:
        rows = con.execute(
            """
            SELECT speaker_en AS name,
                   COUNT(*) AS line_count,
                   COUNT(DISTINCT qid) AS quest_count
            FROM dialogue_idx
            WHERE speaker_en != ''
            GROUP BY speaker_en
            ORDER BY line_count DESC
            """
        ).fetchall()
    finally:
        con.close()
    return [dict(r) for r in rows]


def get_quest(qid: int) -> dict | None:
    con = connect()
    try:
        row = con.execute(
            "SELECT * FROM quests WHERE qid = ?", (qid,)
        ).fetchone()
    finally:
        con.close()
    if row is None:
        return None
    return dict(row)


# ---------------------------------------------------------------------------
# Editor: overlay merge
# ---------------------------------------------------------------------------

# Field-name translation: storage column -> JSON key in the line dict.
# (zh-Hans uses a hyphen in JSON; we use zh_hans in the SQL column for SQL-safety.)
_EDIT_FIELD_MAP = {
    "type": "type",
    "state_key": "state_key",
    "speaker_en": "speaker_en",
    "speaker_zh_hans": "speaker_zh-Hans",
    "speaker_ja": "speaker_ja",
    "text_en": "text_en",
    "text_zh_hans": "text_zh-Hans",
    "text_ja": "text_ja",
}


def apply_edits(qid: int, quest: dict) -> dict:
    """Merge approved edits/inserts/reorders into a quest dict.

    Mutates and returns `quest`. Idempotent: re-running on a quest that
    already reflects all edits is a no-op.
    """
    con = connect()
    try:
        # 1. Field overlay
        for row in con.execute(
            "SELECT * FROM edits WHERE qid = ?", (qid,)
        ).fetchall():
            line = next(
                (l for l in quest["all_lines"] if l.get("id") == row["line_id"]),
                None,
            )
            if line is None:
                continue
            for col, json_key in _EDIT_FIELD_MAP.items():
                if row[col] is not None:
                    line[json_key] = row[col]
            if row["options_json"] is not None:
                line["options"] = json.loads(row["options_json"])

        # 2. Inserted lines (group by anchor so same-anchor approvals keep order).
        insertions = con.execute(
            "SELECT * FROM inserted_lines WHERE qid = ? "
            "ORDER BY position_after, approved_at, line_id",
            (qid,),
        ).fetchall()
        by_anchor: dict[int | None, list[sqlite3.Row]] = {}
        for ins in insertions:
            by_anchor.setdefault(ins["position_after"], []).append(ins)
        existing_ids = {l.get("id") for l in quest["all_lines"]}
        for anchor_id, group in by_anchor.items():
            if anchor_id is None:
                idx = len(quest["all_lines"])
            else:
                anchor = next(
                    (l for l in quest["all_lines"] if l.get("id") == anchor_id),
                    None,
                )
                idx = (quest["all_lines"].index(anchor) + 1) if anchor else len(quest["all_lines"])
            for ins in group:
                if ins["line_id"] in existing_ids:
                    continue
                new_line = json.loads(ins["line_json"])
                quest["all_lines"].insert(idx, new_line)
                existing_ids.add(ins["line_id"])
                idx += 1

        # 3. Reorder overrides: each row says "line_id should appear immediately
        #    after the line with id=position_after". Rebuild the sequence by
        #    walking original order and splicing followers in after their anchor.
        #    Lines with an override are skipped at their original spot and
        #    re-emitted right after their anchor.
        overrides = con.execute(
            "SELECT line_id, position_after FROM line_order WHERE qid = ?", (qid,)
        ).fetchall()
        if overrides:
            by_id = {l["id"]: l for l in quest["all_lines"]}
            start_followers: list[dict] = []
            following: dict[int, list[dict]] = {}
            overridden_ids: set[int] = set()
            for row in overrides:
                overridden_ids.add(row["line_id"])
                anchor = row["position_after"]
                follower = by_id.get(row["line_id"])
                if follower is None:
                    continue
                if anchor is None:
                    start_followers.append(follower)
                    continue
                following.setdefault(anchor, []).append(follower)

            new_order: list[dict] = []
            visited: set[int] = set()

            def _add(line: dict) -> None:
                if line["id"] in visited:
                    return
                visited.add(line["id"])
                new_order.append(line)
                for f in following.get(line["id"], []):
                    _add(f)

            for line in start_followers:
                _add(line)
            for line in quest["all_lines"]:
                if line["id"] in overridden_ids:
                    continue
                _add(line)
            quest["all_lines"] = new_order

    finally:
        con.close()
    return quest


# ---------------------------------------------------------------------------
# Editor: drafts
# ---------------------------------------------------------------------------


def _now() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


def create_draft(
    qid: int,
    line_id: int,
    patch: dict,
    *,
    author_label: str | None = None,
    note: str | None = None,
    position_after: int | None = None,
) -> int:
    con = connect()
    try:
        now = _now()
        cur = con.execute(
            """INSERT INTO drafts
               (qid, line_id, position_after, patch_json, status,
                created_at, updated_at, author_label, note)
               VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?)""",
            (qid, line_id, position_after, json.dumps(patch), now, now,
             author_label, note),
        )
        con.commit()
        return int(cur.lastrowid)
    finally:
        con.close()


def get_draft(draft_id: int) -> dict | None:
    con = connect()
    try:
        row = con.execute("SELECT * FROM drafts WHERE id = ?", (draft_id,)).fetchone()
    finally:
        con.close()
    return dict(row) if row else None


def get_draft_with_diff(draft_id: int) -> dict | None:
    d = get_draft(draft_id)
    if d is None:
        return None
    try:
        patch = json.loads(d["patch_json"])
    except json.JSONDecodeError:
        patch = {}
    con = connect()
    try:
        original = next(
            (l for l in _load_quest_lines(con, d["qid"]) if l.get("id") == d["line_id"]),
            None,
        )
    finally:
        con.close()
    return {**d, "patch": patch if isinstance(patch, dict) else {}, "original_json": original}


def update_draft(
    draft_id: int,
    *,
    author_label: str | None,
    patch: dict,
) -> None:
    con = connect()
    try:
        row = con.execute("SELECT * FROM drafts WHERE id = ?", (draft_id,)).fetchone()
        if row is None:
            raise ValueError("draft not found")
        if row["status"] != "pending":
            raise ValueError(f"draft already {row['status']}")
        is_editor = author_label is None
        if not is_editor and row["author_label"] != author_label:
            raise PermissionError("not your draft")
        con.execute(
            "UPDATE drafts SET patch_json = ?, updated_at = ? WHERE id = ?",
            (json.dumps(patch), _now(), draft_id),
        )
        con.commit()
    finally:
        con.close()


def delete_draft(draft_id: int, *, author_label: str | None) -> None:
    con = connect()
    try:
        row = con.execute("SELECT * FROM drafts WHERE id = ?", (draft_id,)).fetchone()
        if row is None:
            return
        is_editor = author_label is None
        if not is_editor and row["author_label"] != author_label:
            raise PermissionError("not your draft")
        if row["status"] != "pending":
            raise ValueError(f"draft already {row['status']}")
        con.execute("DELETE FROM drafts WHERE id = ?", (draft_id,))
        con.commit()
    finally:
        con.close()


def list_drafts(*, scope: str, author_label: str | None) -> list[dict]:
    """scope: 'mine' filters by author_label; 'all' returns everything pending."""
    con = connect()
    try:
        if scope == "mine":
            rows = con.execute(
                "SELECT * FROM drafts WHERE author_label = ? "
                "AND status = 'pending' ORDER BY created_at DESC",
                (author_label,),
            ).fetchall()
        else:
            rows = con.execute(
                "SELECT * FROM drafts WHERE status = 'pending' "
                "ORDER BY created_at DESC"
            ).fetchall()
    finally:
        con.close()
    return [dict(r) for r in rows]


# ---------------------------------------------------------------------------
# Editor: approve / reject
# ---------------------------------------------------------------------------


# Map a JSON-side patch key to its DB column.
# (zh-Hans uses a hyphen in JSON; we use zh_hans in the SQL column for SQL-safety.)
_PATCH_TO_COLUMN = {
    "type": "type",
    "state_key": "state_key",
    "speaker_en": "speaker_en",
    "speaker_zh_hans": "speaker_zh_hans",
    "speaker_ja": "speaker_ja",
    "text_en": "text_en",
    "text_zh_hans": "text_zh_hans",
    "text_ja": "text_ja",
}

_PATCH_NORMALIZE_MAP = {
    "speaker_zh-Hans": "speaker_zh_hans",
    "text_zh-Hans": "text_zh_hans",
}


def _normalize_patch(patch: dict) -> dict:
    """Translate only known zh-Hans JSON patch keys to SQL-safe names."""
    return {_PATCH_NORMALIZE_MAP.get(k, k): v for k, v in patch.items()}


def approve_draft(draft_id: int, *, approver: str) -> None:
    con = connect()
    try:
        row = con.execute("SELECT * FROM drafts WHERE id = ?", (draft_id,)).fetchone()
        if row is None:
            raise ValueError("draft not found")
        if row["status"] != "pending":
            raise ValueError(f"draft already processed ({row['status']})")

        patch = _normalize_patch(json.loads(row["patch_json"]))
        qid = row["qid"]
        line_id = row["line_id"]

        if line_id == 0:
            _materialize_insert(con, qid, row["position_after"], patch, approver)
        elif patch.get("_op") == "reorder":
            _materialize_reorder(con, qid, line_id, row["position_after"], approver)
        else:
            _materialize_field_edit(con, qid, line_id, patch, approver)

        con.execute(
            "UPDATE drafts SET status = 'applied', updated_at = ? WHERE id = ?",
            (_now(), draft_id),
        )
        con.commit()
    finally:
        con.close()


def reject_draft(draft_id: int, *, approver: str) -> None:
    con = connect()
    try:
        row = con.execute("SELECT * FROM drafts WHERE id = ?", (draft_id,)).fetchone()
        if row is None:
            raise ValueError("draft not found")
        if row["status"] != "pending":
            raise ValueError(f"draft already processed ({row['status']})")
        con.execute(
            "UPDATE drafts SET status = 'rejected', updated_at = ? WHERE id = ?",
            (_now(), draft_id),
        )
        con.commit()
    finally:
        con.close()


def _load_quest_lines(con, qid: int) -> list[dict]:
    """Read the quest's all_lines[] for validation. Returns [] if no quest file."""
    if DB_PATH is None:
        return []
    p = Path(DB_PATH).parent / "quests" / f"{qid}.json"
    if not p.is_file():
        return []
    return json.loads(p.read_text(encoding="utf-8")).get("all_lines", [])


def _materialize_field_edit(con, qid: int, line_id: int, patch: dict, approver: str) -> None:
    lines = _load_quest_lines(con, qid)
    if lines and not any(l.get("id") == line_id for l in lines):
        raise ValueError(f"target line {line_id} gone")
    # Validate branch targets inside options, if present
    if lines and "options" in patch and patch["options"] is not None:
        for opt in patch["options"]:
            pk = opt.get("plot_line_key")
            if pk:
                if not any(l.get("plot_line_key") == pk or l.get("text_key") == pk for l in lines):
                    raise ValueError(f"branch target {pk!r} not in this quest")
    # Validate state_key change, if present
    if lines and patch.get("state_key") is not None:
        if not any(l.get("state_key") == patch["state_key"] for l in lines):
            raise ValueError(f"state_key {patch['state_key']!r} not in this quest")
    # Build (column, value) pairs
    cols: dict[str, object] = {}
    for k, v in patch.items():
        if k == "options":
            cols["options_json"] = json.dumps(v)
        elif k in _PATCH_TO_COLUMN:
            cols[_PATCH_TO_COLUMN[k]] = v
    if not cols:
        return
    cols["approved_by"] = approver
    cols["approved_at"] = _now()
    placeholders = ", ".join("?" for _ in cols)
    col_names = ", ".join(cols.keys())
    update_set = ", ".join(f"{c} = ?" for c in cols if c not in ("qid", "line_id"))
    values = list(cols.values())
    con.execute(
        f"INSERT INTO edits (qid, line_id, {col_names}) VALUES (?, ?, {placeholders}) "
        f"ON CONFLICT(qid, line_id) DO UPDATE SET {update_set}",
        [qid, line_id] + values + values,
    )


def _materialize_insert(con, qid: int, position_after: int | None, patch: dict, approver: str) -> None:
    lines = _load_quest_lines(con, qid)
    inserted = con.execute(
        "SELECT line_id FROM inserted_lines WHERE qid = ?",
        (qid,),
    ).fetchall()
    new_id = max(
        [l.get("id", 0) for l in lines] + [r["line_id"] for r in inserted],
        default=0,
    ) + 1
    if "id" not in patch:
        patch = {**patch, "id": new_id}
    else:
        new_id = int(patch["id"])
    if "options" not in patch:
        patch["options"] = []
    con.execute(
        "INSERT INTO inserted_lines VALUES (?,?,?,?,?,?)",
        (qid, new_id, position_after, json.dumps(patch), approver, _now()),
    )


def _materialize_reorder(con, qid: int, line_id: int, position_after: int | None, approver: str) -> None:
    lines = _load_quest_lines(con, qid)
    if lines and not any(l.get("id") == line_id for l in lines):
        raise ValueError(f"target line {line_id} gone")
    con.execute(
        "INSERT INTO line_order VALUES (?,?,?,?,?) "
        "ON CONFLICT(qid, line_id) DO UPDATE SET position_after = ?, "
        "approved_by = ?, approved_at = ?",
        (qid, line_id, position_after, approver, _now(),
         position_after, approver, _now()),
    )
