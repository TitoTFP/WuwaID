import json
import sqlite3
import pytest
from pathlib import Path
from fastapi.testclient import TestClient

from app import db
from app.main import app


@pytest.fixture
def test_setup(tmp_path, monkeypatch):
    """Setup temp workspace with a quest database and categories."""
    data_dir = tmp_path / "data"
    quests_dir = data_dir / "quests"
    quests_dir.mkdir(parents=True)
    quests_id_dir = data_dir / "quests_id"
    quests_id_dir.mkdir(parents=True)
    cats_dir = data_dir / "categories"
    cats_dir.mkdir(parents=True)
    cats_id_dir = data_dir / "categories_id"
    cats_id_dir.mkdir(parents=True)

    # 1. Create dummy quest
    quest = {
        "quest_id": 106000002,
        "quest_name": "Test Quest",
        "quest_type": 1,
        "languages": ["en"],
        "total_lines": 1,
        "flows": [],
        "all_lines": [
            {
                "id": 1,
                "type": "Talk",
                "state_key": "Flow_1_1",
                "text_key": "t1",
                "speaker_en": "Rover",
                "text_en": "Hello.",
                "options": [],
            }
        ],
        "chapter_id": 1,
        "chapter_name": "Test Chapter",
        "side": 0,
    }
    (quests_dir / "106000002.json").write_text(json.dumps(quest), encoding="utf-8")
    (quests_id_dir / "106000002.json").write_text(json.dumps({
        "1": {"id": "Halo."}
    }), encoding="utf-8")

    # 2. Create dummy category
    cat_data = {
        "Item_Sword_001_Name": {"zh-Hans": "铁剑", "en": "Iron Sword", "ja": "鉄剣"},
    }
    (cats_dir / "Item.json").write_text(json.dumps(cat_data), encoding="utf-8")
    (cats_id_dir / "Item.json").write_text(json.dumps({
        "Item_Sword_001_Name": {"id": "Pedang Besi"}
    }), encoding="utf-8")

    # 3. Setup SQLite DB
    db_path = data_dir / "index.db"
    db.set_db_path(db_path)

    # Rebuild FTS (which creates all editor tables + category tables + quests table)
    from scripts.build_index import build_fts, build_category_fts
    build_fts(db_path, [quest])
    build_category_fts(db_path, data_dir)

    # Call ensure_editor_schema() to handle any potential schema updates
    db.ensure_editor_schema()

    # Seed extra data into quests table
    con = db.connect()
    try:
        con.execute(
            "INSERT OR REPLACE INTO quests VALUES (?,?,?,?,?,?,?,?,?)",
            (106000002, "Test Quest", 1, 0, 1, "Test Chapter", 1, 1, 1),
        )
        con.commit()
    finally:
        con.close()

    monkeypatch.setenv("EDITOR_PASSWORD", "s3cr3t")
    monkeypatch.setenv("SESSION_SECRET", "test-secret-1234567890")

    from app import main as appmain
    monkeypatch.setattr(appmain, "DATA_DIR", data_dir)
    monkeypatch.setattr(appmain, "QUESTS_DIR", quests_dir)

    client = TestClient(app)
    
    # Login as editor
    r = client.post("/api/login", json={"password": "s3cr3t"})
    assert r.status_code == 200

    yield client, data_dir, db_path

    db.set_db_path(None)


def test_get_editor_category_entries(test_setup):
    client, _, _ = test_setup
    r = client.get("/api/editor/category/Item/entries")
    assert r.status_code == 200
    entries = r.json()
    assert len(entries) == 1
    assert entries[0]["key"] == "Item_Sword_001_Name"
    assert entries[0]["id"] == "Pedang Besi"
    assert entries[0]["prefix"] == "Item"


def test_category_draft_lifecycle(test_setup):
    client, _, db_path = test_setup
    
    # 1. Create category draft
    r = client.post(
        "/api/editor/category/drafts",
        json={
            "category": "Item",
            "key": "Item_Sword_001_Name",
            "patch": {"text_id": "Pedang Besi Keren"},
            "note": "A better name",
        },
        headers={"X-Author-Label": "translator-1"},
    )
    assert r.status_code == 200
    draft_id = r.json()["id"]
    assert draft_id >= 1000000

    # 2. List drafts
    r_list = client.get("/api/drafts")
    assert r_list.status_code == 200
    drafts = r_list.json()
    assert any(d["id"] == draft_id for d in drafts)
    draft = next(d for d in drafts if d["id"] == draft_id)
    assert draft["category"] == "Item"
    assert draft["key"] == "Item_Sword_001_Name"

    # 3. Get draft detail
    r_detail = client.get(f"/api/drafts/{draft_id}")
    assert r_detail.status_code == 200
    detail = r_detail.json()
    assert detail["patch"]["text_id"] == "Pedang Besi Keren"
    assert detail["original_json"]["key"] == "Item_Sword_001_Name"

    # 4. Approve draft
    r_approve = client.post(f"/api/drafts/{draft_id}/approve")
    assert r_approve.status_code == 200

    # 5. Check overlay applied in category Single API
    r_cat = client.get("/api/editor/category/Item/entries")
    assert r_cat.json()[0]["id"] == "Pedang Besi Keren"
    assert r_cat.json()[0]["is_edited"] is True


def test_delete_quest_translation_local(test_setup):
    client, data_dir, db_path = test_setup
    
    # Assert MT files exist initially
    assert (data_dir / "quests_id" / "106000002.json").is_file()

    # Call local delete endpoint
    r = client.delete("/api/editor/quest/106000002/translation")
    assert r.status_code == 200

    # Assert MT file deleted
    assert not (data_dir / "quests_id" / "106000002.json").is_file()


def test_delete_category_translation_local(test_setup):
    client, data_dir, _ = test_setup
    
    # Assert MT files exist initially
    assert (data_dir / "categories_id" / "Item.json").is_file()

    # Call local delete endpoint
    r = client.delete("/api/editor/category/Item/translation")
    assert r.status_code == 200

    # Assert MT file deleted
    assert not (data_dir / "categories_id" / "Item.json").is_file()


def test_global_clear_translations(test_setup):
    client, data_dir, _ = test_setup

    # Assert MT files exist initially
    assert (data_dir / "quests_id" / "106000002.json").is_file()
    assert (data_dir / "categories_id" / "Item.json").is_file()

    # Call global clear endpoint
    r = client.post("/api/editor/clear-translations")
    assert r.status_code == 200

    # Assert all MT files are deleted
    assert len(list((data_dir / "quests_id").iterdir())) == 0
    assert len(list((data_dir / "categories_id").iterdir())) == 0
