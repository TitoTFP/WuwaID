from __future__ import annotations

import csv
import io
import json
import sqlite3
import zipfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import db
from app.main import app
from app.text_versions import (
    create_snapshot,
    connect_history,
    dataset_hash,
    diff_groups,
    diff_page,
    diff_rows,
    export_csv,
    export_sqlite,
    export_structured_zip,
    enrich_snapshot_paths,
    list_versions,
    load_dataset,
    _safe_db_path,
)


def write_dataset(root: Path, *, changed: bool = False) -> None:
    categories = root / "categories"
    quests = root / "quests"
    categories.mkdir(parents=True)
    quests.mkdir(parents=True)
    (categories / "Item.json").write_text(json.dumps({
        "same": {"en": "Same", "zh-Hans": "相同", "ja": "同じ"},
        "change": {"en": "New\nvalue" if changed else "Old value", "zh-Hans": "新" if changed else "旧", "ja": "新"},
        **({"added": {"en": "Added café", "zh-Hans": "新增", "ja": "追加"}} if changed else {}),
        **({"removed": {"en": "Removed", "zh-Hans": "删除", "ja": "削除"}} if not changed else {}),
    }, ensure_ascii=False), encoding="utf-8")
    quest = {
        "quest_id": 7,
        "all_lines": [{
            "text_key": "quest-line",
            "text_en": "Quest line",
            "text_zh-Hans": "任务",
            "text_ja": "クエスト",
            "options": [{
                "text_key": "quest-option",
                "text_en": "Option",
                "text_zh-Hans": "选项",
                "text_ja": "選択肢",
            }],
        }],
    }
    (quests / "7.json").write_text(json.dumps(quest, ensure_ascii=False), encoding="utf-8")


def test_loader_includes_categories_quests_and_options(tmp_path):
    write_dataset(tmp_path)
    rows, stats = load_dataset(tmp_path)
    assert set(rows) == {"same", "change", "removed", "quest-line", "quest-option"}
    assert stats == {"rows": 5, "category_rows": 3, "quest_rows": 2, "category_files": 1, "quest_files": 1}
    assert rows["same"].source_path == "categories/Item.json"
    assert rows["quest-line"].source_path == "export_quest_ordered/Chapter_0_Chapter 0/000_Quest_7/dialogue.json"


def test_loader_preserves_nested_wuwaid_quest_path(tmp_path):
    categories = tmp_path / "categories"
    quest_dir = tmp_path / "export_quest_ordered" / "Chapter_3_Stars" / "018_We Choose the Sky"
    categories.mkdir(parents=True)
    quest_dir.mkdir(parents=True)
    (categories / "Item.json").write_text(json.dumps({"cat": {"en": "Category"}}))
    (quest_dir / "dialogue.json").write_text(json.dumps({
        "quest_id": 125000129,
        "all_lines": [{"text_key": "line", "text_en": "Line"}],
    }))
    rows, _ = load_dataset(tmp_path)
    assert rows["line"].source_path == "export_quest_ordered/Chapter_3_Stars/018_We Choose the Sky/dialogue.json"


def test_loader_rejects_conflicting_duplicate_ids(tmp_path):
    write_dataset(tmp_path)
    quest = json.loads((tmp_path / "quests" / "7.json").read_text())
    quest["all_lines"].append({"text_key": "quest-line", "text_en": "Conflict"})
    (tmp_path / "quests" / "7.json").write_text(json.dumps(quest))
    with pytest.raises(ValueError, match="Conflicting Content"):
        load_dataset(tmp_path)


def test_snapshot_is_immutable_deterministic_and_content_addressed(tmp_path):
    source = tmp_path / "source"
    history = tmp_path / "history.db"
    write_dataset(source)
    rows, _ = load_dataset(source)
    first = create_snapshot(history, source, "v1")
    second = create_snapshot(history, source, "v1-copy")
    assert first["dataset_hash"] == second["dataset_hash"] == dataset_hash(rows)
    with pytest.raises(ValueError, match="immutable"):
        create_snapshot(history, source, "v1")
    con = sqlite3.connect(history)
    assert con.execute("SELECT count(*) FROM versions").fetchone()[0] == 2
    # Repeated content is stored once, not once per row/version.
    expected_blobs = {value for row in rows.values() for value in (row.en, row.zh_hans, row.ja)}
    assert con.execute("SELECT count(*) FROM content_blobs").fetchone()[0] == len(expected_blobs)
    con.close()


def test_history_schema_migrates_and_paths_can_be_enriched_without_hash_change(tmp_path):
    source = tmp_path / "source"
    history = tmp_path / "history.db"
    write_dataset(source)
    version = create_snapshot(history, source, "v1")
    con = sqlite3.connect(history)
    con.execute("UPDATE version_rows SET source_path = NULL")
    con.commit()
    con.close()
    result = enrich_snapshot_paths(history, "v1", source)
    assert result["dataset_hash"] == version["dataset_hash"]
    assert result["enriched_rows"] == version["row_count"]
    con = connect_history(history)
    assert "source_path" in {row[1] for row in con.execute("PRAGMA table_info(version_rows)")}
    assert con.execute("SELECT dataset_hash FROM versions WHERE tag='v1'").fetchone()[0] == version["dataset_hash"]
    con.close()


def test_connect_history_adds_source_path_to_legacy_schema(tmp_path):
    history = tmp_path / "legacy.db"
    con = sqlite3.connect(history)
    con.execute("""CREATE TABLE version_rows (
        version_id INTEGER NOT NULL,
        text_id TEXT NOT NULL,
        en_hash BLOB NOT NULL,
        zh_hans_hash BLOB NOT NULL,
        ja_hash BLOB NOT NULL,
        source_kind TEXT NOT NULL,
        source_ref TEXT NOT NULL,
        PRIMARY KEY (version_id, text_id)
    ) WITHOUT ROWID""")
    con.commit()
    con.close()
    migrated = connect_history(history)
    assert "source_path" in {row[1] for row in migrated.execute("PRAGMA table_info(version_rows)")}
    migrated.close()


def test_diff_languages_filters_pagination_and_working_tree(tmp_path):
    old = tmp_path / "old"
    current = tmp_path / "current"
    history = tmp_path / "history.db"
    write_dataset(old)
    write_dataset(current, changed=True)
    create_snapshot(history, old, "v1")
    create_snapshot(history, current, "v2")

    result = diff_page(history, current, "v1", "v2", "en", page_size=2)
    assert result["summary"] == {"added": 1, "removed": 1, "changed": 1}
    assert result["total"] == 3
    assert len(result["items"]) == 2
    assert diff_page(history, current, "v1", "working", "en")["summary"] == result["summary"]
    changed = diff_page(history, current, "v1", "v2", "en", statuses=["changed"], query="new\n")
    assert changed["total"] == 1
    assert changed["items"][0]["old_content"] == "Old value"
    assert changed["items"][0]["new_content"] == "New\nvalue"
    assert diff_page(history, current, "v1", "v2", "zh-Hans")["summary"]["changed"] == 1


def test_empty_content_is_changed_but_category_move_is_not(tmp_path):
    old = tmp_path / "old"
    current = tmp_path / "current"
    history = tmp_path / "history.db"
    write_dataset(old)
    write_dataset(current)
    old_data = json.loads((old / "categories" / "Item.json").read_text())
    current_data = json.loads((current / "categories" / "Item.json").read_text())
    old_data["same"]["en"] = ""
    current_data["same"]["en"] = "Filled"
    (old / "categories" / "Item.json").write_text(json.dumps(old_data, ensure_ascii=False))
    # Move every unchanged row to another category in the target snapshot.
    (current / "categories" / "Item.json").unlink()
    (current / "categories" / "Moved.json").write_text(json.dumps(current_data, ensure_ascii=False))
    create_snapshot(history, old, "v1")
    create_snapshot(history, current, "v2")
    result = diff_page(history, current, "v1", "v2", "en")
    assert result["summary"] == {"added": 0, "removed": 0, "changed": 1}
    assert result["items"][0]["text_id"] == "same"
    assert result["items"][0]["old_content"] == ""
    assert result["items"][0]["new_content"] == "Filled"


def test_group_summary_detects_new_groups_and_structured_zip_subset(tmp_path):
    old = tmp_path / "old"
    current = tmp_path / "current"
    history = tmp_path / "history.db"
    write_dataset(old)
    write_dataset(current, changed=True)
    item_path = current / "categories" / "Item.json"
    item = json.loads(item_path.read_text())
    added = item.pop("added")
    item_path.write_text(json.dumps(item, ensure_ascii=False))
    (current / "categories" / "NewGroup.json").write_text(json.dumps({"added": added}, ensure_ascii=False))
    create_snapshot(history, old, "v1")
    create_snapshot(history, current, "v2")

    groups = diff_groups(history, current, "v1", "v2", "en")
    new_group = next(group for group in groups["groups"] if group["group_id"] == "category:NewGroup")
    assert new_group["is_new_group"] is True
    assert new_group["db_path"] == "categories/NewGroup.db"
    assert new_group["added"] == 1
    item_group = next(group for group in groups["groups"] if group["group_id"] == "category:Item")
    assert item_group["is_new_group"] is False

    output = tmp_path / "structured.zip"
    manifest = export_structured_zip(
        output, history, current, "v1", "v2", "en", ["category:NewGroup"]
    )
    assert manifest["selected_group_count"] == 1
    assert manifest["exported_row_count"] == 1
    with zipfile.ZipFile(output) as archive:
        assert set(archive.namelist()) == {"manifest.csv", "manifest.json", "categories/NewGroup.db"}
        db_path = tmp_path / "exported.db"
        db_path.write_bytes(archive.read("categories/NewGroup.db"))
    con = sqlite3.connect(db_path)
    assert con.execute("SELECT Id, Content FROM MultiText").fetchall() == [("added", "Added café")]
    con.close()


def test_structured_paths_reject_traversal_and_collisions(tmp_path):
    with pytest.raises(ValueError, match="unsafe source path"):
        _safe_db_path("quest", "7", "../escape/dialogue.json")
    old = tmp_path / "old"
    current = tmp_path / "current"
    history = tmp_path / "history.db"
    write_dataset(old)
    write_dataset(current, changed=True)
    create_snapshot(history, old, "v1")
    create_snapshot(history, current, "v2")
    con = sqlite3.connect(history)
    version_id = con.execute("SELECT id FROM versions WHERE tag='v2'").fetchone()[0]
    con.execute(
        "UPDATE version_rows SET source_path='categories/Same.json' WHERE version_id=? AND text_id IN ('added','change')",
        (version_id,),
    )
    # Force the two rows to appear as distinct groups with the same output path.
    con.execute(
        "UPDATE version_rows SET source_ref='Other' WHERE version_id=? AND text_id='added'",
        (version_id,),
    )
    con.commit()
    con.close()
    with pytest.raises(ValueError, match="group path collision"):
        diff_groups(history, current, "v1", "v2", "en")


def test_exports_are_translation_compatible_and_unicode_safe(tmp_path):
    old = tmp_path / "old"
    current = tmp_path / "current"
    history = tmp_path / "history.db"
    write_dataset(old)
    write_dataset(current, changed=True)
    create_snapshot(history, old, "v1")
    create_snapshot(history, current, "v2")
    rows, _ = diff_rows(history, current, "v1", "v2", "en")
    db_path = tmp_path / "diff.db"
    csv_path = tmp_path / "diff.csv"
    export_sqlite(db_path, rows)
    export_csv(csv_path, rows)
    con = sqlite3.connect(db_path)
    assert con.execute("PRAGMA table_info(MultiText)").fetchall()[0][1] == "Id"
    assert con.execute("SELECT Id, Content FROM MultiText ORDER BY Id").fetchall() == [
        ("added", "Added café"), ("change", "New\nvalue")
    ]
    con.close()
    with csv_path.open(encoding="utf-8", newline="") as handle:
        csv_rows = list(csv.DictReader(handle))
    assert {row["status"] for row in csv_rows} == {"added", "removed", "changed"}
    assert next(row for row in csv_rows if row["Id"] == "change")["new_content"] == "New\nvalue"


@pytest.fixture
def versions_client(tmp_path, monkeypatch):
    data_dir = tmp_path / "data"
    write_dataset(data_dir)
    index_db = data_dir / "index.db"
    con = sqlite3.connect(index_db)
    con.execute("""CREATE TABLE editor_session (
        token TEXT PRIMARY KEY, created_at TEXT NOT NULL, expires_at TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'editor')""")
    con.commit()
    con.close()
    from app import main as appmain
    old_data = appmain.DATA_DIR
    old_db = db.DB_PATH
    appmain.DATA_DIR = data_dir
    db.set_db_path(index_db)
    monkeypatch.setenv("EDITOR_PASSWORD", "secret")
    monkeypatch.setenv("SESSION_SECRET", "version-test-secret")
    client = TestClient(app)
    yield client, data_dir
    appmain.DATA_DIR = old_data
    db.set_db_path(old_db)


def test_version_api_is_editor_only_and_supports_snapshot_diff_export(versions_client):
    client, data_dir = versions_client
    assert client.get("/api/editor/versions").status_code == 401
    assert client.get("/api/editor/versions/diff/groups?base=v1&target=v2&lang=en").status_code == 401
    assert client.post("/api/editor/versions/diff/export-structured", json={"groups": []}).status_code == 401
    assert client.post("/api/login", json={"password": "secret"}).status_code == 200
    assert client.post("/api/editor/versions", json={"tag": "v1"}).status_code == 200
    # Mutate only the temporary test working tree.
    data = json.loads((data_dir / "categories" / "Item.json").read_text())
    data["change"]["en"] = "Changed through API"
    (data_dir / "categories" / "Item.json").write_text(json.dumps(data, ensure_ascii=False))
    assert client.post("/api/editor/versions", json={"tag": "v2"}).status_code == 200
    versions = client.get("/api/editor/versions").json()
    assert [version["tag"] for version in versions] == ["v2", "v1"]
    diff = client.get("/api/editor/versions/diff?base=v1&target=v2&lang=en").json()
    assert diff["summary"]["changed"] == 1
    exported = client.get("/api/editor/versions/diff/export?base=v1&target=v2&lang=en&format=csv")
    assert exported.status_code == 200
    assert "change" in exported.text
    groups = client.get("/api/editor/versions/diff/groups?base=v1&target=v2&lang=en")
    assert groups.status_code == 200
    group_id = groups.json()["groups"][0]["group_id"]
    structured = client.post("/api/editor/versions/diff/export-structured", json={
        "base": "v1", "target": "v2", "lang": "en", "groups": [group_id],
    })
    assert structured.status_code == 200
    assert structured.headers["content-type"] == "application/zip"
    with zipfile.ZipFile(io.BytesIO(structured.content)) as archive:
        assert "manifest.json" in archive.namelist()


def test_structured_api_rejects_unknown_groups(versions_client):
    client, _data_dir = versions_client
    client.post("/api/login", json={"password": "secret"})
    client.post("/api/editor/versions", json={"tag": "v1"})
    # A second identical tag has no diff groups, so any requested group is invalid.
    client.post("/api/editor/versions", json={"tag": "v2"})
    response = client.post("/api/editor/versions/diff/export-structured", json={
        "base": "v1", "target": "v2", "lang": "en", "groups": ["quest:not-real"],
    })
    assert response.status_code == 400
    assert "unknown diff groups" in response.text


def test_history_is_separate_from_rebuilt_index(tmp_path):
    source = tmp_path / "data"
    write_dataset(source)
    history = source / "version_history.db"
    create_snapshot(history, source, "v1")
    (source / "index.db").write_bytes(b"old index")
    (source / "index.db").unlink()
    (source / "index.db").write_bytes(b"rebuilt index")
    assert [version["tag"] for version in list_versions(history)] == ["v1"]
