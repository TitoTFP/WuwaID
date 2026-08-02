"""Tests for the /api/editor/export route."""
from __future__ import annotations

from unittest.mock import patch
import pytest
from fastapi.testclient import TestClient

from app.main import app

@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("EDITOR_PASSWORD", "s3cr3t")
    monkeypatch.setenv("SESSION_SECRET", "test-secret-1234567890")
    
    # Mock index.db schemas and path to prevent actual db initialization failures
    import sqlite3
    db_path = tmp_path / "index.db"
    con = sqlite3.connect(db_path)
    con.executescript("""
        CREATE TABLE editor_session (token TEXT PRIMARY KEY,
            created_at TEXT NOT NULL, expires_at TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'editor');
    """)
    con.commit()
    con.close()
    
    from app import db
    db.set_db_path(db_path)
    
    yield TestClient(app)
    db.set_db_path(None)

def _login(client) -> None:
    r = client.post("/api/login", json={"password": "s3cr3t"})
    assert r.status_code == 200

def test_export_requires_editor(client):
    # Anonymous request should return 401/403 depending on auth middleware
    r = client.post("/api/editor/export")
    assert r.status_code in (401, 403)

def test_export_succeeds_for_editor(client):
    _login(client)
    with patch("app.export.export_indonesian_translations") as mock_export:
        r = client.post("/api/editor/export")
        assert r.status_code == 200
        assert r.json()["ok"] is True
        assert "files" in r.json()
        mock_export.assert_called_once()


def test_full_english_export_succeeds_for_editor(client):
    _login(client)
    with patch("app.export.export_english_translations") as mock_export:
        mock_export.return_value = ["lang_multi_text.db", "lang_multi_text_1sthalf.db"]
        r = client.post("/api/editor/export", json={"export_mode": "english_full"})
        assert r.status_code == 200
        assert r.json() == {"ok": True, "files": ["lang_multi_text.db", "lang_multi_text_1sthalf.db"]}
        mock_export.assert_called_once()

def test_selective_export_succeeds_for_editor(client):
    _login(client)
    with patch("app.export.export_selective_translations") as mock_export:
        mock_export.return_value = ["test_quest.db"]
        r = client.post("/api/editor/export", json={"quest_ids": [123]})
        assert r.status_code == 200
        assert r.json() == {"ok": True, "files": ["test_quest.db"]}
        mock_export.assert_called_once()


def test_import_directory_merges_files_once_and_summarizes(client, tmp_path):
    _login(client)
    import_dir = tmp_path / "imports"
    import_dir.mkdir()
    for idx in range(12):
        (import_dir / f"batch_{idx:02d}.db").write_bytes(b"placeholder")

    context = object()

    with (
        patch("app.import_translations.build_import_context", return_value=context) as mock_context,
        patch("app.import_translations.load_translations_from_db") as mock_load,
        patch("app.import_translations.import_translation_map") as mock_import,
    ):
        mock_load.side_effect = [
            {f"key_{idx:02d}": f"value_{idx:02d}", "shared": f"value_{idx:02d}"}
            for idx in range(12)
        ]
        mock_import.return_value = {
            "categories_updated": 0,
            "quests_updated": 1,
            "total_keys_imported": 2,
            "skipped_keys": 3,
        }
        r = client.post("/api/editor/import", json={"db_path": str(import_dir)})

    assert r.status_code == 200
    stats = r.json()["stats"]
    assert stats["files_imported"] == 12
    assert stats["duplicate_keys_merged"] == 11
    assert stats["quests_updated"] == 1
    assert stats["total_keys_imported"] == 2
    assert stats["skipped_keys"] == 3
    assert stats["message"].startswith("Imported 12 files:")
    assert "and 2 more" in stats["message"]
    mock_context.assert_called_once()
    assert mock_load.call_count == 12
    mock_import.assert_called_once()
    merged = mock_import.call_args.args[1]
    assert len(merged) == 13
    assert merged["shared"] == "value_11"
    assert mock_import.call_args.kwargs["context"] is context
    assert mock_import.call_args.kwargs["rebuild_index"] is True

def test_export_selective_translations_schema(tmp_path):
    import json
    import sqlite3
    from app.export import export_selective_translations
    
    # Create necessary folders under tmp_path
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    quests_dir = data_dir / "quests"
    quests_dir.mkdir()
    
    # Write a dummy quest file
    quest_data = {
        "quest_id": 12345,
        "quest_name": "My Quest",
        "all_lines": [
            {
                "id": 1,
                "text_key": "key1",
                "speaker_en": "Speaker A",
                "text_en": "Dialogue 1"
            }
        ]
    }
    (quests_dir / "12345.json").write_text(json.dumps(quest_data))
    
    # Mock output_db/en structure
    en_db_dir = tmp_path / "output_db" / "en"
    en_db_dir.mkdir(parents=True)
    # Create empty dummy lang_multi_text.db
    conn = sqlite3.connect(en_db_dir / "lang_multi_text.db")
    conn.execute("CREATE TABLE MultiText (Id TEXT PRIMARY KEY, Content TEXT, RedirectDbIndex INT)")
    conn.execute("INSERT INTO MultiText VALUES ('key1', 'Dialogue 1', 0)")
    conn.commit()
    conn.close()
    
    # Call export_selective_translations
    exported = export_selective_translations(
        repo_root=tmp_path,
        quest_ids=[12345],
        only_untranslated=False
    )
    
    # Assert database created
    db_file = tmp_path / "output_db" / "id" / "My_Quest_12345.db"
    assert db_file.is_file()
    
    # Verify schema
    conn = sqlite3.connect(db_file)
    cur = conn.cursor()
    cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='MultiText'")
    assert cur.fetchone() is not None
    
    # Check table structure has Name column in both modes
    cur.execute("PRAGMA table_info(MultiText)")
    columns = {row[1] for row in cur.fetchall()}
    assert "Id" in columns
    assert "Name" in columns
    assert "Content" in columns
    assert "RedirectDbIndex" not in columns
    
    # Verify values
    cur.execute("SELECT Id, Name, Content FROM MultiText")
    rows = cur.fetchall()
    assert len(rows) == 1
    assert rows[0] == ("key1", "Speaker A", "Dialogue 1")
    conn.close()

def test_export_options_with_empty_parent_text_key(tmp_path):
    import json
    from app.export import gather_quest_translations
    
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    quests_dir = data_dir / "quests"
    quests_dir.mkdir()
    
    # Write a dummy quest file with a line having empty text_key but non-empty options
    quest_data = {
        "quest_id": 9999,
        "quest_name": "Test Option Empty Parent",
        "all_lines": [
            {
                "id": 1,
                "text_key": "",  # empty parent text_key
                "type": "Option",
                "options": [
                    {
                        "text_key": "opt_key_1",
                        "text_en": "Option EN"
                    }
                ]
            }
        ]
    }
    (quests_dir / "9999.json").write_text(json.dumps(quest_data))
    
    # Write matching ID translation
    quests_id_dir = data_dir / "quests_id"
    quests_id_dir.mkdir()
    id_data = {
        "quest_id": 9999,
        "states": {
            "state1": {
                "lines": [
                    {
                        "id": 1,
                        "text_key": "",
                        "options": [
                            {
                                "text_key": "opt_key_1",
                                "text_id": "Option ID Translation"
                            }
                        ]
                    }
                ]
            }
        }
    }
    (quests_id_dir / "9999.json").write_text(json.dumps(id_data))
    
    quest_trans, key_to_speaker = gather_quest_translations(data_dir)
    assert "opt_key_1" in quest_trans
    assert quest_trans["opt_key_1"] == "Option ID Translation"


def test_is_untranslated_fallback_with_asterisks():
    from app.import_translations import is_untranslated_fallback
    # Normal untranslated values
    assert is_untranslated_fallback("", "Some English text") is True
    assert is_untranslated_fallback(None, "Some English text") is True
    # Values consisting entirely of asterisks should be treated as untranslated fallback
    assert is_untranslated_fallback("*****", "Some English text") is True
    assert is_untranslated_fallback(" *******  ", "Some English text") is True
    # Valid translations containing asterisks but also letters/words should not be treated as untranslated
    assert is_untranslated_fallback("Translation with * characters", "Some English text") is False
    assert is_untranslated_fallback("A-aku... *sigh*", "Some English text") is False
    # Values matching English source (length > 2 words) are untranslated fallback
    assert is_untranslated_fallback("Some English text", "Some English text") is True
    # Values matching English source but <= 2 words are valid translations (e.g. names/stuttering)
    assert is_untranslated_fallback("Hello world", "Hello world") is False


def test_selective_export_filters_asterisk_placeholders(tmp_path):
    import json
    import sqlite3
    from app.export import export_selective_translations
    
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    quests_dir = data_dir / "quests"
    quests_dir.mkdir()
    quests_id_dir = data_dir / "quests_id"
    quests_id_dir.mkdir()
    
    # Base quest
    quest_data = {
        "quest_id": 7777,
        "quest_name": "Test Asterisk Export",
        "all_lines": [
            {
                "id": 1,
                "text_key": "key1",
                "speaker_en": "Speaker A",
                "text_en": "English Text 1"
            },
            {
                "id": 2,
                "text_key": "key2",
                "speaker_en": "Speaker B",
                "text_en": "English Text 2"
            }
        ]
    }
    (quests_dir / "7777.json").write_text(json.dumps(quest_data))
    
    # ID quest with:
    # key1 = valid Indonesian translation
    # key2 = asterisk-only placeholder
    id_data = {
        "quest_id": 7777,
        "states": {
            "state1": {
                "lines": [
                    {
                        "id": 1,
                        "text_key": "key1",
                        "text_id": "Teks Indonesia 1"
                    },
                    {
                        "id": 2,
                        "text_key": "key2",
                        "text_id": "**********"
                    }
                ]
            }
        }
    }
    (quests_id_dir / "7777.json").write_text(json.dumps(id_data))
    
    # Mock output_db/en
    en_db_dir = tmp_path / "output_db" / "en"
    en_db_dir.mkdir(parents=True)
    conn = sqlite3.connect(en_db_dir / "lang_multi_text.db")
    conn.execute("CREATE TABLE MultiText (Id TEXT PRIMARY KEY, Content TEXT, RedirectDbIndex INT)")
    conn.execute("INSERT INTO MultiText VALUES ('key1', 'English Text 1', 0)")
    conn.execute("INSERT INTO MultiText VALUES ('key2', 'English Text 2', 0)")
    conn.commit()
    conn.close()
    
    # Export
    exported = export_selective_translations(
        repo_root=tmp_path,
        quest_ids=[7777],
        only_untranslated=False
    )
    
    db_file = tmp_path / "output_db" / "id" / "Test_Asterisk_Export_7777.db"
    assert db_file.is_file()
    
    conn = sqlite3.connect(db_file)
    cur = conn.cursor()
    cur.execute("SELECT Id, Content FROM MultiText ORDER BY Id")
    rows = cur.fetchall()
    conn.close()
    
    assert len(rows) == 2
    # key1 has the valid translation
    assert rows[0] == ("key1", "Teks Indonesia 1")
    # key2 had asterisks in translation JSON, so it must fall back to the English template value
    assert rows[1] == ("key2", "English Text 2")


def test_selective_full_english_export_uses_english_template(tmp_path):
    import json
    import sqlite3
    from app.export import export_selective_translations

    data_dir = tmp_path / "data"
    quests_dir = data_dir / "quests"
    quests_id_dir = data_dir / "quests_id"
    quests_dir.mkdir(parents=True)
    quests_id_dir.mkdir()

    quest_data = {
        "quest_id": 8888,
        "quest_name": "Full Export Test",
        "all_lines": [
            {
                "id": 1,
                "text_key": "key_translated",
                "speaker_en": "Speaker A",
                "text_en": "English translated source",
            },
            {
                "id": 2,
                "text_key": "key_untranslated",
                "speaker_en": "Speaker B",
                "text_en": "English untranslated source",
            },
        ],
    }
    (quests_dir / "8888.json").write_text(json.dumps(quest_data))

    id_data = {
        "quest_id": 8888,
        "states": {
            "state1": {
                "lines": [
                    {
                        "id": 1,
                        "text_key": "key_translated",
                        "text_id": "Sumber Indonesia",
                    },
                ]
            }
        },
    }
    (quests_id_dir / "8888.json").write_text(json.dumps(id_data))

    en_db_dir = tmp_path / "output_db" / "en"
    en_db_dir.mkdir(parents=True)
    conn = sqlite3.connect(en_db_dir / "lang_multi_text.db")
    conn.execute("CREATE TABLE MultiText (Id TEXT PRIMARY KEY, Content TEXT, RedirectDbIndex INT)")
    conn.execute("INSERT INTO MultiText VALUES ('key_translated', 'English translated source', 0)")
    conn.execute("INSERT INTO MultiText VALUES ('key_untranslated', 'English untranslated source', 0)")
    conn.commit()
    conn.close()

    export_selective_translations(
        tmp_path,
        quest_ids=[8888],
        english_full=True,
    )

    db_file = tmp_path / "output_db" / "id" / "Full_Export_Test_8888.db"
    conn = sqlite3.connect(db_file)
    cur = conn.cursor()
    cur.execute("SELECT Id, Content FROM MultiText ORDER BY Id")
    rows = dict(cur.fetchall())
    conn.close()

    assert rows["key_translated"] == "English translated source"
    assert rows["key_untranslated"] == "English untranslated source"
