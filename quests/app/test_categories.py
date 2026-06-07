import json
import pytest
from fastapi.testclient import TestClient
from app.main import app

@pytest.fixture
def client(tmp_path, monkeypatch):
    data_dir = tmp_path / "data"
    cat_dir = data_dir / "categories"
    cat_dir.mkdir(parents=True)

    # Write test categories
    item_cat = {
        "Item_1001": {"zh-Hans": "红针花", "en": "Angelica", "ja": "アンゼリカ"},
        "Item_1002": {"zh-Hans": "贝壳", "en": "Shell", "ja": "貝殻"},
        "Item_1003": {"zh-Hans": "珍珠", "en": "Pearl", "ja": "真珠"}
    }
    ui_cat = {
        "UI_Btn_Confirm": {"zh-Hans": "确定", "en": "Confirm", "ja": "決定"},
        "UI_Label_Cancel": {"zh-Hans": "取消", "en": "Cancel", "ja": "キャンセル"}
    }

    (cat_dir / "Item.json").write_text(json.dumps(item_cat, ensure_ascii=False), encoding="utf-8")
    (cat_dir / "UI.json").write_text(json.dumps(ui_cat, ensure_ascii=False), encoding="utf-8")

    from app import main as appmain
    monkeypatch.setattr(appmain, "DATA_DIR", data_dir)

    yield TestClient(app)

def test_list_categories(client):
    r = client.get("/api/categories")
    assert r.status_code == 200
    data = r.json()
    names = [c["name"] for c in data]
    assert names == ["Item", "UI"]

def test_get_category_paginated(client):
    r = client.get("/api/categories/Item?page=1&page_size=2")
    assert r.status_code == 200
    data = r.json()
    assert data["category"] == "Item"
    assert data["total"] == 3
    assert len(data["items"]) == 2
    assert data["items"][0]["key"] == "Item_1001"
    assert data["items"][0]["en"] == "Angelica"

def test_get_category_filter(client):
    r = client.get("/api/categories/Item?q=Pearl")
    assert r.status_code == 200
    data = r.json()
    assert data["total"] == 1
    assert len(data["items"]) == 1
    assert data["items"][0]["key"] == "Item_1003"
    assert data["items"][0]["en"] == "Pearl"

def test_get_category_not_found(client):
    r = client.get("/api/categories/NonExistent")
    assert r.status_code == 404


def test_list_categories_endpoint(client_with_categories, tmp_path):
    client, data_dir = client_with_categories
    res = client.get("/api/categories")
    assert res.status_code == 200
    payload = res.json()
    assert any(c["name"] == "Item" for c in payload)
    item = next(c for c in payload if c["name"] == "Item")
    assert item["key_count"] == 2


def test_get_category_endpoint_merges_id(client_with_categories, tmp_path):
    client, data_dir = client_with_categories
    res = client.get("/api/category/Item")
    assert res.status_code == 200
    payload = res.json()
    assert payload["name"] == "Item"
    assert "id" in payload["languages"]
    entries_by_key = {e["key"]: e for e in payload["entries"]}
    assert entries_by_key["Item_Sword_001_Name"]["id"] == "Pedang Besi"
    # Keys not translated -> id is null
    assert entries_by_key["Item_Sword_001_Desc"]["id"] is None


def test_get_category_endpoint_404_for_unknown(client_with_categories):
    client, _ = client_with_categories
    res = client.get("/api/category/NoSuchCategory")
    assert res.status_code == 404


def test_search_endpoint_with_category_scope(client_with_categories):
    client, _ = client_with_categories
    res = client.get("/api/search", params={"q": "Pedang", "lang": "id", "scope": "category"})
    assert res.status_code == 200
    payload = res.json()
    assert isinstance(payload, (list, dict))
