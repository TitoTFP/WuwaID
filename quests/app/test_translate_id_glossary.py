"""Tests for scripts.translate_id.glossary."""
import json
from pathlib import Path
import pytest
from scripts.translate_id import glossary


@pytest.fixture
def glossary_file(tmp_path: Path) -> Path:
    """Write a small glossary to a temp file."""
    p = tmp_path / "glossary.json"
    p.write_text(json.dumps({
        "entries": [
            {"en": "Rover", "id": "Rover", "keep_in_english": True},
            {"en": "Jinzhou", "id": "Jinzhou", "keep_in_english": True},
            {"en": "Echo", "id": "Echo", "keep_in_english": True},
            {"en": "Resonator", "id": "Resonator", "keep_in_english": True},
        ]
    }))
    return p


def test_load_returns_dict(glossary_file):
    g = glossary.load(glossary_file)
    assert isinstance(g, dict)
    assert "rover" in g
    assert g["rover"] == "Rover"  # keep-in-english: id == en


def test_load_normalizes_text_by_lowercasing_keys(glossary_file):
    g = glossary.load(glossary_file)
    assert "rover" in g  # lowercased key
    assert "ROVER" not in g  # only lowercased key stored; callers lowercase lookups


def test_load_preserves_id_value_distinct_from_en():
    """When id != en, the value should be the id (e.g., custom translation)."""
    p = Path("/tmp/test_glossary_custom.json")
    p.write_text(json.dumps({
        "entries": [
            {"en": "Hello", "id": "Halo", "keep_in_english": False},
        ]
    }))
    g = glossary.load(p)
    assert g["hello"] == "Halo"
    p.unlink()


def test_load_missing_file_raises(tmp_path):
    with pytest.raises(FileNotFoundError):
        glossary.load(tmp_path / "nope.json")


def test_load_missing_entries_key_raises(tmp_path):
    p = tmp_path / "bad.json"
    p.write_text(json.dumps({"wrong": []}))
    with pytest.raises(KeyError):
        glossary.load(p)


def test_subset_returns_only_matching_terms(glossary_file):
    g = glossary.load(glossary_file)
    state_lines = [
        {"text_en": "Rover, did you see that Echo?"},
        {"text_en": "Yes, in Jinzhou."},
    ]
    sub = glossary.subset(g, state_lines)
    assert "rover" in sub
    assert "echo" in sub
    assert "jinzhou" in sub
    assert "resonator" not in sub  # not in lines


def test_subset_case_insensitive(glossary_file):
    g = glossary.load(glossary_file)
    state_lines = [
        {"text_en": "ROVER appeared."},
    ]
    sub = glossary.subset(g, state_lines)
    assert "rover" in sub


def test_subset_empty_when_no_overlap(glossary_file):
    g = glossary.load(glossary_file)
    state_lines = [
        {"text_en": "Some random text with nothing."},
    ]
    sub = glossary.subset(g, state_lines)
    assert sub == {}


def test_subset_includes_speaker_en(glossary_file):
    """speaker_en is also a source of terms."""
    g = glossary.load(glossary_file)
    state_lines = [
        {"text_en": "Hi", "speaker_en": "Rover"},
    ]
    sub = glossary.subset(g, state_lines)
    assert "rover" in sub
