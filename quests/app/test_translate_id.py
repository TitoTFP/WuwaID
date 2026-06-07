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


from scripts.translate_id.progress import (
    load_existing_output,
    is_state_complete,
    write_quest_output,
)


def test_load_existing_output_missing_returns_empty(tmp_path: Path) -> None:
    out = load_existing_output(tmp_path / "nope.json")
    assert out == {}


def test_load_existing_output_parses_states(tmp_path: Path) -> None:
    p = tmp_path / "119000000.json"
    p.write_text(json.dumps({
        "quest_id": 119000000,
        "states": {
            "s1": {"lines": [{"line_id": 1, "text_id": "Halo."}]},
            "s2": {"error": "server down"},
        },
    }), encoding="utf-8")
    out = load_existing_output(p)
    assert "s1" in out
    assert "s2" in out
    assert "error" in out["s2"]


def test_is_state_complete_true_when_line_count_matches(tmp_path: Path) -> None:
    state_payload = {"lines": [{"line_id": 1}, {"line_id": 2}, {"line_id": 3}]}
    assert is_state_complete(state_payload, source_line_count=3) is True


def test_is_state_complete_false_when_error(tmp_path: Path) -> None:
    assert is_state_complete({"error": "x"}, source_line_count=0) is False


def test_is_state_complete_false_when_short(tmp_path: Path) -> None:
    assert is_state_complete({"lines": [{"line_id": 1}]}, source_line_count=5) is False


def test_is_state_complete_false_when_no_lines() -> None:
    assert is_state_complete({}, source_line_count=0) is False
    # Even when source has 0 lines, an empty state is "complete" (nothing to do)
    assert is_state_complete({"lines": []}, source_line_count=0) is True


import httpx
import pytest
import respx

from scripts.translate_id.client import LlamaClient


@pytest.mark.asyncio
@respx.mock
async def test_translate_state_happy_path() -> None:
    respx.post("http://localhost:8080/v1/chat/completions").mock(
        return_value=httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "message": {
                            "content": json.dumps([
                                {"line_id": 1, "speaker_id": "Rover", "text_id": "Halo."},
                                {"line_id": 2, "speaker_id": "Chixia", "text_id": "Dekat."},
                            ])
                        }
                    }
                ]
            },
        )
    )
    async with LlamaClient(base_url="http://localhost:8080") as c:
        result = await c.translate_state(
            system_prompt="You are a translator.",
            user_prompt="Translate these.",
            expected_ids=[1, 2],
        )
    assert result[0]["text_id"] == "Halo."
    assert result[1]["text_id"] == "Dekat."


@pytest.mark.asyncio
@respx.mock
async def test_translate_state_retries_on_5xx() -> None:
    route = respx.post("http://localhost:8080/v1/chat/completions").mock(
        side_effect=[
            httpx.Response(503, text="server busy"),
            httpx.Response(503, text="server busy"),
            httpx.Response(200, json={"choices": [{"message": {"content": json.dumps([
                {"line_id": 1, "speaker_id": "Rover", "text_id": "Halo."}
            ])}}]}),
        ]
    )
    async with LlamaClient(base_url="http://localhost:8080", max_retries=3) as c:
        result = await c.translate_state("sys", "user", [1])
    assert result[0]["text_id"] == "Halo."
    assert route.call_count == 3


@pytest.mark.asyncio
@respx.mock
async def test_translate_state_raises_after_max_5xx() -> None:
    respx.post("http://localhost:8080/v1/chat/completions").mock(
        return_value=httpx.Response(503, text="down")
    )
    async with LlamaClient(base_url="http://localhost:8080", max_retries=3) as c:
        with pytest.raises(Exception):  # LlamaError
            await c.translate_state("sys", "user", [1])


@pytest.mark.asyncio
@respx.mock
async def test_translate_state_retries_on_invalid_json() -> None:
    route = respx.post("http://localhost:8080/v1/chat/completions").mock(
        side_effect=[
            httpx.Response(200, json={"choices": [{"message": {"content": "not json"}}]}),
            httpx.Response(200, json={"choices": [{"message": {"content": json.dumps([
                {"line_id": 1, "speaker_id": "Rover", "text_id": "Halo."}
            ])}}]}),
        ]
    )
    async with LlamaClient(base_url="http://localhost:8080") as c:
        result = await c.translate_state("sys", "user", [1])
    assert result[0]["text_id"] == "Halo."
    assert route.call_count == 2


@pytest.mark.asyncio
@respx.mock
async def test_translate_state_raises_after_invalid_json_retry() -> None:
    respx.post("http://localhost:8080/v1/chat/completions").mock(
        return_value=httpx.Response(200, json={"choices": [{"message": {"content": "not json"}}]})
    )
    async with LlamaClient(base_url="http://localhost:8080") as c:
        with pytest.raises(Exception):
            await c.translate_state("sys", "user", [1])


@pytest.mark.asyncio
@respx.mock
async def test_translate_state_line_count_mismatch_retries_then_raises() -> None:
    respx.post("http://localhost:8080/v1/chat/completions").mock(
        return_value=httpx.Response(200, json={"choices": [{"message": {"content": json.dumps([
            {"line_id": 1, "speaker_id": "Rover", "text_id": "Halo."}
        ])}}]})
    )
    async with LlamaClient(base_url="http://localhost:8080") as c:
        with pytest.raises(Exception, match="missing line_id 2"):
            await c.translate_state("sys", "user", [1, 2])


from scripts.translate_id.orchestrator import translate_quest


@pytest.mark.asyncio
@respx.mock
async def test_translate_quest_happy_path(tmp_path: Path) -> None:
    # Build a minimal quest with 1 state, 2 lines
    quest = {
        "quest_id": 119000000,
        "quest_name": "Test Quest",
        "chapter_id": 3,
        "chapter_name": "To the Stars",
        "side": 0,
        "all_lines": [
            {"id": 1, "type": "Talk", "state_key": "s1", "text_key": "k1",
             "speaker_en": "Rover", "text_en": "Hello."},
            {"id": 2, "type": "Talk", "state_key": "s1", "text_key": "k2",
             "speaker_en": "Chixia", "text_en": "Stay close."},
        ],
    }
    q_in = tmp_path / "in"
    q_in.mkdir()
    (q_in / "119000000.json").write_text(json.dumps(quest), encoding="utf-8")
    q_out = tmp_path / "out"

    respx.post("http://localhost:8080/v1/chat/completions").mock(
        return_value=httpx.Response(200, json={"choices": [{"message": {"content": json.dumps([
            {"line_id": 1, "speaker_id": "Rover", "text_id": "Halo."},
            {"line_id": 2, "speaker_id": "Chixia", "text_id": "Dekat."},
        ])}}]})
    )

    memory = Memory(q_out / "_memory.json")
    async with LlamaClient(base_url="http://localhost:8080") as client:
        stats = await translate_quest(
            quest_path=q_in / "119000000.json",
            quest_data=quest,
            output_dir=q_out,
            memory=memory,
            glossary={},
            client=client,
            concurrency=1,
        )
    assert stats["states_done"] == 1
    assert stats["lines_translated"] == 2
    assert stats["errors"] == 0

    # Verify output file
    out_path = q_out / "119000000.json"
    out_data = json.loads(out_path.read_text(encoding="utf-8"))
    assert out_data["quest_id"] == 119000000
    assert "s1" in out_data["states"]
    lines = out_data["states"]["s1"]["lines"]
    assert lines[0]["text_id"] == "Halo."
    assert lines[0]["from_memory"] is False
    assert lines[0]["text_key"] == "k1"


@pytest.mark.asyncio
@respx.mock
async def test_translate_quest_uses_memory_cache(tmp_path: Path) -> None:
    # Pre-populate memory with a cached translation
    memory = Memory(tmp_path / "out" / "_memory.json")
    memory.insert("k1", "Halo (cached).", "Hello.", "Rover", 999)

    quest = {
        "quest_id": 1, "quest_name": "Q", "chapter_id": 1, "chapter_name": "Ch1", "side": 0,
        "all_lines": [
            {"id": 1, "type": "Talk", "state_key": "s1", "text_key": "k1",
             "speaker_en": "Rover", "text_en": "Hello."},
            {"id": 2, "type": "Talk", "state_key": "s1", "text_key": "k2",
             "speaker_en": "Rover", "text_en": "Bye."},
        ],
    }
    q_in = tmp_path / "in"
    q_in.mkdir()
    (q_in / "1.json").write_text(json.dumps(quest), encoding="utf-8")
    q_out = tmp_path / "out"
    q_out.mkdir()

    # Server should only be called ONCE (for the cache-miss line)
    route = respx.post("http://localhost:8080/v1/chat/completions").mock(
        return_value=httpx.Response(200, json={"choices": [{"message": {"content": json.dumps([
            {"line_id": 2, "speaker_id": "Rover", "text_id": "Sampai jumpa."}
        ])}}]})
    )

    async with LlamaClient(base_url="http://localhost:8080") as client:
        stats = await translate_quest(
            quest_path=q_in / "1.json", quest_data=quest,
            output_dir=q_out, memory=memory, glossary={},
            client=client, concurrency=1,
        )

    assert stats["lines_from_memory"] == 1
    assert stats["lines_translated"] == 1
    assert route.call_count == 1  # only the cache-miss line triggered a request

    out = json.loads((q_out / "1.json").read_text(encoding="utf-8"))
    lines = out["states"]["s1"]["lines"]
    line1 = next(l for l in lines if l["id"] == 1)
    line2 = next(l for l in lines if l["id"] == 2)
    assert line1["text_id"] == "Halo (cached)."
    assert line1["from_memory"] is True
    assert line2["text_id"] == "Sampai jumpa."
    assert line2["from_memory"] is False


@pytest.mark.asyncio
@respx.mock
async def test_translate_quest_records_glossary_violation_after_retry(tmp_path: Path) -> None:
    quest = {
        "quest_id": 1, "quest_name": "Q", "chapter_id": 1, "chapter_name": "Ch1", "side": 0,
        "all_lines": [
            {"id": 1, "type": "Talk", "state_key": "s1", "text_key": "k1",
             "speaker_en": "Rover", "text_en": "Rover says hi."},
        ],
    }
    q_in = tmp_path / "in"; q_in.mkdir()
    (q_in / "1.json").write_text(json.dumps(quest), encoding="utf-8")
    q_out = tmp_path / "out"; q_out.mkdir()
    memory = Memory(q_out / "_memory.json")

    # Glossary has "Rover" — must stay in English
    glossary = {"Rover": {"indonesian_translation": "Rover"}}

    route = respx.post("http://localhost:8080/v1/chat/completions").mock(
        side_effect=[
            # First call: bad translation (drops "Rover")
            httpx.Response(200, json={"choices": [{"message": {"content": json.dumps([
                {"line_id": 1, "speaker_id": "Pengembara", "text_id": "Pengembara bilang hai."}
            ])}}]}),
            # Retry: still drops "Rover" (model is stubborn)
            httpx.Response(200, json={"choices": [{"message": {"content": json.dumps([
                {"line_id": 1, "speaker_id": "Pengembara", "text_id": "Pengembara menyapa."}
            ])}}]}),
        ]
    )

    async with LlamaClient(base_url="http://localhost:8080") as client:
        stats = await translate_quest(
            quest_path=q_in / "1.json", quest_data=quest,
            output_dir=q_out, memory=memory, glossary=glossary,
            client=client, concurrency=1,
        )

    assert route.call_count == 2
    out = json.loads((q_out / "1.json").read_text(encoding="utf-8"))
    line = out["states"]["s1"]["lines"][0]
    assert "glossary_violation" in line["flags"]
    # No infinite loop — the run completed (we don't recheck after the second call
    # in the current design; violations are just recorded).


import argparse

from scripts.translate_id import build_arg_parser


def test_build_arg_parser_defaults() -> None:
    p = build_arg_parser()
    ns = p.parse_args([])
    assert ns.qid is None
    assert ns.chapter is None
    assert ns.server == "http://localhost:8080"
    assert ns.concurrency == 4
    assert ns.glossary is None
    assert ns.output_dir is None
    assert ns.temperature == 0.3
    assert ns.max_tokens == 2048
    assert ns.limit is None
    assert ns.state_key is None
    assert ns.no_cache is False
    assert ns.reset_memory is False
    assert ns.force is False
    assert ns.dry_run is False
    assert ns.verbose is False


def test_build_arg_parser_full() -> None:
    p = build_arg_parser()
    ns = p.parse_args([
        "119000000",
        "--chapter", "1",
        "--server", "http://x:1234",
        "--concurrency", "8",
        "--no-cache",
        "--reset-memory",
        "--force",
        "--dry-run",
        "--verbose",
        "--limit", "3",
        "--state-key", "s1",
    ])
    assert ns.qid == "119000000"
    assert ns.chapter == 1
    assert ns.server == "http://x:1234"
    assert ns.concurrency == 8
    assert ns.no_cache is True
    assert ns.reset_memory is True
    assert ns.force is True
    assert ns.dry_run is True
    assert ns.verbose is True
    assert ns.limit == 3
    assert ns.state_key == "s1"


@pytest.mark.asyncio
@respx.mock
async def test_main_dry_run_prints_quest_order(tmp_path: Path, capsys) -> None:
    # Set up quest source dir
    src = tmp_path / "data" / "quests"
    src.mkdir(parents=True)
    for qid in (1, 2):
        (src / f"{qid}.json").write_text(json.dumps({
            "quest_id": qid, "quest_name": f"Q{qid}", "all_lines": [],
        }), encoding="utf-8")
    # Set up chapters.json
    chapters = tmp_path / "data" / "chapters.json"
    chapters.parent.mkdir(parents=True, exist_ok=True)
    chapters.write_text(json.dumps([
        {"id": 1, "name": "Ch1", "quest_count": 1, "line_count": 0},
        {"id": 0, "name": "Side", "quest_count": 1, "line_count": 0},
    ]), encoding="utf-8")

    out = tmp_path / "data" / "quests_id"
    ns = build_arg_parser().parse_args([
        "--all", "--dry-run",
        "--glossary", str(tmp_path / "gloss.json"),
        "--output-dir", str(out),
    ])

    # Patch REPO_ROOT-relative paths via a small refactor in main (see Step 6)
    from scripts.translate_id import _cli as main_mod
    rc = await main_mod.run(ns, repo_root=tmp_path)
    assert rc == 0
    captured = capsys.readouterr().out
    # main story first, then side
    assert "1" in captured  # quest 1 (ch 1) printed


def test_end_to_end_with_sample_quest(tmp_path: Path, sample_quest: dict) -> None:
    """Smoke test: take the existing sample_quest fixture, write it to disk,
    mock the LLM, run translate_quest, verify output structure + memory."""
    import asyncio

    q_in = tmp_path / "in"
    q_in.mkdir()
    qid = sample_quest["quest_id"]
    (q_in / f"{qid}.json").write_text(json.dumps(sample_quest), encoding="utf-8")
    q_out = tmp_path / "out"; q_out.mkdir()

    # Mock one LLM response per state
    with respx.mock:
        # 3 states, but the fixture's all_lines has 3 lines in 3 different states
        respx.post("http://localhost:8080/v1/chat/completions").mock(
            return_value=httpx.Response(200, json={
                "choices": [{"message": {"content": json.dumps([
                    {"line_id": lid, "speaker_id": "Speaker", "text_id": f"Translated {lid}"}
                    for lid in [1, 2, 3]
                ])}}]
            })
        )
        memory = Memory(q_out / "_memory.json")
        async def go():
            async with LlamaClient(base_url="http://localhost:8080") as c:
                return await translate_quest(
                    quest_path=q_in / f"{qid}.json",
                    quest_data=sample_quest,
                    output_dir=q_out,
                    memory=memory, glossary={}, client=c, concurrency=1,
                )
        stats = asyncio.run(go())
    assert stats["errors"] == 0
    # All 3 states translated (no skip — fresh output dir)
    assert stats["states_done"] == 3
    out = json.loads((q_out / f"{qid}.json").read_text(encoding="utf-8"))
    states = out["states"]
    assert set(states.keys()) == {"Flow_1_1", "Flow_1_2", "Flow_1_3"}
    # Verify text_key is preserved in the output
    for sk, sp in states.items():
        for line in sp["lines"]:
            assert "text_key" in line
            assert line["text_id"].startswith("Translated ")
