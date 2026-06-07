#!/usr/bin/env python3
"""Model Context Protocol (MCP) server for MTL LLM.

Exposes tools for translating quest dialogue to Indonesian and managing the translation glossary.
"""
from __future__ import annotations

import sys
from pathlib import Path

# Add repository root to path so we can import internal scripts
_REPO_ROOT = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

import json
import os
import logging
from fastmcp import FastMCP

# Setup basic logging to stderr so it doesn't pollute stdout (which is used for stdio transport JSON-RPC)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    stream=sys.stderr
)
log = logging.getLogger("mcp_server")

# Initialize the FastMCP server
mcp = FastMCP("WuwaID Translation Server")


@mcp.tool()
async def translate_dialogue(
    lines: list[dict],
    quest_context: dict | None = None,
    use_cache: bool = True,
    enable_thinking: bool = True,
    backend_override: dict | None = None,
) -> dict:
    """Translate a list of English dialogue lines to Indonesian.

    Applies local glossary matching, cache lookups, and glossary retry logic.

    Args:
        lines: List of lines. Each line must be a dict with keys:
               - 'id' (int or str, required)
               - 'speaker_en' (str, required)
               - 'text_en' (str, required)
               - 'text_key' (str, optional, used for caching)
        quest_context: Optional context dict about the quest, containing:
               - 'quest_id' (int or str)
               - 'quest_name' (str)
               - 'chapter_id' (int)
               - 'chapter_name' (str)
               - 'plot_mode' (str)
        use_cache: If True, look up and store translation in memory cache (default: True)
        enable_thinking: If True, enable thinking mode for Gemma 2.5 (default: True)
        backend_override: Optional settings to override LLM backend:
               - 'base_url' (str)
               - 'api_key' (str)
               - 'model' (str)
               - 'headers' (dict of extra headers, optional)
    """
    from scripts.translate_id.client import LlamaClient
    from scripts.translate_id.glossary import load_glossary
    from scripts.translate_id.memory import Memory
    from scripts.translate_id.orchestrator import _translate_state

    log.info("Received request to translate %d lines", len(lines))

    glossary_path = _REPO_ROOT / "data" / "glossary.json"
    output_dir = _REPO_ROOT / "data" / "quests_id"
    memory_path = _REPO_ROOT / "data" / "_translation_memory.json"

    # Ensure output directory exists
    output_dir.mkdir(parents=True, exist_ok=True)

    # Load glossary and memory
    glossary = load_glossary(glossary_path)
    glossary_categories = {t: meta.get("category", "") for t, meta in glossary.items()}
    memory = Memory(memory_path)
    memory.legacy_path = output_dir / "_memory.json"
    memory.load()

    # Build context
    ctx = quest_context or {}
    quest_data = {
        "quest_id": ctx.get("quest_id", 0),
        "quest_name": ctx.get("quest_name", "custom_mcp_quest"),
        "chapter_id": ctx.get("chapter_id", 0),
        "chapter_name": ctx.get("chapter_name", ""),
        "flows": [
            {
                "flow_name": "mcp_flow",
                "states": [
                    {
                        "state_key": ctx.get("state_key", "mcp_state"),
                        "plot_mode": ctx.get("plot_mode", "Dialogue"),
                    }
                ]
            }
        ]
    }
    state_key = ctx.get("state_key", "mcp_state")

    # Instantiate LLM client
    bo = backend_override or {}
    base_url = bo.get("base_url") or os.environ.get("MTL_BASE_URL")
    model = bo.get("model") or os.environ.get("MTL_MODEL")
    api_key = bo.get("api_key") or os.environ.get("MTL_API_KEY") or os.environ.get("OPENAI_API_KEY") or os.environ.get("OPENROUTER_API_KEY")
    headers = bo.get("headers")

    async with LlamaClient(
        base_url=base_url,
        model=model,
        api_key=api_key,
        headers=headers,
    ) as client:
        result = await _translate_state(
            quest_data=quest_data,
            state_key=state_key,
            lines=lines,
            glossary=glossary,
            glossary_categories=glossary_categories,
            memory=memory,
            client=client,
            use_cache=use_cache,
            enable_thinking=enable_thinking,
        )

        if use_cache and "error" not in result:
            memory.save(model=client.model)

        return result


@mcp.tool()
async def translate_quest(
    qid: str,
    chapter: int | None = None,
    limit: int | None = None,
    state_key: str | None = None,
    force: bool = False,
    no_cache: bool = False,
    backend_override: dict | None = None,
) -> dict:
    """Batch-translate a quest by its ID and save the result in the output directory.

    Args:
        qid: The quest ID (e.g. '10101') corresponding to data/quests/<qid>.json
        chapter: Optional chapter ID filter
        limit: Limit translation to first N states (for testing)
        state_key: Limit translation to this specific state key (for testing)
        force: If True, re-translate even if output file already exists (default: False)
        no_cache: If True, bypass memory cache (default: False)
        backend_override: Optional settings to override LLM backend:
               - 'base_url' (str)
               - 'api_key' (str)
               - 'model' (str)
               - 'headers' (dict of extra headers, optional)
    """
    from scripts.translate_id._cli import run as cli_run

    log.info("Received request to batch translate quest qid=%s", qid)

    glossary_path = _REPO_ROOT / "data" / "glossary.json"
    output_dir = _REPO_ROOT / "data" / "quests_id"

    # Build a namespace object mimicking argparse namespace
    class Namespace:
        def __init__(self, **kwargs):
            for k, v in kwargs.items():
                setattr(self, k, v)

    bo = backend_override or {}
    base_url = bo.get("base_url") or os.environ.get("MTL_BASE_URL")
    model = bo.get("model") or os.environ.get("MTL_MODEL")
    api_key = bo.get("api_key") or os.environ.get("MTL_API_KEY") or os.environ.get("OPENAI_API_KEY") or os.environ.get("OPENROUTER_API_KEY")
    headers = bo.get("headers")
    
    # If headers are passed as a dict, we serialize it to JSON string as the CLI expects it
    headers_str = json.dumps(headers) if isinstance(headers, dict) else headers

    ns = Namespace(
        qid=qid,
        chapter=chapter,
        all=(qid is None and chapter is None),
        server=base_url,
        api_key=api_key,
        headers=headers_str,
        model=model,
        np="auto",
        glossary=glossary_path,
        output_dir=output_dir,
        temperature=1.0,
        max_tokens=32768,
        top_p=0.95,
        top_k=None,
        timeout=300.0,
        enable_thinking=True,
        state_key=state_key,
        limit=limit,
        no_cache=no_cache,
        no_progress=True,  # Suppress progress bar in daemon/server environment
        reset_memory=False,
        force=force,
        dry_run=False,
        verbose=True,
        flush_every=0,
    )

    exit_code = await cli_run(ns, _REPO_ROOT)
    return {
        "exit_code": exit_code,
        "status": "success" if exit_code == 0 else "error",
        "output_path": str(output_dir / f"{qid}.json"),
    }


@mcp.tool()
def get_glossary(query: str | None = None) -> dict:
    """Retrieve loaded glossary entries.

    Args:
        query: Optional search term to filter glossary keys (case-insensitive substring match).
    """
    from scripts.translate_id.glossary import load_glossary
    
    log.info("Received glossary fetch query=%s", query)
    glossary_path = _REPO_ROOT / "data" / "glossary.json"
    glossary = load_glossary(glossary_path)
    
    if not query:
        return glossary
        
    query_lower = query.lower()
    return {
        k: v for k, v in glossary.items()
        if query_lower in k.lower() or query_lower in (v.get("indonesian_translation") or "").lower()
    }


@mcp.tool()
def add_glossary_term(
    term: str,
    indonesian_translation: str,
    category: str = "Speaker/NPC",
    zh: str = "",
) -> dict:
    """Add or update a translation term in the glossary JSON file.

    Args:
        term: The English term (key) to add or update.
        indonesian_translation: The Indonesian translation for this term.
        category: The category of the term, e.g., 'Speaker/NPC', 'Term/Item' (default: 'Speaker/NPC')
        zh: Optional Chinese translation / version.
    """
    log.info("Adding glossary term English='%s', Indonesian='%s'", term, indonesian_translation)
    glossary_path = _REPO_ROOT / "data" / "glossary.json"

    # Load existing glossary
    if glossary_path.exists():
        try:
            with glossary_path.open("r", encoding="utf-8") as f:
                glossary = json.load(f)
        except Exception as e:
            log.warning("Could not read glossary file: %s; starting fresh", e)
            glossary = {}
    else:
        glossary = {}

    # Update or add term
    glossary[term] = {
        "zh": zh,
        "category": category,
        "indonesian_translation": indonesian_translation,
    }

    # Save sorted pretty JSON
    try:
        glossary_path.parent.mkdir(parents=True, exist_ok=True)
        # Sort glossary keys alphabetically
        sorted_glossary = {k: glossary[k] for k in sorted(glossary.keys())}
        with glossary_path.open("w", encoding="utf-8") as f:
            json.dump(sorted_glossary, f, ensure_ascii=False, indent=2)
        return {
            "status": "success",
            "message": f"Term '{term}' successfully added/updated in the glossary.",
        }
    except Exception as e:
        log.error("Failed to write glossary: %s", e)
        return {
            "status": "error",
            "message": f"Failed to save glossary file: {e}",
        }


if __name__ == "__main__":
    mcp.run()
