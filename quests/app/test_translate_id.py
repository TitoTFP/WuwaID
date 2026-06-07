import json
from pathlib import Path
import pytest

from scripts.translate_id.glossary import load_glossary, terms_for_state


def test_load_glossary_parses_valid_json(tmp_path: Path) -> None:
    p = tmp_path / "glossary.json"
    p.write_text(
        json.dumps({
            "Rover": {"zh": "漂泊者", "category": "Character", "indonesian_translation": "Rover"},
            "Jinzhou": {"zh": "今州", "category": "Location", "indonesian_translation": "Jinzhou"},
        }),
        encoding="utf-8",
    )
    g = load_glossary(p)
    assert g["Rover"]["category"] == "Character"
    assert g["Jinzhou"]["zh"] == "今州"


def test_load_glossary_missing_file_returns_empty(tmp_path: Path) -> None:
    g = load_glossary(tmp_path / "nope.json")
    assert g == {}


def test_load_glossary_corrupt_file_returns_empty(tmp_path: Path) -> None:
    p = tmp_path / "bad.json"
    p.write_text("not json {{{", encoding="utf-8")
    g = load_glossary(p)
    assert g == {}


def test_terms_for_state_finds_overlapping_terms() -> None:
    glossary = {
        "Rover": {},
        "Jinzhou": {},
        "Echo": {},
        "NotInState": {},
    }
    lines = [
        {"speaker_en": "Rover", "text_en": "Hello!", "options": []},
        {"speaker_en": "Yangyang", "text_en": "Welcome to Jinzhou, the city of Echoes.", "options": []},
    ]
    result = terms_for_state(glossary, lines)
    assert set(result) == {"Rover", "Jinzhou", "Echo"}


def test_terms_for_state_case_insensitive() -> None:
    glossary = {"rover": {}, "JINZHOU": {}}
    lines = [{"speaker_en": "Rover", "text_en": "go to jinzhou", "options": []}]
    result = terms_for_state(glossary, lines)
    assert "rover" in result
    assert "JINZHOU" in result


def test_terms_for_state_word_boundary() -> None:
    """Substring matches (e.g. 'Echo' inside 'Echoes') should still match."""
    glossary = {"Echo": {}}
    lines = [{"speaker_en": "Narrator", "text_en": "The Echoes resonate.", "options": []}]
    result = terms_for_state(glossary, lines)
    # \b matches at letter/non-letter boundary, so 'Echo' inside 'Echoes' matches.
    assert "Echo" in result


def test_terms_for_state_includes_options() -> None:
    glossary = {"Yes": {}}
    lines = [
        {
            "speaker_en": "Rover",
            "text_en": "What do you say?",
            "options": [{"text_en": "Yes"}, {"text_en": "No"}],
        }
    ]
    result = terms_for_state(glossary, lines)
    assert "Yes" in result


def test_terms_for_state_empty_glossary() -> None:
    assert terms_for_state({}, [{"speaker_en": "Rover", "text_en": "Hi", "options": []}]) == []
