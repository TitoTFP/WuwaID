import json
from pathlib import Path
import pytest

from scripts.translate_id.glossary import load_glossary, terms_for_state
from scripts.translate_id.state_iter import group_lines_by_state, order_quests_by_chapter
from scripts.translate_id.atomic import atomic_write_json


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


def test_group_lines_by_state_preserves_source_order() -> None:
    all_lines = [
        {"id": 1, "state_key": "s1", "text_en": "A"},
        {"id": 2, "state_key": "s2", "text_en": "B"},
        {"id": 3, "state_key": "s1", "text_en": "C"},
        {"id": 4, "state_key": "s1", "text_en": "D"},
    ]
    by_state = group_lines_by_state(all_lines)
    assert list(by_state.keys()) == ["s1", "s2"]
    assert [l["id"] for l in by_state["s1"]] == [1, 3, 4]
    assert [l["id"] for l in by_state["s2"]] == [2]


def test_group_lines_by_state_skips_lines_with_no_state_key() -> None:
    all_lines = [
        {"id": 1, "state_key": "s1", "text_en": "A"},
        {"id": 2, "text_en": "no state"},  # no state_key
    ]
    by_state = group_lines_by_state(all_lines)
    assert list(by_state.keys()) == ["s1"]
    assert [l["id"] for l in by_state["s1"]] == [1]


def test_group_lines_by_state_empty() -> None:
    assert group_lines_by_state([]) == {}


def test_group_lines_by_state_iterates_states_in_source_order() -> None:
    """State order should follow first appearance in all_lines."""
    all_lines = [
        {"id": 1, "state_key": "state_b", "text_en": "x"},
        {"id": 2, "state_key": "state_a", "text_en": "y"},
        {"id": 3, "state_key": "state_b", "text_en": "z"},
    ]
    by_state = group_lines_by_state(all_lines)
    assert list(by_state.keys()) == ["state_b", "state_a"]


def test_order_quests_by_chapter_main_first_then_side() -> None:
    quests = [
        {"quest_id": 100, "chapter_id": 0, "order": 1},   # side
        {"quest_id": 1,   "chapter_id": 1, "order": 5},   # ch 1
        {"quest_id": 2,   "chapter_id": 2, "order": 1},   # ch 2
        {"quest_id": 3,   "chapter_id": 1, "order": 2},   # ch 1
        {"quest_id": 200, "chapter_id": 0, "order": 2},   # side
    ]
    ordered = order_quests_by_chapter(quests)
    assert [q["quest_id"] for q in ordered] == [3, 1, 2, 100, 200]


def test_order_quests_by_chapter_missing_order_sorts_last() -> None:
    quests = [
        {"quest_id": 1, "chapter_id": 1, "order": None},
        {"quest_id": 2, "chapter_id": 1, "order": 1},
    ]
    ordered = order_quests_by_chapter(quests)
    assert [q["quest_id"] for q in ordered] == [2, 1]


def test_order_quests_by_chapter_empty() -> None:
    assert order_quests_by_chapter([]) == []


def test_atomic_write_json_creates_file(tmp_path: Path) -> None:
    p = tmp_path / "out.json"
    atomic_write_json(p, {"hello": "world"})
    assert json.loads(p.read_text(encoding="utf-8")) == {"hello": "world"}


def test_atomic_write_json_overwrites_existing(tmp_path: Path) -> None:
    p = tmp_path / "out.json"
    atomic_write_json(p, {"v": 1})
    atomic_write_json(p, {"v": 2})
    assert json.loads(p.read_text(encoding="utf-8")) == {"v": 2}


def test_atomic_write_json_unicode_safe(tmp_path: Path) -> None:
    p = tmp_path / "out.json"
    atomic_write_json(p, {"text": "Halo, Jinhsi! 你好"})
    raw = p.read_text(encoding="utf-8")
    assert "Halo, Jinhsi! 你好" in raw
    # ensure_ascii=False is the contract
    assert "\\u" not in raw


def test_atomic_write_json_no_tmp_left_behind(tmp_path: Path) -> None:
    p = tmp_path / "out.json"
    atomic_write_json(p, {"a": 1})
    assert not (tmp_path / "out.json.tmp").exists()


def test_atomic_write_json_nested_dirs(tmp_path: Path) -> None:
    p = tmp_path / "deep" / "nested" / "out.json"
    atomic_write_json(p, {"a": 1})
    assert p.exists()
