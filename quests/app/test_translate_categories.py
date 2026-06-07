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


import asyncio
import pytest
import httpx
import respx
from pathlib import Path

from scripts.translate_id.client import LlamaClient, LlamaError
from scripts.translate_id.glossary import load_glossary
from scripts.translate_id.memory import Memory
from scripts.translate_id.categories_orchestrator import translate_category_file


@pytest.mark.asyncio
@respx.mock
async def test_translate_lines_happy_path():
    """Server returns valid JSON; client parses and returns in expected order."""
    respx.post("http://testserver/v1/chat/completions").mock(
        return_value=httpx.Response(
            200,
            json={
                "choices": [{"message": {"content": json.dumps([
                    {"key": "Item_Sword_001_Name", "text_id": "Pedang Besi"},
                    {"key": "Item_Sword_001_Desc", "text_id": "Sebuah pedang dasar."},
                ])}}],
                "usage": {"prompt_tokens": 100, "completion_tokens": 30, "total_tokens": 130},
            },
        )
    )
    async with LlamaClient(base_url="http://testserver") as client:
        result = await client.translate_lines(
            system_prompt="SYSTEM",
            user_prompt="USER",
            expected_keys=["Item_Sword_001_Name", "Item_Sword_001_Desc"],
        )
    assert [r["text_id"] for r in result.lines] == ["Pedang Besi", "Sebuah pedang dasar."]
    assert result.usage.total_tokens == 130


@pytest.mark.asyncio
@respx.mock
async def test_translate_lines_retries_on_invalid_json():
    respx.post("http://testserver/v1/chat/completions").mock(side_effect=[
        httpx.Response(200, json={"choices": [{"message": {"content": "not json"}}], "usage": {}}),
        httpx.Response(200, json={"choices": [{"message": {"content": json.dumps([{"key": "K", "text_id": "v"}])}}], "usage": {}}),
    ])
    async with LlamaClient(base_url="http://testserver", max_retries=2) as client:
        result = await client.translate_lines("S", "U", expected_keys=["K"])
    assert result.lines[0]["text_id"] == "v"


@pytest.mark.asyncio
@respx.mock
async def test_translate_lines_raises_on_length_mismatch_after_retry():
    respx.post("http://testserver/v1/chat/completions").mock(side_effect=[
        httpx.Response(200, json={"choices": [{"message": {"content": json.dumps([{"key": "A", "text_id": "x"}])}}], "usage": {}}),
        httpx.Response(200, json={"choices": [{"message": {"content": json.dumps([{"key": "A", "text_id": "x"}])}}], "usage": {}}),
    ])
    async with LlamaClient(base_url="http://testserver", max_retries=2) as client:
        with pytest.raises(LlamaError):
            await client.translate_lines("S", "U", expected_keys=["A", "B"])


@pytest.mark.asyncio
@respx.mock
async def test_translate_category_file_happy_path(tmp_path: Path):
    """One small category file (5 keys) -> all translated, output schema correct."""
    cat_in = tmp_path / "data" / "categories" / "Advice.json"
    cat_in.parent.mkdir(parents=True, exist_ok=True)
    cat_in.write_text(json.dumps({
        "Adv_001": {"zh-Hans": "建议一", "en": "Tip one", "ja": "アドバイス一"},
        "Adv_002": {"zh-Hans": "建议二", "en": "Tip two", "ja": "アドバイス二"},
        "Adv_003": {"zh-Hans": "建议三", "en": "Tip three", "ja": "アドバイス三"},
        "Adv_004": {"zh-Hans": "建议四", "en": "Tip four", "ja": "アドバイス四"},
        "Adv_005": {"zh-Hans": "建议五", "en": "Tip five", "ja": "アドバイス五"},
    }, ensure_ascii=False), encoding="utf-8")

    out_dir = tmp_path / "data" / "categories_id"
    mem_path = tmp_path / "data" / "_translation_memory.json"
    glossary = load_glossary(tmp_path / "glossary.json")

    respx.post("http://testserver/v1/chat/completions").mock(
        return_value=httpx.Response(200, json={
            "choices": [{"message": {"content": json.dumps([
                {"key": "Adv_001", "text_id": "Tip satu"},
                {"key": "Adv_002", "text_id": "Tip dua"},
                {"key": "Adv_003", "text_id": "Tip tiga"},
                {"key": "Adv_004", "text_id": "Tip empat"},
                {"key": "Adv_005", "text_id": "Tip lima"},
            ])}}],
            "usage": {"prompt_tokens": 50, "completion_tokens": 30, "total_tokens": 80},
        })
    )
    async with LlamaClient(base_url="http://testserver") as client:
        memory = Memory(mem_path)
        stats = await translate_category_file(
            category_path=cat_in,
            output_dir=out_dir,
            memory=memory,
            glossary=glossary,
            client=client,
            max_keys_per_call=50,
            concurrency=1,
        )
    assert stats["keys_translated"] == 5
    assert stats["errors"] == 0
    out = json.loads((out_dir / "Advice.json").read_text(encoding="utf-8"))
    assert out["Adv_001"]["id"] == "Tip satu"
    assert out["Adv_001"]["en"] == "Tip one"
    assert memory.size() == 5


@pytest.mark.asyncio
@respx.mock
async def test_translate_category_file_multi_chunk(tmp_path: Path):
    """File with 7 keys, max=3 -> 3 LLM calls (3 + 3 + 1)."""
    cat_in = tmp_path / "data" / "categories" / "Test.json"
    cat_in.parent.mkdir(parents=True, exist_ok=True)
    keys_data = {f"Test_{i:03d}": {"zh-Hans": f"z{i}", "en": f"e{i}", "ja": f"j{i}"} for i in range(7)}
    cat_in.write_text(json.dumps(keys_data, ensure_ascii=False), encoding="utf-8")

    out_dir = tmp_path / "data" / "categories_id"
    mem_path = tmp_path / "data" / "_translation_memory.json"
    glossary = load_glossary(tmp_path / "glossary.json")

    call_count = {"n": 0}
    def make_response(req):
        call_count["n"] += 1
        body = json.loads(req.content)
        raw = body["messages"][1]["content"]
        json_start = raw.index("[", raw.index("# Input keys"))
        json_end = raw.index("]", json_start) + 1
        keys_in = json.loads(raw[json_start:json_end])
        return httpx.Response(200, json={
            "choices": [{"message": {"content": json.dumps(
                [{"key": k["key"], "text_id": f"id_{k['key']}"} for k in keys_in]
            )}}],
            "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15},
        })
    respx.post("http://testserver/v1/chat/completions").mock(side_effect=make_response)

    async with LlamaClient(base_url="http://testserver") as client:
        memory = Memory(mem_path)
        stats = await translate_category_file(
            category_path=cat_in,
            output_dir=out_dir,
            memory=memory,
            glossary=glossary,
            client=client,
            max_keys_per_call=3,
            concurrency=1,
        )
    assert stats["keys_translated"] == 7
    assert call_count["n"] == 3


@pytest.mark.asyncio
async def test_translate_category_file_skip_when_fully_translated(tmp_path: Path):
    """If output exists with all keys translated, no LLM calls."""
    cat_in = tmp_path / "data" / "categories" / "Done.json"
    cat_in.parent.mkdir(parents=True, exist_ok=True)
    cat_in.write_text(json.dumps({
        "D_001": {"zh-Hans": "一", "en": "one", "ja": "一"},
        "D_002": {"zh-Hans": "二", "en": "two", "ja": "二"},
    }, ensure_ascii=False), encoding="utf-8")
    out_dir = tmp_path / "data" / "categories_id"
    out_dir.mkdir(parents=True)
    out_dir.joinpath("Done.json").write_text(json.dumps({
        "D_001": {"zh-Hans": "一", "en": "one", "ja": "一", "id": "satu"},
        "D_002": {"zh-Hans": "二", "en": "two", "ja": "二", "id": "dua"},
    }, ensure_ascii=False), encoding="utf-8")

    mem_path = tmp_path / "data" / "_translation_memory.json"
    glossary = load_glossary(tmp_path / "glossary.json")

    with respx.mock(assert_all_called=False) as respx_mock:
        respx_mock.post("http://testserver/v1/chat/completions").mock(return_value=httpx.Response(500))
        async with LlamaClient(base_url="http://testserver") as client:
            memory = Memory(mem_path)
            stats = await translate_category_file(
                category_path=cat_in, output_dir=out_dir, memory=memory,
                glossary=glossary, client=client,
            )
    assert stats["keys_translated"] == 0
    assert stats.get("keys_from_memory", 0) == 2


@pytest.mark.asyncio
@respx.mock
async def test_translate_category_file_cache_hits_skip_llm(tmp_path: Path):
    """Keys already in memory -> LLM is only called for the missing ones."""
    cat_in = tmp_path / "data" / "categories" / "Mixed.json"
    cat_in.parent.mkdir(parents=True, exist_ok=True)
    cat_in.write_text(json.dumps({
        "M_001": {"zh-Hans": "一", "en": "one", "ja": "一"},
        "M_002": {"zh-Hans": "二", "en": "two", "ja": "二"},
        "M_003": {"zh-Hans": "三", "en": "three", "ja": "三"},
    }, ensure_ascii=False), encoding="utf-8")
    out_dir = tmp_path / "data" / "categories_id"
    mem_path = tmp_path / "data" / "_translation_memory.json"
    mem_path.parent.mkdir(parents=True, exist_ok=True)
    glossary = load_glossary(tmp_path / "glossary.json")

    # Pre-populate memory with 2 of 3 keys
    memory = Memory(mem_path)
    memory.insert(text_key="M_001", text_id="satu", source_text_en="one", source_speaker_en="", from_quest="Mixed")
    memory.insert(text_key="M_002", text_id="dua", source_text_en="two", source_speaker_en="", from_quest="Mixed")
    memory.save(model="test")

    call_count = {"n": 0}
    def make_response(req):
        call_count["n"] += 1
        body = json.loads(req.content)
        raw = body["messages"][1]["content"]
        json_start = raw.index("[", raw.index("# Input keys"))
        json_end = raw.index("]", json_start) + 1
        keys_in = json.loads(raw[json_start:json_end])
        return httpx.Response(200, json={
            "choices": [{"message": {"content": json.dumps(
                [{"key": k["key"], "text_id": f"id_{k['key']}"} for k in keys_in]
            )}}],
            "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15},
        })
    with respx.mock(assert_all_called=False) as respx_mock:
        respx_mock.post("http://testserver/v1/chat/completions").mock(side_effect=make_response)
        async with LlamaClient(base_url="http://testserver") as client:
            memory = Memory(mem_path)
            memory.load()
            stats = await translate_category_file(
                category_path=cat_in, output_dir=out_dir, memory=memory,
                glossary=glossary, client=client,
            )
    assert call_count["n"] == 1  # only M_003 missing from cache
    assert stats["keys_translated"] == 3  # 2 from memory + 1 fresh
    out = json.loads((out_dir / "Mixed.json").read_text(encoding="utf-8"))
    assert out["M_001"]["id"] == "satu"
    assert out["M_002"]["id"] == "dua"
    assert out["M_003"]["id"] == "id_M_003"


import argparse
from scripts.translate_id import build_arg_parser


def test_arg_parser_has_mode_flag():
    parser = build_arg_parser()
    args = parser.parse_args(["--mode", "categories"])
    assert args.mode == "categories"


def test_arg_parser_default_mode_is_quests():
    parser = build_arg_parser()
    args = parser.parse_args([])
    assert args.mode == "quests"


def test_arg_parser_accepts_all_mode():
    parser = build_arg_parser()
    args = parser.parse_args(["--mode", "all"])
    assert args.mode == "all"


def test_arg_parser_rejects_invalid_mode():
    parser = build_arg_parser()
    with pytest.raises(SystemExit):
        parser.parse_args(["--mode", "bogus"])


def test_arg_parser_has_max_keys_per_call():
    parser = build_arg_parser()
    args = parser.parse_args(["--mode", "categories", "--max-keys-per-call", "25"])
    assert args.max_keys_per_call == 25


def test_arg_parser_default_max_keys_per_call_is_50():
    parser = build_arg_parser()
    args = parser.parse_args([])
    assert args.max_keys_per_call == 50


@pytest.mark.asyncio
@respx.mock
async def test_run_categories_one_file(tmp_path: Path, monkeypatch):
    """CLI flag --mode categories --category X runs translate_category_file."""
    from scripts.translate_id import _cli
    cat_in = tmp_path / "data" / "categories" / "X.json"
    cat_in.parent.mkdir(parents=True, exist_ok=True)
    cat_in.write_text(json.dumps({
        "X_001": {"zh-Hans": "一", "en": "one", "ja": "一"},
    }, ensure_ascii=False), encoding="utf-8")
    respx.post("http://testserver/v1/chat/completions").mock(
        return_value=httpx.Response(200, json={
            "choices": [{"message": {"content": json.dumps([{"key": "X_001", "text_id": "satu"}])}}],
            "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15},
        })
    )

    class FakeNS:
        mode = "categories"
        category = "X"
        chapter = None
        all = False
        server = "http://testserver"
        api_key = None
        headers = None
        model = None
        np = 1
        glossary = tmp_path / "glossary.json"
        output_dir = tmp_path / "data" / "categories_id"
        memory = tmp_path / "data" / "_translation_memory.json"
        temperature = 1.0
        max_tokens = 4096
        top_p = 0.95
        top_k = None
        timeout = 300.0
        enable_thinking = True
        state_key = None
        limit = None
        no_cache = False
        no_progress = True
        reset_memory = False
        force = False
        dry_run = False
        verbose = False
        flush_every = 0
        max_keys_per_call = 50

    rc = await _cli.run_categories(FakeNS(), tmp_path)
    assert rc == 0
    out = json.loads((tmp_path / "data" / "categories_id" / "X.json").read_text(encoding="utf-8"))
    assert out["X_001"]["id"] == "satu"
