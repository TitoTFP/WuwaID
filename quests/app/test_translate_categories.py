"""Tests for the categories translation pipeline."""
from __future__ import annotations

from scripts.translate_id.glossary import terms_for_category_chunk


def test_terms_for_category_chunk_picks_terms_in_text_en():
    glossary = {
        "Rover": {"zh": "", "category": "Character", "indonesian_translation": "Rover"},
        "Jinzhou": {"zh": "", "category": "Location", "indonesian_translation": "Jinzhou"},
    }
    keys = [
        {"text_en": "Welcome to Jinzhou, Rover!", "text_zh": ""},
        {"text_en": "The city is vast.", "text_zh": ""},
    ]
    out = terms_for_category_chunk(glossary, keys)
    assert "Rover" in out
    assert "Jinzhou" in out
    assert len(out) == 2


def test_terms_for_category_chunk_picks_term_via_text_zh():
    """An English term present in the chunk's text_zh (literal substring) is matched.

    This tests the haystack composition (text_en + text_zh), NOT Chinese-alias
    matching. Alias-matching via the glossary's `zh` field is intentionally out
    of scope (mirrors `terms_for_state`, which has the same limitation).
    """
    glossary = {
        "Jinzhou": {"zh": "今州", "category": "Location", "indonesian_translation": "Jinzhou"},
    }
    keys = [{"text_en": "Some EN", "text_zh": "Welcome to Jinzhou"}]
    out = terms_for_category_chunk(glossary, keys)
    assert "Jinzhou" in out


def test_terms_for_category_chunk_empty_chunk():
    glossary = {"Rover": {"zh": "", "category": "Character", "indonesian_translation": "Rover"}}
    keys = []
    out = terms_for_category_chunk(glossary, keys)
    assert out == []


def test_terms_for_category_chunk_no_matches():
    glossary = {"Rover": {"zh": "", "category": "Character", "indonesian_translation": "Rover"}}
    keys = [{"text_en": "Hello world", "text_zh": "你好世界"}]
    out = terms_for_category_chunk(glossary, keys)
    assert out == []


from scripts.translate_id.postprocess import (
    detect_violations_for_category,
    find_missing_terms_for_category,
)


def test_detect_violations_for_category_text_en_vs_text_id():
    record = {"text_en": "Glacio damage", "text_id": "Kerusakan es"}
    state_glossary = ["Glacio"]
    viols = detect_violations_for_category(record, state_glossary)
    assert viols == ["Glacio"]


def test_detect_violations_for_category_no_violation_when_term_preserved():
    record = {"text_en": "Glacio damage", "text_id": "Kerusakan Glacio"}
    state_glossary = ["Glacio"]
    viols = detect_violations_for_category(record, state_glossary)
    assert viols == []


def test_detect_violations_for_category_term_not_in_source():
    """Term not in source EN -> no violation, even if missing from ID."""
    record = {"text_en": "Some other text", "text_id": "Teks lain"}
    state_glossary = ["Glacio"]
    viols = detect_violations_for_category(record, state_glossary)
    assert viols == []


def test_detect_violations_for_category_empty_glossary():
    record = {"text_en": "Anything", "text_id": "Apapun"}
    viols = detect_violations_for_category(record, [])
    assert viols == []


def test_find_missing_terms_for_category_aggregates_unique():
    records = [
        {"text_en": "Glacio damage", "text_id": "Kerusakan es"},
        {"text_en": "Spectro burst", "text_id": "Ledakan Spektrum"},
    ]
    out = find_missing_terms_for_category(records, ["Glacio", "Spectro"])
    assert set(out) == {"Glacio", "Spectro"}


def test_find_missing_terms_for_category_empty():
    records = [{"text_en": "Hi", "text_id": "Hai"}]
    out = find_missing_terms_for_category(records, ["Glacio"])
    assert out == []
