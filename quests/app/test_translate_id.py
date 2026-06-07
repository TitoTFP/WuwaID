import json
from pathlib import Path
import pytest

from scripts.translate_id.glossary import load_glossary, terms_for_state
from scripts.translate_id.state_iter import group_lines_by_state, order_quests_by_chapter
from scripts.translate_id.atomic import atomic_write_json
from scripts.translate_id.prompt import (
    build_system_prompt,
    build_user_prompt,
    build_augmented_system_prompt,
    parse_translation_response,
)
from scripts.translate_id.postprocess import detect_violations, find_missing_terms


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


def test_build_system_prompt_contains_key_rules() -> None:
    s = build_system_prompt()
    assert "Indonesian" in s
    assert "Wuthering Waves" in s
    assert "glossary" in s.lower() or "Glossary" in s
    assert "JSON" in s
    assert "PhoneMessage" in s  # tone hint rule
    assert "{PlayerName}" in s or "markup" in s.lower()  # token rule


def test_build_system_prompt_is_static() -> None:
    """No params — same every call. Glossary lives in the user prompt."""
    assert build_system_prompt() == build_system_prompt()


def test_build_user_prompt_includes_glossary_and_state() -> None:
    prompt = build_user_prompt(
        glossary_subset=["Rover", "Jinzhou"],
        glossary_categories={"Rover": "Character", "Jinzhou": "Location"},
        state_context={
            "quest_id": 119000000, "quest_name": "Beneath",
            "chapter_id": 3, "chapter_name": "To the Stars",
            "flow_name": "剧情_3_3_拉海洛主线_下半",
            "state_key": "剧情_3_3_拉海洛主线_下半_1_1",
            "plot_mode": "LevelC",
        },
        lines=[
            {"id": 1, "type": "Talk", "speaker_en": "Rover", "text_en": "Hello."},
            {"id": 2, "type": "Option", "speaker_en": "", "text_en": "Yes."},
        ],
    )
    assert "# Glossary" in prompt
    assert "- Rover (Character)" in prompt
    assert "- Jinzhou (Location)" in prompt
    assert "剧情_3_3_拉海洛主线_下半_1_1" in prompt
    assert "LevelC" in prompt
    # Input lines JSON
    assert '"line_id": 1' in prompt
    assert '"text_en": "Hello."' in prompt
    # Output format guidance
    assert "speaker_id" in prompt
    assert "text_id" in prompt


def test_build_user_prompt_empty_glossary_marker() -> None:
    prompt = build_user_prompt(
        glossary_subset=[],
        glossary_categories=None,
        state_context={"quest_id": 1, "quest_name": "Q", "state_key": "s", "plot_mode": "Normal"},
        lines=[],
    )
    assert "(no glossary terms needed" in prompt


def test_build_user_prompt_preserves_input_order() -> None:
    lines = [
        {"id": 5, "type": "Talk", "speaker_en": "A", "text_en": "first"},
        {"id": 3, "type": "Talk", "speaker_en": "B", "text_en": "second"},
    ]
    prompt = build_user_prompt(
        glossary_subset=[], glossary_categories=None,
        state_context={"state_key": "s", "plot_mode": "Normal"},
        lines=lines,
    )
    # First occurrence in the prompt of "first" should come before "second"
    assert prompt.index("first") < prompt.index("second")


def test_build_augmented_system_prompt_includes_missing_terms() -> None:
    aug = build_augmented_system_prompt(["Rover", "Echo"])
    # base prompt preserved
    assert "Indonesian" in aug
    # injection present
    assert "Mandatory terms" in aug
    assert "- Rover" in aug
    assert "- Echo" in aug


def test_parse_translation_response_happy_path() -> None:
    raw = json.dumps([
        {"line_id": 1, "speaker_id": "Rover", "text_id": "Halo."},
        {"line_id": 2, "speaker_id": "Chixia", "text_id": "Dekat."},
    ])
    result = parse_translation_response(raw, expected_ids=[1, 2])
    assert result[0]["text_id"] == "Halo."
    assert result[1]["text_id"] == "Dekat."


def test_parse_translation_response_reorders_to_expected_ids() -> None:
    raw = json.dumps([
        {"line_id": 2, "speaker_id": "X", "text_id": "B"},
        {"line_id": 1, "speaker_id": "X", "text_id": "A"},
    ])
    result = parse_translation_response(raw, expected_ids=[1, 2])
    assert result[0]["text_id"] == "A"
    assert result[1]["text_id"] == "B"


def test_parse_translation_response_strips_markdown_fences() -> None:
    raw = "```json\n[{\"line_id\": 1, \"speaker_id\": \"Rover\", \"text_id\": \"Halo.\"}]\n```"
    result = parse_translation_response(raw, expected_ids=[1])
    assert result[0]["text_id"] == "Halo."


def test_parse_translation_response_invalid_json_raises() -> None:
    with pytest.raises(ValueError, match="not valid JSON"):
        parse_translation_response("not json", expected_ids=[1])


def test_parse_translation_response_missing_line_id_raises() -> None:
    raw = json.dumps([{"line_id": 1, "text_id": "A"}])
    with pytest.raises(ValueError, match="missing line_id 2"):
        parse_translation_response(raw, expected_ids=[1, 2])


def test_parse_translation_response_not_array_raises() -> None:
    raw = json.dumps({"line_id": 1, "text_id": "A"})
    with pytest.raises(ValueError, match="not a JSON array"):
        parse_translation_response(raw, expected_ids=[1])


def test_detect_violations_no_violation() -> None:
    line = {
        "speaker_en": "Rover",
        "text_en": "Hello, Jinhsi!",
        "speaker_id": "Rover",
        "text_id": "Halo, Jinhsi!",
    }
    assert detect_violations(line, ["Rover", "Jinhsi"]) == []


def test_detect_violations_term_dropped_in_text() -> None:
    """If 'Rover' was in EN text but missing in ID text, it's a violation."""
    line = {
        "speaker_en": "Yangyang",
        "text_en": "Rover! Are you okay?",
        "speaker_id": "Yangyang",
        "text_id": "Pengembara! Apakah kamu baik-baik saja?",
    }
    violations = detect_violations(line, ["Rover", "Jinhsi"])
    assert "Rover" in violations
    assert "Jinhsi" not in violations  # not in EN source → not checked


def test_detect_violations_case_insensitive() -> None:
    line = {
        "speaker_en": "Rover",
        "text_en": "rover here",
        "speaker_id": "Rover",
        "text_id": "rOver here",
    }
    assert detect_violations(line, ["Rover"]) == []


def test_detect_violations_empty_glossary() -> None:
    line = {"speaker_en": "X", "text_en": "X", "speaker_id": "X", "text_id": "Y"}
    assert detect_violations(line, []) == []


def test_find_missing_terms_collects_unique() -> None:
    lines = [
        {"speaker_en": "X", "text_en": "Rover Echo Rover", "speaker_id": "X", "text_id": "Pengembara Gema"},
        {"speaker_en": "X", "text_en": "Echo", "speaker_id": "X", "text_id": "Gema"},
    ]
    missing = find_missing_terms(lines, ["Rover", "Echo", "Jinhsi"])
    assert set(missing) == {"Rover", "Echo"}


def test_find_missing_terms_empty() -> None:
    assert find_missing_terms([], ["Rover"]) == []


from scripts.translate_id.memory import Memory


def test_memory_starts_empty(tmp_path: Path) -> None:
    m = Memory(tmp_path / "_memory.json")
    assert m.size() == 0
    assert m.lookup("any_key") is None


def test_memory_insert_and_lookup(tmp_path: Path) -> None:
    m = Memory(tmp_path / "_memory.json")
    m.insert(
        text_key="t1",
        text_id="Halo.",
        source_text_en="Hello.",
        source_speaker_en="Rover",
        from_quest=100,
    )
    entry = m.lookup("t1")
    assert entry is not None
    assert entry["text_id"] == "Halo."
    assert entry["source_text_en"] == "Hello."
    assert entry["source_speaker_en"] == "Rover"
    assert entry["from_quest"] == 100


def test_memory_write_once_no_overwrite(tmp_path: Path) -> None:
    m = Memory(tmp_path / "_memory.json")
    m.insert("t1", "Halo.", "Hello.", "Rover", 100)
    m.insert("t1", "Hai.", "Hello.", "Rover", 200)  # second insertion ignored
    assert m.lookup("t1")["text_id"] == "Halo."


def test_memory_source_mismatch_warning(tmp_path: Path) -> None:
    """If text_en differs from cached, returns the entry but flags mismatch."""
    m = Memory(tmp_path / "_memory.json")
    m.insert("t1", "Halo.", "Hello.", "Rover", 100)
    warn = m.lookup_with_check("t1", current_text_en="Howdy.", current_speaker_en="Rover")
    assert warn is not None
    entry, mismatches = warn
    assert entry["text_id"] == "Halo."
    assert "text_en" in mismatches


def test_memory_lookup_with_check_no_mismatch(tmp_path: Path) -> None:
    m = Memory(tmp_path / "_memory.json")
    m.insert("t1", "Halo.", "Hello.", "Rover", 100)
    warn = m.lookup_with_check("t1", current_text_en="Hello.", current_speaker_en="Rover")
    assert warn is not None
    entry, mismatches = warn
    assert mismatches == []


def test_memory_save_and_reload(tmp_path: Path) -> None:
    p = tmp_path / "_memory.json"
    m1 = Memory(p)
    m1.insert("k1", "Halo.", "Hello.", "Rover", 100)
    m1.insert("k2", "Dekat.", "Stay close.", "Chixia", 200)
    m1.save(model="test-model")

    m2 = Memory(p)
    m2.load()
    assert m2.size() == 2
    assert m2.lookup("k1")["text_id"] == "Halo."
    assert m2.lookup("k2")["text_id"] == "Dekat."
    assert m2.model == "test-model"


def test_memory_load_missing_file_keeps_empty(tmp_path: Path) -> None:
    m = Memory(tmp_path / "nope.json")
    m.load()
    assert m.size() == 0


def test_memory_load_corrupt_file_backs_up_and_starts_empty(tmp_path: Path) -> None:
    p = tmp_path / "_memory.json"
    p.write_text("not json {{{", encoding="utf-8")
    m = Memory(p)
    m.load()
    assert m.size() == 0
    # A backup file was created
    backups = list(tmp_path.glob("_memory.json.corrupt-*"))
    assert len(backups) == 1
    # The original corrupt file is moved aside (no longer at p)
    assert not p.exists()


def test_memory_load_wrong_version_starts_empty(tmp_path: Path) -> None:
    p = tmp_path / "_memory.json"
    p.write_text(json.dumps({"version": 999, "entries": {"k": "v"}}), encoding="utf-8")
    m = Memory(p)
    m.load()
    assert m.size() == 0


def test_memory_load_seeds_from_per_quest_outputs(tmp_path: Path) -> None:
    """When memory.json is missing but per-quest outputs exist, seed from them."""
    output_dir = tmp_path
    quest = {
        "quest_id": 119000000,
        "states": {
            "state_1": {
                "lines": [
                    {"text_key": "k1", "text_id": "Halo."},
                    {"text_key": "k2", "text_id": "Dekat."},
                ]
            }
        },
    }
    (output_dir / "119000000.json").write_text(
        json.dumps(quest), encoding="utf-8"
    )
    memory_path = output_dir / "_memory.json"
    assert not memory_path.exists()  # confirm precondition

    m = Memory(memory_path)
    m.load()
    assert m.size() == 2
    assert m.lookup("k1")["text_id"] == "Halo."
    assert m.lookup("k1")["from_quest"] == 119000000


def test_memory_seed_from_quest_helper(tmp_path: Path) -> None:
    m = Memory(tmp_path / "_memory.json")
    added = m.seed_from_quest({
        "quest_id": 1,
        "states": {
            "s": {
                "lines": [
                    {"text_key": "a", "text_id": "A_id"},
                    {"text_key": "b", "text_id": "B_id"},
                ]
            }
        },
    })
    assert added == 2
    added_again = m.seed_from_quest({
        "quest_id": 2,
        "states": {"s": {"lines": [{"text_key": "a", "text_id": "DIFFERENT"}]}},
    })
    assert added_again == 0
    assert m.lookup("a")["text_id"] == "A_id"  # write-once
