"""Tests for the category FTS5 tables built by scripts/build_index.py."""
from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pytest

from scripts.build_index import build_category_fts, cjk_bigrams


def _write_categories(data_dir: Path, categories: dict[str, dict]) -> None:
    cat_dir = data_dir / "categories"
    cat_dir.mkdir(parents=True, exist_ok=True)
    for name, entries in categories.items():
        (cat_dir / f"{name}.json").write_text(
            json.dumps(entries, ensure_ascii=False), encoding="utf-8",
        )


def _write_translations(data_dir: Path, translations: dict[str, dict]) -> None:
    cat_id_dir = data_dir / "categories_id"
    cat_id_dir.mkdir(parents=True, exist_ok=True)
    for name, entries in translations.items():
        (cat_id_dir / f"{name}.json").write_text(
            json.dumps(entries, ensure_ascii=False), encoding="utf-8",
        )


def test_build_category_fts_creates_tables(tmp_path: Path):
    _write_categories(tmp_path, {
        "Item": {"Item_Sword_001_Name": {"zh-Hans": "铁剑", "en": "Iron Sword", "ja": "鉄剣"}},
    })
    db_path = tmp_path / "index.db"
    build_category_fts(db_path, tmp_path)
    assert db_path.exists()
    con = sqlite3.connect(db_path)
    cur = con.cursor()
    tables = {r[0] for r in cur.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
    assert "category_text_idx" in tables
    assert "categories" in tables
    con.close()


def test_build_category_fts_merges_id_from_translations(tmp_path: Path):
    _write_categories(tmp_path, {
        "Item": {"Item_Sword_001_Name": {"zh-Hans": "铁剑", "en": "Iron Sword", "ja": "鉄剣"}},
    })
    _write_translations(tmp_path, {
        "Item": {"Item_Sword_001_Name": {"zh-Hans": "铁剑", "en": "Iron Sword", "ja": "鉄剣", "id": "Pedang Besi"}},
    })
    db_path = tmp_path / "index.db"
    build_category_fts(db_path, tmp_path)
    con = sqlite3.connect(db_path)
    row = con.execute(
        "SELECT text_en, text_id FROM category_text_idx WHERE key = ?",
        ("Item_Sword_001_Name",),
    ).fetchone()
    assert row == ("Iron Sword", "Pedang Besi")
    con.close()


def test_build_category_fts_empty_id_when_no_translation(tmp_path: Path):
    _write_categories(tmp_path, {
        "Item": {"Item_X": {"zh-Hans": "x", "en": "X item", "ja": "x"}},
    })
    db_path = tmp_path / "index.db"
    build_category_fts(db_path, tmp_path)
    con = sqlite3.connect(db_path)
    row = con.execute(
        "SELECT text_id FROM category_text_idx WHERE key = ?",
        ("Item_X",),
    ).fetchone()
    assert row[0] == ""
    con.close()


def test_build_category_fts_computes_prefix(tmp_path: Path):
    _write_categories(tmp_path, {
        "Skill": {
            "Skill_Fireball_Name": {"zh-Hans": "火球", "en": "Fireball", "ja": "ファイヤーボール"},
            "SkillInfo_Fireball_Desc": {"zh-Hans": "desc", "en": "description", "ja": "desc"},
        },
    })
    db_path = tmp_path / "index.db"
    build_category_fts(db_path, tmp_path)
    con = sqlite3.connect(db_path)
    rows = con.execute(
        "SELECT key, prefix FROM category_text_idx ORDER BY key",
    ).fetchall()
    assert rows == [
        ("SkillInfo_Fireball_Desc", "SkillInfo"),
        ("Skill_Fireball_Name", "Skill"),
    ]
    con.close()


def test_build_category_fts_metadata_table(tmp_path: Path):
    _write_categories(tmp_path, {
        "Item": {"Item_A": {"zh-Hans": "a", "en": "a", "ja": "a"}},
    })
    _write_translations(tmp_path, {
        "Item": {"Item_A": {"zh-Hans": "a", "en": "a", "ja": "a", "id": "A_id"}},
    })
    db_path = tmp_path / "index.db"
    build_category_fts(db_path, tmp_path)
    con = sqlite3.connect(db_path)
    row = con.execute(
        "SELECT name, key_count, translated_count FROM categories",
    ).fetchone()
    assert row == ("Item", 1, 1)
    con.close()
