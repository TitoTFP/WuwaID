"""Immutable, content-addressed snapshots of official localization text."""
from __future__ import annotations

import csv
import hashlib
import json
import sqlite3
import tempfile
import zipfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Iterable, Literal

Language = Literal["en", "zh-Hans", "ja"]
LANGUAGES: tuple[Language, ...] = ("en", "zh-Hans", "ja")
WORKING = "working"


@dataclass(frozen=True)
class TextRow:
    text_id: str
    en: str
    zh_hans: str
    ja: str
    source_kind: str
    source_ref: str
    source_path: str
    source_name: str

    def content(self, language: Language) -> str:
        return {"en": self.en, "zh-Hans": self.zh_hans, "ja": self.ja}[language]


def _text_hash(content: str) -> bytes:
    return hashlib.sha256(content.encode("utf-8")).digest()


def _normalise(value: object) -> str:
    return value if isinstance(value, str) else ""


def _add_row(rows: dict[str, TextRow], row: TextRow) -> None:
    if not row.text_id:
        return
    previous = rows.get(row.text_id)
    if previous is None:
        rows[row.text_id] = row
        return
    if (previous.en, previous.zh_hans, previous.ja) != (row.en, row.zh_hans, row.ja):
        raise ValueError(
            f"Conflicting Content for Id {row.text_id!r}: "
            f"{previous.source_kind}:{previous.source_ref} vs "
            f"{row.source_kind}:{row.source_ref}"
        )


def _row_from_value(text_id: object, value: object, kind: str, ref: str, source_path: str) -> TextRow | None:
    if not isinstance(text_id, str) or not text_id or not isinstance(value, dict):
        return None
    return TextRow(
        text_id=text_id,
        en=_normalise(value.get("en") if kind == "category" else value.get("text_en")),
        zh_hans=_normalise(value.get("zh-Hans") if kind == "category" else value.get("text_zh-Hans")),
        ja=_normalise(value.get("ja") if kind == "category" else value.get("text_ja")),
        source_kind=kind,
        source_ref=ref,
        source_path=source_path,
        source_name=_normalise(value.get("speaker_en")) if kind == "quest" else "",
    )


def _sanitize_filename(name: object, max_len: int = 80) -> str:
    value = str(name or "")
    for character in r'\/:*?"<>|':
        value = value.replace(character, "_")
    value = value.strip(". ")
    return (value[:max_len] if value else "unnamed")


def _quest_source_path(source: Path, path: Path, quest: dict) -> str:
    exported = source / "export_quest_ordered"
    if exported.is_dir() and path.is_relative_to(exported):
        return path.relative_to(source).as_posix()
    qid = str(quest.get("quest_id") or path.stem)
    quest_name = _sanitize_filename(quest.get("quest_name") or f"Quest_{qid}")
    if int(quest.get("side") or 0) == 1:
        folder = f"{qid}_{quest_name}"
        return f"export_quest_ordered/side_quests/{folder}/dialogue.json"
    chapter_id = int(quest.get("chapter_id") or 0)
    chapter_name = _sanitize_filename(quest.get("chapter_name") or f"Chapter {chapter_id}")
    order = int(quest.get("order") or 0)
    return f"export_quest_ordered/Chapter_{chapter_id}_{chapter_name}/{order:03d}_{quest_name}/dialogue.json"


def resolve_dataset_dirs(source: Path) -> tuple[Path, list[Path]]:
    source = source.resolve()
    categories = source / "categories"
    if not categories.is_dir():
        raise FileNotFoundError(f"categories directory not found under {source}")
    quests = source / "quests"
    if quests.is_dir():
        quest_files = sorted(quests.glob("*.json"))
    else:
        exported = source / "export_quest_ordered"
        if not exported.is_dir():
            raise FileNotFoundError(f"quests or export_quest_ordered directory not found under {source}")
        quest_files = sorted(exported.rglob("dialogue.json"))
    if not quest_files:
        raise FileNotFoundError(f"no quest JSON files found under {source}")
    return categories, quest_files


def load_dataset(source: Path) -> tuple[dict[str, TextRow], dict[str, int]]:
    """Load official EN/ZH-Hans/JA MultiText rows from a WebUI/export root."""
    categories_dir, quest_files = resolve_dataset_dirs(source)
    rows: dict[str, TextRow] = {}
    category_ids: set[str] = set()
    quest_ids: set[str] = set()

    category_files = sorted(p for p in categories_dir.glob("*.json") if not p.name.startswith("_"))
    for path in category_files:
        data = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            raise ValueError(f"Category file must contain an object: {path}")
        for text_id, value in data.items():
            row = _row_from_value(text_id, value, "category", path.stem, f"categories/{path.name}")
            if row:
                _add_row(rows, row)
                category_ids.add(row.text_id)

    for path in quest_files:
        quest = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(quest, dict):
            raise ValueError(f"Quest file must contain an object: {path}")
        ref = str(quest.get("quest_id") or path.parent.name or path.stem)
        source_path = _quest_source_path(source.resolve(), path.resolve(), quest)
        for line in quest.get("all_lines") or []:
            if not isinstance(line, dict):
                continue
            row = _row_from_value(line.get("text_key"), line, "quest", ref, source_path)
            if row:
                _add_row(rows, row)
                quest_ids.add(row.text_id)
            for option in line.get("options") or []:
                if not isinstance(option, dict):
                    continue
                opt_row = _row_from_value(option.get("text_key"), option, "quest", ref, source_path)
                if opt_row:
                    _add_row(rows, opt_row)
                    quest_ids.add(opt_row.text_id)

    overlap = category_ids & quest_ids
    if overlap:
        sample = ", ".join(sorted(overlap)[:5])
        raise ValueError(f"Category and quest Id sets overlap ({len(overlap)} rows): {sample}")
    stats = {
        "rows": len(rows),
        "category_rows": len(category_ids),
        "quest_rows": len(quest_ids),
        "category_files": len(category_files),
        "quest_files": len(quest_files),
    }
    return rows, stats


def dataset_hash(rows: dict[str, TextRow]) -> str:
    digest = hashlib.sha256()
    for text_id in sorted(rows):
        row = rows[text_id]
        payload = json.dumps(
            [text_id, row.en, row.zh_hans, row.ja],
            ensure_ascii=False,
            separators=(",", ":"),
        ).encode("utf-8")
        digest.update(len(payload).to_bytes(8, "big"))
        digest.update(payload)
    return digest.hexdigest()


def connect_history(path: Path) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(path)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    con.execute("PRAGMA journal_mode = WAL")
    con.executescript("""
        CREATE TABLE IF NOT EXISTS versions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tag TEXT NOT NULL UNIQUE,
            note TEXT,
            created_at TEXT NOT NULL,
            dataset_hash TEXT NOT NULL,
            row_count INTEGER NOT NULL,
            category_row_count INTEGER NOT NULL,
            quest_row_count INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS content_blobs (
            hash BLOB PRIMARY KEY,
            content TEXT NOT NULL
        ) WITHOUT ROWID;
        CREATE TABLE IF NOT EXISTS version_rows (
            version_id INTEGER NOT NULL REFERENCES versions(id) ON DELETE RESTRICT,
            text_id TEXT NOT NULL,
            en_hash BLOB NOT NULL REFERENCES content_blobs(hash),
            zh_hans_hash BLOB NOT NULL REFERENCES content_blobs(hash),
            ja_hash BLOB NOT NULL REFERENCES content_blobs(hash),
            source_kind TEXT NOT NULL,
            source_ref TEXT NOT NULL,
            PRIMARY KEY (version_id, text_id)
        ) WITHOUT ROWID;
        CREATE INDEX IF NOT EXISTS idx_version_rows_text_id ON version_rows(text_id);
    """)
    columns = {row[1] for row in con.execute("PRAGMA table_info(version_rows)")}
    if "source_path" not in columns:
        con.execute("ALTER TABLE version_rows ADD COLUMN source_path TEXT")
    if "source_name" not in columns:
        con.execute("ALTER TABLE version_rows ADD COLUMN source_name TEXT")
    con.commit()
    return con


def create_snapshot(history_path: Path, source: Path, tag: str, note: str | None = None) -> dict:
    tag = tag.strip()
    if not tag:
        raise ValueError("tag must not be empty")
    if tag == WORKING:
        raise ValueError(f"{WORKING!r} is reserved")
    rows, stats = load_dataset(source)
    snapshot_hash = dataset_hash(rows)
    con = connect_history(history_path)
    try:
        if con.execute("SELECT 1 FROM versions WHERE tag = ?", (tag,)).fetchone():
            raise ValueError(f"tag already exists and is immutable: {tag}")
        created_at = datetime.now(timezone.utc).isoformat()
        with con:
            cur = con.execute(
                """INSERT INTO versions
                   (tag, note, created_at, dataset_hash, row_count, category_row_count, quest_row_count)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (tag, note or None, created_at, snapshot_hash, stats["rows"], stats["category_rows"], stats["quest_rows"]),
            )
            version_id = int(cur.lastrowid)
            blobs: dict[bytes, str] = {}
            version_rows = []
            for row in rows.values():
                hashes = tuple(_text_hash(value) for value in (row.en, row.zh_hans, row.ja))
                for blob_hash, content in zip(hashes, (row.en, row.zh_hans, row.ja)):
                    blobs.setdefault(blob_hash, content)
                version_rows.append((
                    version_id, row.text_id, *hashes, row.source_kind, row.source_ref,
                    row.source_path, row.source_name,
                ))
            con.executemany("INSERT OR IGNORE INTO content_blobs(hash, content) VALUES (?, ?)", blobs.items())
            con.executemany("""INSERT INTO version_rows
                (version_id, text_id, en_hash, zh_hans_hash, ja_hash, source_kind, source_ref, source_path, source_name)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""", version_rows)
        return {
            "id": version_id,
            "tag": tag,
            "note": note or None,
            "created_at": created_at,
            "dataset_hash": snapshot_hash,
            "row_count": stats["rows"],
            "category_row_count": stats["category_rows"],
            "quest_row_count": stats["quest_rows"],
        }
    finally:
        con.close()


def list_versions(history_path: Path) -> list[dict]:
    con = connect_history(history_path)
    try:
        return [dict(row) for row in con.execute("SELECT * FROM versions ORDER BY id DESC")]
    finally:
        con.close()


def enrich_snapshot_paths(history_path: Path, tag: str, source: Path) -> dict:
    """Add grouping paths to an existing immutable-content snapshot."""
    rows, _stats = load_dataset(source)
    source_hash = dataset_hash(rows)
    con = connect_history(history_path)
    try:
        version = con.execute("SELECT id, dataset_hash FROM versions WHERE tag = ?", (tag,)).fetchone()
        if version is None:
            raise ValueError(f"unknown version tag: {tag}")
        if version["dataset_hash"] != source_hash:
            raise ValueError(f"source dataset does not match tag {tag}")
        with con:
            con.executemany(
                "UPDATE version_rows SET source_path = ?, source_name = ? WHERE version_id = ? AND text_id = ?",
                [(row.source_path, row.source_name, version["id"], text_id) for text_id, row in rows.items()],
            )
        count = con.execute(
            "SELECT count(*) FROM version_rows WHERE version_id = ? AND source_path IS NOT NULL",
            (version["id"],),
        ).fetchone()[0]
        return {"tag": tag, "enriched_rows": count, "dataset_hash": source_hash}
    finally:
        con.close()


def _saved_rows(history_path: Path, tag: str, language: Language) -> dict[str, tuple[str, str, str, str | None, str]]:
    column = {"en": "en_hash", "zh-Hans": "zh_hans_hash", "ja": "ja_hash"}[language]
    con = connect_history(history_path)
    try:
        version = con.execute("SELECT id FROM versions WHERE tag = ?", (tag,)).fetchone()
        if version is None:
            raise ValueError(f"unknown version tag: {tag}")
        query = f"""
            SELECT vr.text_id, cb.content, vr.source_kind, vr.source_ref, vr.source_path,
                   COALESCE(vr.source_name, '') AS source_name
            FROM version_rows vr
            JOIN content_blobs cb ON cb.hash = vr.{column}
            WHERE vr.version_id = ?
        """
        return {row["text_id"]: (
                    row["content"], row["source_kind"], row["source_ref"], row["source_path"], row["source_name"]
                )
                for row in con.execute(query, (version["id"],))}
    finally:
        con.close()


def _working_rows(source: Path, language: Language) -> dict[str, tuple[str, str, str, str, str]]:
    rows, _ = load_dataset(source)
    return {
        text_id: (row.content(language), row.source_kind, row.source_ref, row.source_path, row.source_name)
        for text_id, row in rows.items()
    }


def _target_rows(history_path: Path, working_source: Path, target: str, language: Language):
    return _working_rows(working_source, language) if target == WORKING else _saved_rows(history_path, target, language)


def diff_rows(
    history_path: Path,
    working_source: Path,
    base: str,
    target: str,
    language: Language,
) -> tuple[list[dict], dict[str, int]]:
    if language not in LANGUAGES:
        raise ValueError(f"unsupported language: {language}")
    if base == target:
        raise ValueError("base and target must be different")
    before = _target_rows(history_path, working_source, base, language)
    after = _target_rows(history_path, working_source, target, language)
    results: list[dict] = []
    summary = {"added": 0, "removed": 0, "changed": 0}
    for text_id in sorted(before.keys() | after.keys()):
        old = before.get(text_id)
        new = after.get(text_id)
        if old is None:
            status = "added"
        elif new is None:
            status = "removed"
        elif old[0] != new[0]:
            status = "changed"
        else:
            continue
        summary[status] += 1
        source = new or old
        results.append({
            "status": status,
            "text_id": text_id,
            "old_content": old[0] if old else None,
            "new_content": new[0] if new else None,
            "source_kind": source[1],
            "source_ref": source[2],
            "source_path": source[3],
            "name": source[4],
        })
    return results, summary


def diff_page(
    history_path: Path,
    working_source: Path,
    base: str,
    target: str,
    language: Language = "en",
    statuses: Iterable[str] = ("added", "removed", "changed"),
    query: str | None = None,
    page: int = 1,
    page_size: int = 100,
) -> dict:
    rows, summary = diff_rows(history_path, working_source, base, target, language)
    allowed = set(statuses)
    invalid = allowed - {"added", "removed", "changed"}
    if invalid:
        raise ValueError(f"unsupported status: {', '.join(sorted(invalid))}")
    needle = (query or "").casefold()
    filtered = [row for row in rows if row["status"] in allowed and (
        not needle
        or needle in row["text_id"].casefold()
        or needle in (row["old_content"] or "").casefold()
        or needle in (row["new_content"] or "").casefold()
    )]
    total = len(filtered)
    start = (page - 1) * page_size
    return {
        "base": base,
        "target": target,
        "language": language,
        "summary": summary,
        "total": total,
        "page": page,
        "page_size": page_size,
        "items": filtered[start:start + page_size],
    }


def _fallback_source_path(source_kind: str, source_ref: str) -> str:
    if source_kind == "category":
        return f"categories/{_sanitize_filename(source_ref)}.json"
    return f"export_quest_ordered/ungrouped/{_sanitize_filename(source_ref)}/dialogue.json"


def _safe_db_path(source_kind: str, source_ref: str, source_path: str | None) -> str:
    raw = (source_path or _fallback_source_path(source_kind, source_ref)).replace("\\", "/")
    path = PurePosixPath(raw)
    if path.is_absolute() or ".." in path.parts or not path.parts:
        raise ValueError(f"unsafe source path for {source_kind}:{source_ref}: {raw}")
    expected = "categories" if source_kind == "category" else "export_quest_ordered"
    if path.parts[0] != expected:
        raise ValueError(f"source path is outside {expected}: {raw}")
    return str(path.with_suffix(".db"))


def _working_group_paths(working_source: Path) -> dict[tuple[str, str], str]:
    rows, _ = load_dataset(working_source)
    paths: dict[tuple[str, str], str] = {}
    for row in rows.values():
        paths.setdefault((row.source_kind, row.source_ref), row.source_path)
    return paths


def diff_groups(
    history_path: Path,
    working_source: Path,
    base: str,
    target: str,
    language: Language,
) -> dict:
    rows, summary = diff_rows(history_path, working_source, base, target, language)
    before = _target_rows(history_path, working_source, base, language)
    before_groups = {(value[1], value[2]) for value in before.values()}
    working_paths = _working_group_paths(working_source)
    grouped: dict[tuple[str, str], dict] = {}
    for row in rows:
        if row["status"] not in ("added", "changed"):
            continue
        key = (row["source_kind"], row["source_ref"])
        source_path = row.get("source_path") or working_paths.get(key)
        group = grouped.setdefault(key, {
            "group_id": f"{key[0]}:{key[1]}",
            "source_kind": key[0],
            "source_ref": key[1],
            "db_path": _safe_db_path(key[0], key[1], source_path),
            "is_new_group": key not in before_groups,
            "added": 0,
            "changed": 0,
            "total": 0,
        })
        group[row["status"]] += 1
        group["total"] += 1
    groups = sorted(grouped.values(), key=lambda group: (-group["total"], group["source_kind"], group["source_ref"]))
    paths: dict[str, str] = {}
    for group in groups:
        previous = paths.setdefault(group["db_path"], group["group_id"])
        if previous != group["group_id"]:
            raise ValueError(f"group path collision: {group['db_path']} ({previous}, {group['group_id']})")
    return {
        "base": base,
        "target": target,
        "language": language,
        "summary": summary,
        "exportable_rows": sum(group["total"] for group in groups),
        "groups": groups,
    }


def export_structured_zip(
    output: Path,
    history_path: Path,
    working_source: Path,
    base: str,
    target: str,
    language: Language,
    selected_group_ids: Iterable[str],
) -> dict:
    group_result = diff_groups(history_path, working_source, base, target, language)
    groups_by_id = {group["group_id"]: group for group in group_result["groups"]}
    selected = list(dict.fromkeys(selected_group_ids))
    if not selected:
        raise ValueError("at least one diff group must be selected")
    unknown = sorted(set(selected) - groups_by_id.keys())
    if unknown:
        raise ValueError(f"unknown diff groups: {', '.join(unknown[:10])}")
    selected_set = set(selected)
    rows, summary = diff_rows(history_path, working_source, base, target, language)
    grouped_rows: dict[str, list[dict]] = {group_id: [] for group_id in selected}
    for row in rows:
        if row["status"] not in ("added", "changed"):
            continue
        group_id = f"{row['source_kind']}:{row['source_ref']}"
        if group_id in selected_set:
            grouped_rows[group_id].append(row)

    created_at = datetime.now(timezone.utc).isoformat()
    manifest_groups = [groups_by_id[group_id] for group_id in selected]
    manifest = {
        "base": base,
        "target": target,
        "language": language,
        "generated_at": created_at,
        "diff_summary": summary,
        "selected_group_count": len(manifest_groups),
        "exported_row_count": sum(len(grouped_rows[group_id]) for group_id in selected),
        "groups": manifest_groups,
    }

    output.parent.mkdir(parents=True, exist_ok=True)
    output.unlink(missing_ok=True)
    with tempfile.TemporaryDirectory(prefix="wuwaid-structured-diff-") as raw_dir:
        root = Path(raw_dir)
        for group in manifest_groups:
            db_path = root.joinpath(*PurePosixPath(group["db_path"]).parts)
            db_path.parent.mkdir(parents=True, exist_ok=True)
            export_sqlite(db_path, grouped_rows[group["group_id"]])
        (root / "manifest.json").write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        with (root / "manifest.csv").open("w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=[
                "group_id", "source_kind", "source_ref", "db_path", "is_new_group",
                "added", "changed", "total",
            ])
            writer.writeheader()
            writer.writerows(manifest_groups)
        with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
            for path in sorted(root.rglob("*")):
                if path.is_file():
                    archive.write(path, path.relative_to(root).as_posix())
    return manifest


def export_sqlite(path: Path, rows: list[dict]) -> None:
    path.unlink(missing_ok=True)
    con = sqlite3.connect(path)
    try:
        con.execute("CREATE TABLE MultiText (Id TEXT UNIQUE PRIMARY KEY NOT NULL, Name TEXT, Content TEXT)")
        con.executemany(
            "INSERT INTO MultiText(Id, Name, Content) VALUES (?, ?, ?)",
            [
                (row["text_id"], row.get("name") or "", row["new_content"] or "")
                for row in rows if row["status"] in ("added", "changed")
            ],
        )
        con.commit()
    finally:
        con.close()


def export_csv(path: Path, rows: list[dict]) -> None:
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=[
            "status", "Id", "old_content", "new_content", "source_kind", "source_ref"
        ])
        writer.writeheader()
        for row in rows:
            writer.writerow({
                "status": row["status"],
                "Id": row["text_id"],
                "old_content": row["old_content"] or "",
                "new_content": row["new_content"] or "",
                "source_kind": row["source_kind"],
                "source_ref": row["source_ref"],
            })
