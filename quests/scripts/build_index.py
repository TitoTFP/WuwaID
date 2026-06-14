#!/usr/bin/env python3
"""Rebuild the wuwaid-quests data layer from the exporter output.

Inputs (read-only):
  ../WuwaID/export_text_grouped/export_quest_ordered/
    Chapter_<N>_<name>/<idx>_<quest_name>/dialogue.json
    side_quests/<qid>_<quest_name>/dialogue.json

Outputs (written to ./data/, gitignored):
  data/chapters.json     chapter summaries
  data/speakers.json     aggregated speaker stats
  data/quests/<qid>.json one flat file per quest (dialogue.json verbatim)
  data/index.db          SQLite FTS5 index for full-text search

Path resolution order for the exporter root:
  1. --source CLI arg
  2. ../WuwaID/export_text_grouped/export_quest_ordered (sibling repo)
  3. ./WuwaID/export_text_grouped/export_quest_ordered
  4. ./export_text_grouped/export_quest_ordered
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import sqlite3
import sys
from collections import Counter, defaultdict
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent
DATA_DIR = REPO_ROOT / "data"
QUESTS_DIR = DATA_DIR / "quests"
DB_PATH = DATA_DIR / "index.db"
EDITOR_TABLES = ("edits", "inserted_lines", "line_order", "drafts", "editor_session")

DEFAULT_CANDIDATES = [
    REPO_ROOT.parent / "WuwaID" / "export_text_grouped" / "export_quest_ordered",
    REPO_ROOT / "WuwaID" / "export_text_grouped" / "export_quest_ordered",
    REPO_ROOT / "export_text_grouped" / "export_quest_ordered",
]


def resolve_source(arg: str | None) -> Path:
    if arg:
        p = Path(arg).resolve()
    else:
        for cand in DEFAULT_CANDIDATES:
            p = cand.resolve()
            if p.is_dir():
                break
        else:
            p = DEFAULT_CANDIDATES[0]
    if not p.is_dir():
        raise FileNotFoundError(f"Source directory not found: {p}")
    return p


def load_quest(path: Path) -> dict | None:
    try:
        with path.open(encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        print(f"  WARN: failed to load {path}: {e}", file=sys.stderr)
        return None


def _parse_order(folder_name: str) -> int:
    """Extract leading integer prefix from a chapter folder (e.g. '001_xxx' -> 1).

    Returns a large sentinel if no numeric prefix, so unprefixed entries sink
    to the end of the chapter instead of scrambling to the front.
    """
    head = folder_name.split("_", 1)[0]
    if head.isdigit():
        return int(head)
    return 10**9


def collect_quests(source: Path) -> list[dict]:
    """Return list of quest dicts with injected side/chapter_id/chapter_name/order."""
    quests: list[dict] = []
    for dirpath, _dirs, files in os.walk(source):
        if "dialogue.json" not in files:
            continue
        d = load_quest(Path(dirpath) / "dialogue.json")
        if d is None:
            continue
        rel = Path(dirpath).relative_to(source)
        parts = rel.parts
        if parts and parts[0].startswith("Chapter_"):
            d["side"] = 0
            d.setdefault("chapter_id", 0)
            d.setdefault("chapter_name", parts[0])
            d["order"] = _parse_order(parts[1]) if len(parts) > 1 else 10**9
        elif parts and parts[0] == "side_quests":
            d["side"] = 1
            d["chapter_id"] = 0
            d["chapter_name"] = "Side Quests"
            d["order"] = 0
        else:
            print(f"  WARN: unknown layout {rel}", file=sys.stderr)
            continue
        quests.append(d)
    return quests


def aggregate(quests: list[dict]) -> tuple[list[dict], list[dict]]:
    """Build chapter + speaker summaries."""
    chapters: dict[tuple[int, str], dict] = {}
    speakers: Counter[str] = Counter()
    speaker_quests: dict[str, set[int]] = defaultdict(set)

    for q in quests:
        key = (q.get("chapter_id", 0), q.get("chapter_name", ""))
        ch = chapters.setdefault(
            key, {"id": key[0], "name": key[1], "quest_count": 0, "line_count": 0}
        )
        ch["quest_count"] += 1
        ch["line_count"] += q.get("total_lines", 0)

        for line in q.get("all_lines", []):
            for lang in ("en", "zh-Hans", "ja"):
                name = line.get(f"speaker_{lang}", "")
                if name:
                    speakers[name] += 1
                    speaker_quests[name].add(q["quest_id"])
                    break  # count once per line

    chapter_list = sorted(
        chapters.values(),
        key=lambda c: (c["id"] == 0, c["id"], c["name"]),
    )
    speaker_list = [
        {"name": n, "line_count": c, "quest_count": len(speaker_quests[n])}
        for n, c in speakers.most_common()
    ]
    return chapter_list, speaker_list


def cjk_bigrams(s: str) -> str:
    """Tokenize CJK strings as bigrams (2-char windows) for FTS5 search.

    SQLite's built-in unicode61 tokenizer skips CJK characters entirely, so
    we pre-segment them. ASCII runs are passed through unchanged (joined by
    spaces so the unicode61 tokenizer splits them on the space).
    """
    if not s:
        return ""
    out: list[str] = []
    buf: list[str] = []
    for ch in s:
        cp = ord(ch)
        # CJK ranges (Han, Hiragana, Katakana, Hangul)
        is_cjk = (
            0x3040 <= cp <= 0x30FF   # Hiragana + Katakana
            or 0x3400 <= cp <= 0x4DBF  # CJK Extension A
            or 0x4E00 <= cp <= 0x9FFF  # CJK Unified Ideographs
            or 0xAC00 <= cp <= 0xD7AF  # Hangul Syllables
            or 0xF900 <= cp <= 0xFAFF  # CJK Compatibility Ideographs
            or 0xFF66 <= cp <= 0xFF9D  # Half-width Katakana
        )
        if is_cjk:
            if buf:
                out.append(" ".join(buf))
                buf = []
            out.append(ch)  # single-char token (matches individual char searches)
        else:
            buf.append(ch)
    if buf:
        out.append(" ".join(buf))
    return " ".join(out)


def _table_exists(con: sqlite3.Connection, table: str) -> bool:
    return con.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
        (table,),
    ).fetchone() is not None


def snapshot_editor_tables(db_path: Path) -> dict[str, list[dict]]:
    """Read editor-owned rows before rebuilding generated index tables."""
    if not db_path.exists():
        return {table: [] for table in EDITOR_TABLES}
    con = sqlite3.connect(db_path)
    con.row_factory = sqlite3.Row
    try:
        snapshot: dict[str, list[dict]] = {}
        for table in EDITOR_TABLES:
            if not _table_exists(con, table):
                snapshot[table] = []
                continue
            snapshot[table] = [dict(row) for row in con.execute(f"SELECT * FROM {table}").fetchall()]
        return snapshot
    finally:
        con.close()


def _quest_line_ids(quests: list[dict]) -> dict[int, set[int]]:
    return {
        int(q["quest_id"]): {int(line.get("id", 0)) for line in q.get("all_lines", [])}
        for q in quests
    }


def _anchor_valid(anchor: int | None, line_ids: set[int]) -> bool:
    return anchor is None or int(anchor) in line_ids


def _valid_editor_row(table: str, row: dict, line_ids_by_qid: dict[int, set[int]]) -> bool:
    if table == "editor_session":
        return True
    qid = int(row.get("qid", -1))
    line_ids = line_ids_by_qid.get(qid)
    if line_ids is None:
        return False
    if table in ("edits", "line_order"):
        line_id = int(row.get("line_id", -1))
        if line_id not in line_ids:
            return False
        if table == "line_order" and not _anchor_valid(row.get("position_after"), line_ids):
            return False
        return True
    if table == "inserted_lines":
        return _anchor_valid(row.get("position_after"), line_ids)
    if table == "drafts":
        line_id = int(row.get("line_id", -1))
        if line_id == 0:
            return _anchor_valid(row.get("position_after"), line_ids)
        return line_id in line_ids and _anchor_valid(row.get("position_after"), line_ids)
    return False


def restore_editor_tables(
    con: sqlite3.Connection,
    snapshot: dict[str, list[dict]],
    quests: list[dict],
) -> dict[str, dict[str, int]]:
    """Restore editor rows that still target quests/lines present after rebuild."""
    line_ids_by_qid = _quest_line_ids(quests)
    stats: dict[str, dict[str, int]] = {}
    for table, rows in snapshot.items():
        stats[table] = {"restored": 0, "skipped": 0}
        if not rows or not _table_exists(con, table):
            stats[table]["skipped"] = len(rows)
            continue
        cols = [r[1] for r in con.execute(f"PRAGMA table_info({table})").fetchall()]
        for row in rows:
            if not _valid_editor_row(table, row, line_ids_by_qid):
                stats[table]["skipped"] += 1
                continue
            insert_cols = [col for col in cols if col in row]
            placeholders = ",".join("?" for _ in insert_cols)
            col_sql = ",".join(insert_cols)
            con.execute(
                f"INSERT OR REPLACE INTO {table} ({col_sql}) VALUES ({placeholders})",
                [row[col] for col in insert_cols],
            )
            stats[table]["restored"] += 1
    return stats


def build_fts(db_path: Path, quests: list[dict]) -> int:
    editor_snapshot = snapshot_editor_tables(db_path)
    if db_path.exists():
        db_path.unlink()
    con = sqlite3.connect(db_path)
    cur = con.cursor()
    cur.execute("PRAGMA journal_mode = WAL")
    cur.execute("""
        CREATE VIRTUAL TABLE dialogue_idx USING fts5(
            qid UNINDEXED,
            line_id UNINDEXED,
            side UNINDEXED,
            chapter_id UNINDEXED,
            chapter_name,
            quest_name,
            quest_type UNINDEXED,
            line_type UNINDEXED,
            has_options UNINDEXED,
            speaker_en,
            text_en,
            text_zh,
            text_ja,
            text_id,
            tokenize = 'unicode61 remove_diacritics 2'
        )
    """)
    rows: list[tuple] = []
    for q in quests:
        id_lookup: dict[int, str] = {}
        id_path = db_path.parent / "quests_id" / f"{q['quest_id']}.json"
        if id_path.is_file():
            try:
                id_data = json.loads(id_path.read_text(encoding="utf-8"))
                for state in (id_data.get("states") or {}).values():
                    if not isinstance(state, dict) or "error" in state:
                        continue
                    for entry in (state.get("lines") or []):
                        if not isinstance(entry, dict):
                            continue
                        lid = entry.get("line_id") or entry.get("id")
                        tid = entry.get("text_id")
                        if lid is not None and tid is not None:
                            id_lookup[int(lid)] = tid
            except (json.JSONDecodeError, OSError):
                pass

        for line in q.get("all_lines", []):
            lid = int(line.get("id", 0))
            text_en = line.get("text_en", "")
            text_zh = cjk_bigrams(line.get("text_zh-Hans", ""))
            text_ja = cjk_bigrams(line.get("text_ja", ""))
            text_id = id_lookup.get(lid, "")
            rows.append((
                q["quest_id"],
                lid,
                q.get("side", 0),
                q.get("chapter_id", 0),
                q.get("chapter_name", ""),
                q.get("quest_name", ""),
                q.get("quest_type", 0),
                line.get("type", ""),
                1 if line.get("options") else 0,
                line.get("speaker_en", ""),
                text_en,
                text_zh,
                text_ja,
                text_id,
            ))
    cur.executemany(
        "INSERT INTO dialogue_idx VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)", rows
    )
    # also build a small meta table for quest-level filters
    cur.execute("""
        CREATE TABLE quests (
            qid INTEGER PRIMARY KEY,
            quest_name TEXT,
            quest_type INTEGER,
            side INTEGER,
            chapter_id INTEGER,
            chapter_name TEXT,
            ord INTEGER,
            total_lines INTEGER
        )
    """)
    cur.executemany(
        "INSERT INTO quests VALUES (?,?,?,?,?,?,?,?)",
        [
            (
                q["quest_id"],
                q.get("quest_name", ""),
                q.get("quest_type", 0),
                q.get("side", 0),
                q.get("chapter_id", 0),
                q.get("chapter_name", ""),
                q.get("order", 0),
                q.get("total_lines", 0),
            )
            for q in quests
        ],
    )
    cur.execute("CREATE INDEX idx_quests_type ON quests(quest_type)")
    cur.execute("CREATE INDEX idx_quests_side ON quests(side)")
    cur.execute("CREATE INDEX idx_quests_chapter_order ON quests(side, chapter_id, ord)")
    cur.execute("""
        CREATE TABLE edits (
            qid INTEGER NOT NULL,
            line_id INTEGER NOT NULL,
            type TEXT,
            state_key TEXT,
            speaker_en TEXT,
            speaker_zh_hans TEXT,
            speaker_ja TEXT,
            text_en TEXT,
            text_zh_hans TEXT,
            text_ja TEXT,
            options_json TEXT,
            text_id TEXT,
            speaker_id TEXT,
            approved_by TEXT NOT NULL,
            approved_at TEXT NOT NULL,
            PRIMARY KEY (qid, line_id)
        )
    """)
    cur.execute("""
        CREATE TABLE inserted_lines (
            qid INTEGER NOT NULL,
            line_id INTEGER NOT NULL,
            position_after INTEGER,
            line_json TEXT NOT NULL,
            approved_by TEXT NOT NULL,
            approved_at TEXT NOT NULL,
            PRIMARY KEY (qid, line_id)
        )
    """)
    cur.execute("""
        CREATE TABLE line_order (
            qid INTEGER NOT NULL,
            line_id INTEGER NOT NULL,
            position_after INTEGER,
            approved_by TEXT NOT NULL,
            approved_at TEXT NOT NULL,
            PRIMARY KEY (qid, line_id)
        )
    """)
    cur.execute("""
        CREATE TABLE drafts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            qid INTEGER NOT NULL,
            line_id INTEGER NOT NULL,
            position_after INTEGER,
            patch_json TEXT NOT NULL,
            status TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            author_label TEXT,
            note TEXT
        )
    """)
    cur.execute("CREATE INDEX idx_drafts_status ON drafts(status)")
    cur.execute("CREATE INDEX idx_drafts_qid ON drafts(qid)")
    cur.execute("CREATE INDEX idx_drafts_author ON drafts(author_label)")
    cur.execute("""
        CREATE TABLE editor_session (
            token TEXT PRIMARY KEY,
            created_at TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'editor'
        )
    """)
    restore_stats = restore_editor_tables(con, editor_snapshot, quests)
    con.commit()
    con.close()
    restored = sum(s["restored"] for s in restore_stats.values())
    skipped = sum(s["skipped"] for s in restore_stats.values())
    if restored or skipped:
        print(f"  preserved editor rows: {restored} restored, {skipped} skipped stale")
    return len(rows)


def build_category_fts(db_path: Path, data_dir: Path) -> int:
    """Build the `category_text_idx` FTS5 table and `categories` metadata table.

    Reads:
      data_dir/categories/<Cat>.json       (input: {key: {zh, en, ja}})
      data_dir/categories_id/<Cat>.json    (optional translations: adds `id`)

    Writes:
      db_path (SQLite) with:
        - category_text_idx (FTS5)
        - categories (metadata)
    """
    categories_dir = data_dir / "categories"
    translations_dir = data_dir / "categories_id"
    if not categories_dir.is_dir():
        return 0

    con = sqlite3.connect(db_path)
    cur = con.cursor()
    cur.execute("DROP TABLE IF EXISTS category_text_idx")
    cur.execute("DROP TABLE IF EXISTS categories")
    cur.execute("""
        CREATE VIRTUAL TABLE category_text_idx USING fts5(
            category UNINDEXED,
            key UNINDEXED,
            prefix UNINDEXED,
            text_zh,
            text_en,
            text_ja,
            text_id,
            tokenize = 'unicode61 remove_diacritics 2'
        )
    """)
    cur.execute("""
        CREATE TABLE categories (
            name TEXT PRIMARY KEY,
            file TEXT NOT NULL,
            key_count INTEGER NOT NULL,
            translated_count INTEGER NOT NULL
        )
    """)

    rows = []
    metadata = []
    for cat_path in sorted(categories_dir.glob("*.json")):
        if cat_path.name.startswith("_"):
            continue
        cat_name = cat_path.stem
        try:
            with cat_path.open(encoding="utf-8") as f:
                cat_data = json.load(f)
        except (json.JSONDecodeError, OSError) as e:
            print(f"  WARN: failed to load {cat_path}: {e}", file=sys.stderr)
            continue

        # Load translations (if any)
        id_map: dict[str, str] = {}
        id_path = translations_dir / f"{cat_name}.json"
        if id_path.is_file():
            try:
                id_data = json.loads(id_path.read_text(encoding="utf-8"))
                for k, v in id_data.items():
                    if isinstance(v, dict) and v.get("id"):
                        id_map[k] = v["id"]
            except (json.JSONDecodeError, OSError):
                pass

        translated_count = 0
        for key, value in cat_data.items():
            if not isinstance(value, dict):
                continue
            prefix = key.split("_", 1)[0] if "_" in key else "NoPrefix"
            text_en = value.get("en", "")
            text_zh = value.get("zh-Hans", "")
            text_ja = value.get("ja", "")
            text_id = id_map.get(key, "")
            if text_id:
                translated_count += 1
            rows.append((
                cat_name, key, prefix,
                cjk_bigrams(text_zh),
                text_en,
                cjk_bigrams(text_ja),
                text_id,
            ))

        metadata.append((cat_name, cat_path.name, len(cat_data), translated_count))

    rows.sort(key=lambda r: r[1])
    cur.executemany(
        "INSERT INTO category_text_idx VALUES (?,?,?,?,?,?,?)", rows
    )
    cur.executemany(
        "INSERT INTO categories VALUES (?,?,?,?)", metadata
    )
    con.commit()
    con.close()
    return len(rows)


def copy_categories(source_parent: Path, data_dir: Path) -> int:
    cat_src = source_parent / "categories"
    cat_dst = data_dir / "categories"
    if not cat_src.is_dir():
        print(f"  WARN: categories source directory not found: {cat_src}")
        return 0
    if cat_dst.exists():
        shutil.rmtree(cat_dst)
    shutil.copytree(cat_src, cat_dst)
    return len(list(cat_dst.glob("*.json")))


def write_quests(quests: list[dict]) -> int:
    if QUESTS_DIR.exists():
        shutil.rmtree(QUESTS_DIR)
    QUESTS_DIR.mkdir(parents=True, exist_ok=True)
    n = 0
    for q in quests:
        out = QUESTS_DIR / f"{q['quest_id']}.json"
        with out.open("w", encoding="utf-8") as f:
            json.dump(q, f, ensure_ascii=False)
        n += 1
    return n


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--source", help="Path to export_text_grouped/export_quest_ordered/")
    p.add_argument("--data-dir", default=str(DATA_DIR))
    p.add_argument(
        "--with-edits",
        action="store_true",
        help="Re-apply approved edits to per-quest JSONs (deferred; see spec §9)",
    )
    args = p.parse_args()

    data_dir = Path(args.data_dir).resolve()
    quests_dir = data_dir / "quests"
    db_path = data_dir / "index.db"

    if args.with_edits:
        print("--with-edits is not yet implemented (see spec §9).")
        print("Exiting without changes.")
        return 0

    source = resolve_source(args.source)
    print(f"Source : {source}")
    print(f"Data   : {data_dir}")

    print("Scanning quests...")
    quests = collect_quests(source)
    quests.sort(key=lambda q: (q.get("side", 0), q.get("chapter_id", 0), q.get("order", 0), q.get("quest_id", 0)))
    print(f"  found {len(quests)} quests")

    print("Copying categories...")
    n_categories = copy_categories(source.parent, data_dir)
    print(f"  copied {n_categories} category files")

    print("Aggregating chapters + speakers...")
    chapters, speakers = aggregate(quests)
    print(f"  {len(chapters)} chapters, {len(speakers)} unique speakers")

    print(f"Writing per-quest JSON to {quests_dir}...")
    if quests_dir.exists():
        shutil.rmtree(quests_dir)
    quests_dir.mkdir(parents=True, exist_ok=True)
    n = 0
    for q in quests:
        with (quests_dir / f"{q['quest_id']}.json").open("w", encoding="utf-8") as f:
            json.dump(q, f, ensure_ascii=False)
        n += 1
    print(f"  wrote {n} files")

    print("Building FTS5 index...")
    rows = build_fts(db_path, quests)
    print(f"  indexed {rows} lines")

    print("Building category FTS5 index...")
    cat_rows = build_category_fts(db_path, data_dir)
    print(f"  indexed {cat_rows} category lines")

    (data_dir / "chapters.json").write_text(
        json.dumps(chapters, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (data_dir / "speakers.json").write_text(
        json.dumps(speakers, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"  wrote chapters.json + speakers.json")
    print("Done.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
