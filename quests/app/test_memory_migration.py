"""Tests for the one-time migration of _memory.json from data/quests_id/
to the shared data/_translation_memory.json."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from scripts.translate_id.memory import Memory


def _write_memory_file(path: Path, entries: dict, model: str = "test-model") -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "version": 1,
        "model": model,
        "created_at": "2026-06-01T00:00:00Z",
        "updated_at": "2026-06-01T00:00:00Z",
        "entries": entries,
    }
    path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")


def test_migration_copies_old_memory_to_new_path(tmp_path: Path):
    """When only the old path exists, load migrates it to the new path."""
    old_path = tmp_path / "data" / "quests_id" / "_memory.json"
    new_path = tmp_path / "data" / "_translation_memory.json"
    _write_memory_file(
        old_path,
        {
            "Key_A": {
                "text_id": "Nilai A",
                "source_text_en": "Value A",
                "source_speaker_en": "",
                "from_quest": 119000000,
            }
        },
    )
    mem = Memory(new_path)
    mem.legacy_path = old_path
    mem.load()
    assert mem.size() == 1
    assert mem.entries["Key_A"]["text_id"] == "Nilai A"
    assert new_path.exists(), "Migration should write the new path"
    assert not old_path.exists(), "Migration should delete the old path"


def test_migration_idempotent(tmp_path: Path):
    """Running load twice does not double-migrate."""
    old_path = tmp_path / "data" / "quests_id" / "_memory.json"
    new_path = tmp_path / "data" / "_translation_memory.json"
    _write_memory_file(old_path, {"Key_B": {"text_id": "Nilai B", "source_text_en": "Value B", "source_speaker_en": "", "from_quest": 0}})

    first = Memory(new_path)
    first.legacy_path = old_path
    first.load()
    second = Memory(new_path)
    second.legacy_path = old_path
    second.load()
    assert second.size() == 1
    assert not old_path.exists()


def test_migration_no_op_when_new_path_already_exists(tmp_path: Path):
    """If new path already has more entries, the old file is left alone."""
    old_path = tmp_path / "data" / "quests_id" / "_memory.json"
    new_path = tmp_path / "data" / "_translation_memory.json"
    _write_memory_file(old_path, {"OldKey": {"text_id": "Lama", "source_text_en": "Old", "source_speaker_en": "", "from_quest": 0}})
    _write_memory_file(new_path, {"NewKey": {"text_id": "Baru", "source_text_en": "New", "source_speaker_en": "", "from_quest": 0}})

    mem = Memory(new_path)
    mem.legacy_path = old_path
    mem.load()
    # Old file is not deleted when new path is the source of truth
    assert mem.size() == 1
    assert "NewKey" in mem.entries
    assert old_path.exists(), "Old path left intact when new path is the source of truth"


def test_insert_accepts_string_from_quest():
    """from_quest can be a category name (string) for category translations."""
    from scripts.translate_id.memory import Memory
    mem = Memory(Path("/tmp/_unused_memory.json"))
    inserted = mem.insert(
        text_key="Item_Sword_001_Name",
        text_id="Pedang Besi",
        source_text_en="Iron Sword",
        source_speaker_en="",
        from_quest="Item",
    )
    assert inserted is True
    assert mem.entries["Item_Sword_001_Name"]["from_quest"] == "Item"


def test_corrupt_legacy_file_does_not_break_new_load(tmp_path: Path):
    """A corrupt legacy file is silently skipped; new path starts fresh."""
    old_path = tmp_path / "data" / "quests_id" / "_memory.json"
    new_path = tmp_path / "data" / "_translation_memory.json"
    old_path.parent.mkdir(parents=True, exist_ok=True)
    old_path.write_text("{garbage not json", encoding="utf-8")

    mem = Memory(new_path)
    mem.legacy_path = old_path
    mem.load()
    assert mem.size() == 0
    # New path does not exist (no successful save)
    assert not new_path.exists()
