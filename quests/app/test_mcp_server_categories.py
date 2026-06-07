"""Tests for the MCP server's category translation tools."""
from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest
import httpx
import respx

from scripts.mcp_server import translate_category_file as mcp_translate_category_file
from scripts.mcp_server import translate_all_categories as mcp_translate_all_categories


@pytest.mark.asyncio
@respx.mock
async def test_mcp_translate_category_file(tmp_path: Path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    (tmp_path / "data" / "categories").mkdir(parents=True)
    (tmp_path / "data" / "categories" / "X.json").write_text(json.dumps({
        "X_001": {"zh-Hans": "一", "en": "one", "ja": "一"},
    }, ensure_ascii=False), encoding="utf-8")
    respx.post("http://testserver/v1/chat/completions").mock(
        return_value=httpx.Response(200, json={
            "choices": [{"message": {"content": json.dumps([{"key": "X_001", "text_id": "satu"}])}}],
            "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15},
        })
    )
    result = await mcp_translate_category_file(
        name="X",
        backend_override={"base_url": "http://testserver"},
    )
    assert result["status"] == "success"
    assert "output_path" in result


@pytest.mark.asyncio
@respx.mock
async def test_mcp_translate_all_categories_sweeps_in_size_order(tmp_path: Path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    cats = tmp_path / "data" / "categories"
    cats.mkdir(parents=True)
    (cats / "Small.json").write_text(json.dumps({"S_001": {"zh-Hans": "小", "en": "small", "ja": "小"}}, ensure_ascii=False), encoding="utf-8")
    (cats / "Big.json").write_text(json.dumps(
        {f"B_{i:03d}": {"zh-Hans": "b", "en": f"b{i}", "ja": "b"} for i in range(50)},
        ensure_ascii=False,
    ), encoding="utf-8")

    call_order: list[str] = []
    def make_response(req):
        body = json.loads(req.content)
        user_msg = body["messages"][1]["content"]
        for name in ("Small", "Big"):
            if f"category: {name}" in user_msg:
                call_order.append(name)
                break
        json_start = user_msg.index("[", user_msg.index("# Input keys"))
        json_end = user_msg.index("]", json_start) + 1
        keys_in = json.loads(user_msg[json_start:json_end])
        return httpx.Response(200, json={
            "choices": [{"message": {"content": json.dumps(
                [{"key": k["key"], "text_id": f"id_{k['key']}"} for k in keys_in]
            )}}],
            "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15},
        })
    with respx.mock() as respx_mock:
        respx_mock.post("http://testserver/v1/chat/completions").mock(side_effect=make_response)
        result = await mcp_translate_all_categories(
            backend_override={"base_url": "http://testserver"},
            limit=2,
        )
    assert result["status"] == "success"
    assert call_order == ["Small", "Big"], f"Expected size-ascending order, got {call_order}"
