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

        # 2. Inserted lines (splice in by position_after; ties broken by approved_at, line_id)
        insertions = con.execute(
            "SELECT * FROM inserted_lines WHERE qid = ? "
            "ORDER BY position_after, approved_at, line_id",
            (qid,),
        ).fetchall()
        for ins in insertions:
            new_line = json.loads(ins["line_json"])
            anchor_id = ins["position_after"]
            if anchor_id is None:
                idx = len(quest["all_lines"])
            else:
                anchor = next(
                    (l for l in quest["all_lines"] if l.get("id") == anchor_id),
                    None,
                )
                idx = (quest["all_lines"].index(anchor) + 1) if anchor else len(quest["all_lines"])
            quest["all_lines"].insert(idx, new_line)

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
            following: dict[int, list[dict]] = {}
            overridden_ids: set[int] = set()
            for row in overrides:
                overridden_ids.add(row["line_id"])
                anchor = row["position_after"]
                if anchor is None:
                    continue
                follower = by_id.get(row["line_id"])
                if follower is None:
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

            for line in quest["all_lines"]:
                if line["id"] in overridden_ids:
                    continue
                _add(line)
            quest["all_lines"] = new_order

    finally:
        con.close()
    return quest
