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


from scripts.translate_id.state_iter import group_category_keys_by_prefix, chunk_keys


def test_group_category_keys_by_prefix_basic():
    keys = [
        {"key": "Item_Sword_001"},
        {"key": "Item_Sword_002"},
        {"key": "Skill_Fireball"},
        {"key": "ItemInfo_Sword_001"},
    ]
    groups = group_category_keys_by_prefix(keys)
    # Ordered: first occurrence wins
    assert list(groups.keys()) == ["Item", "Skill", "ItemInfo"]
    assert [k["key"] for k in groups["Item"]] == ["Item_Sword_001", "Item_Sword_002"]
    assert [k["key"] for k in groups["Skill"]] == ["Skill_Fireball"]
    assert [k["key"] for k in groups["ItemInfo"]] == ["ItemInfo_Sword_001"]


def test_group_category_keys_by_prefix_no_underscore():
    keys = [{"key": "LonelyKey"}, {"key": "Item_X"}]
    groups = group_category_keys_by_prefix(keys)
    assert "NoPrefix" in groups
    assert groups["NoPrefix"][0]["key"] == "LonelyKey"
    assert "Item" in groups


def test_chunk_keys_smaller_than_max():
    keys = [{"key": f"k{i}"} for i in range(5)]
    chunks = list(chunk_keys(keys, max_size=10))
    assert len(chunks) == 1
    assert len(chunks[0]) == 5


def test_chunk_keys_exact_max():
    keys = [{"key": f"k{i}"} for i in range(10)]
    chunks = list(chunk_keys(keys, max_size=10))
    assert len(chunks) == 1
    assert len(chunks[0]) == 10


def test_chunk_keys_larger_than_max():
    keys = [{"key": f"k{i}"} for i in range(25)]
    chunks = list(chunk_keys(keys, max_size=10))
    assert len(chunks) == 3
    assert len(chunks[0]) == 10
    assert len(chunks[1]) == 10
    assert len(chunks[2]) == 5


def test_chunk_keys_empty():
    chunks = list(chunk_keys([], max_size=10))
    assert chunks == []


def test_chunk_keys_invalid_max():
    import pytest
    with pytest.raises(ValueError):
        list(chunk_keys([{"key": "k"}], max_size=0))


import json
from scripts.translate_id.prompt import (
    CATEGORY_SYSTEM_PROMPT,
    build_user_prompt_for_categories,
    build_augmented_system_prompt_for_categories,
    parse_translation_response_for_categories,
)


def test_category_system_prompt_mentions_category():
    assert "category" in CATEGORY_SYSTEM_PROMPT.lower()


def test_build_user_prompt_for_categories_includes_category_and_prefix():
    keys = [
        {"key": "Item_Sword_001_Name", "text_en": "Iron Sword", "text_zh": "铁剑", "text_ja": "鉄剣"},
    ]
    prompt = build_user_prompt_for_categories(
        glossary_subset=["Glacio"],
        glossary_categories={"Glacio": "Core Gameplay Term"},
        category="Item",
        prefix="Item",
        keys=keys,
    )
    assert "Glacio (Core Gameplay Term)" in prompt
    assert "category: Item" in prompt
    assert "prefix group: Item" in prompt
    # Extract JSON from output format section (skip the header suffix)
    output_section = prompt.split("# Output format")[1]
    json_start = output_section.index("[")
    parsed = json.loads(output_section[json_start:])
    assert parsed[0]["key"] == "Item_Sword_001_Name"
    assert "text_id" in parsed[0]


def test_build_user_prompt_for_categories_empty_glossary():
    keys = [{"key": "UI_16:08", "text_en": "16:08", "text_zh": "16:08", "text_ja": "16:08"}]
    prompt = build_user_prompt_for_categories(
        glossary_subset=[],
        glossary_categories={},
        category="UI",
        prefix="UI",
        keys=keys,
    )
    assert "(no glossary terms needed for this chunk)" in prompt


def test_build_augmented_system_prompt_for_categories():
    aug = build_augmented_system_prompt_for_categories(["Glacio", "Spectro"])
    assert "Glacio" in aug
    assert "Spectro" in aug
    assert "do NOT translate" in aug


def test_parse_translation_response_for_categories_happy_path():
    raw = '[{"key": "Item_Sword_001_Name", "text_id": "Pedang Besi"}]'
    result = parse_translation_response_for_categories(raw, expected_keys=["Item_Sword_001_Name"])
    assert result == [{"key": "Item_Sword_001_Name", "text_id": "Pedang Besi"}]


def test_parse_translation_response_for_categories_length_mismatch():
    raw = '[{"key": "Item_Sword_001_Name", "text_id": "Pedang Besi"}]'
    try:
        parse_translation_response_for_categories(raw, expected_keys=["A", "B"])
    except ValueError as e:
        assert "missing key" in str(e).lower() or "expected" in str(e).lower()
    else:
        raise AssertionError("Expected ValueError on length mismatch")


def test_parse_translation_response_for_categories_thinking_mode():
    raw = '<|channel|>analysis\nreasoning<|channel|>\n<|channel|>final\n[{"key": "K", "text_id": "v"}]<|channel|>'
    result = parse_translation_response_for_categories(raw, expected_keys=["K"])
    assert result[0]["text_id"] == "v"


def test_parse_translation_response_for_categories_think_tag_format():
    raw = '<|think|>reasoning<|think|>[{"key": "K", "text_id": "v"}]'
    result = parse_translation_response_for_categories(raw, expected_keys=["K"])
    assert result[0]["text_id"] == "v"
