#!/usr/bin/env python3
"""Rebuild the wuwaid-quests data layer from the exporter output.

Inputs (read-only):
  ../WuwaID/export_quest_ordered/
    Chapter_<N>_<name>/<idx>_<quest_name>/dialogue.json
    side_quests/<qid>_<quest_name>/dialogue.json

Outputs (written to ./data/, gitignored):
  data/chapters.json     chapter summaries
  data/speakers.json     aggregated speaker stats
  data/quests/<qid>.json one flat file per quest (dialogue.json verbatim)
  data/index.db          SQLite FTS5 index for full-text search

Path resolution order for the exporter root:
  1. --source CLI arg
  2. ../WuwaID/export_quest_ordered (sibling repo)
  3. ./WuwaID/export_quest_ordered
  4. ./export_quest_ordered
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

DEFAULT_CANDIDATES = [
    REPO_ROOT.parent / "WuwaID" / "export_quest_ordered",
    REPO_ROOT / "WuwaID" / "export_quest_ordered",
    REPO_ROOT / "export_quest_ordered",
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


def build_fts(db_path: Path, quests: list[dict]) -> int:
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
            tokenize = 'unicode61 remove_diacritics 2'
        )
    """)
    rows: list[tuple] = []
    for q in quests:
        for line in q.get("all_lines", []):
            text_en = line.get("text_en", "")
            text_zh = cjk_bigrams(line.get("text_zh-Hans", ""))
            text_ja = cjk_bigrams(line.get("text_ja", ""))
            rows.append((
                q["quest_id"],
                line.get("id", 0),
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
            ))
    cur.executemany(
        "INSERT INTO dialogue_idx VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", rows
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
    con.commit()
    con.close()
    return len(rows)


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
    p.add_argument("--source", help="Path to export_quest_ordered/")
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
