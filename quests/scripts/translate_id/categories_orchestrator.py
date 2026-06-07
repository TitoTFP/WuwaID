"""Translate one category file at a time.

Per-file pipeline:
1. Load `data/categories/<Cat>.json` -> flat `{key: {zh-Hans, en, ja}}`.
2. Skip-resume: keep keys with non-empty `id` in existing output.
3. Group keys by prefix (`key.split('_', 1)[0]` or "NoPrefix").
4. Chunk each prefix-group to <= `max_keys_per_call` (default 50).
5. For each chunk, in order:
   - Memory lookup per key -> cache hit reuses `text_id`, skip LLM.
   - Build category-flavored user prompt (glossary subset + chunk).
   - Call `LlamaClient.translate_lines()`.
   - Parse, detect violations (no speaker), retry 1x with augmented
     prompt on any violation, then flag-and-continue.
   - Memory insert (write-once) with `from_quest=category_name`.
6. Atomic write `data/categories_id/<Cat>.json` with input + `id` per key.
   Sidecar `_errors.json` if any chunks failed.
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
from pathlib import Path
from typing import Any

from .atomic import atomic_write_json
from .client import LlamaClient, LlamaError
from .glossary import terms_for_category_chunk
from .memory import Memory
from .postprocess import detect_violations_for_category, find_missing_terms_for_category
from .progress import ProgressReporter
from .prompt import (
    CATEGORY_SYSTEM_PROMPT,
    THINK_TOKEN,
    build_augmented_system_prompt_for_categories,
    build_user_prompt_for_categories,
)
from .state_iter import chunk_keys, group_category_keys_by_prefix
from .usage import Usage

log = logging.getLogger(__name__)


async def translate_category_file(
    category_path: Path,
    output_dir: Path,
    memory: Memory,
    glossary: dict,
    client: LlamaClient,
    max_keys_per_call: int = 50,
    concurrency: int = 4,
    glossary_categories: dict[str, str] | None = None,
    use_cache: bool = True,
    force: bool = False,
    enable_thinking: bool = True,
    progress: ProgressReporter | None = None,
    model: str = "",
    flush_every: int = 0,
) -> dict:
    """Translate one category file. Returns stats dict.

    Writes `<output_dir>/<category_name>.json` with input keys + `id` field.
    """
    output_dir.mkdir(parents=True, exist_ok=True)
    category_name = category_path.stem
    output_path = output_dir / f"{category_name}.json"
    errors_path = output_dir / "_errors.json"

    # Load input
    try:
        with category_path.open(encoding="utf-8") as f:
            input_data = json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        log.error("Cannot load %s: %s", category_path, e)
        return {"error": str(e)[:300], "keys_translated": 0, "errors": 1}

    # Build sorted key list for deterministic iteration
    sorted_keys = sorted(input_data.keys())
    sorted_entries: list[dict] = []
    for k in sorted_keys:
        v = input_data[k]
        if not isinstance(v, dict):
            continue
        sorted_entries.append({
            "key": k,
            "text_en": v.get("en", ""),
            "text_zh": v.get("zh-Hans", ""),
            "text_ja": v.get("ja", ""),
        })

    # Skip-resume: load existing output, mark already-translated keys
    existing: dict[str, str] = {}
    if not force and output_path.exists():
        try:
            with output_path.open(encoding="utf-8") as f:
                existing_data = json.load(f)
            for k, v in existing_data.items():
                if isinstance(v, dict) and v.get("id"):
                    existing[k] = v["id"]
        except (json.JSONDecodeError, OSError):
            pass

    # Filter out already-translated keys
    todo_entries = [e for e in sorted_entries if e["key"] not in existing]
    if not todo_entries:
        log.info("category %s: all %d keys already translated, skipping", category_name, len(sorted_entries))
        return {
            "keys_translated": 0,
            "keys_from_memory": len(existing),
            "errors": 0,
            "chunks_done": 0,
        }

    # Group by prefix, then chunk each group
    prefix_groups = group_category_keys_by_prefix(todo_entries)
    chunks: list[tuple[str, list[dict]]] = []
    for prefix, group in prefix_groups.items():
        for chunk in chunk_keys(group, max_size=max_keys_per_call):
            chunks.append((prefix, chunk))

    log.info("category %s: %d chunks (%d keys to translate, %d already done)",
             category_name, len(chunks), len(todo_entries), len(existing))

    # Build in-memory output: copy of input with `id` field added
    output_data: dict[str, dict] = {}
    for e in sorted_entries:
        v = input_data[e["key"]]
        if not isinstance(v, dict):
            continue
        out_v = dict(v)
        out_v["id"] = existing.get(e["key"], "")
        output_data[e["key"]] = out_v

    # Load or init errors sidecar
    errors_data: dict[str, dict] = {}
    if errors_path.exists():
        try:
            errors_data = json.loads(errors_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            pass
    cat_errors = errors_data.get(category_name, {})

    stats = {
        "keys_translated": 0,
        "keys_from_memory": 0,
        "errors": 0,
        "chunks_done": 0,
        "violations": 0,
    }

    sem = asyncio.Semaphore(concurrency)

    async def run_one(prefix: str, chunk: list[dict]) -> tuple[list[dict], str | None]:
        async with sem:
            return await _translate_chunk(
                category_name=category_name,
                prefix=prefix,
                chunk=chunk,
                memory=memory,
                glossary=glossary,
                client=client,
                use_cache=use_cache,
                enable_thinking=enable_thinking,
            )

    tasks = [run_one(p, c) for p, c in chunks]
    done_count = 0
    for coro in asyncio.as_completed(tasks):
        chunk_results, chunk_error = await coro
        for result in chunk_results:
            k = result["key"]
            tid = result.get("text_id", "")
            if tid:
                if k not in existing or existing.get(k) != tid:
                    output_data[k]["id"] = tid
                    stats["keys_translated"] += 1
                else:
                    stats["keys_from_memory"] += 1
            if "glossary_violation" in (result.get("flags") or []):
                stats["violations"] += 1
        if chunk_error:
            stats["errors"] += 1
            chunk_key = "|".join(r["key"] for r in chunk_results)
            cat_errors[chunk_key] = {
                "error": chunk_error,
                "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            }
        else:
            chunk_key = "|".join(r["key"] for r in chunk_results)
            cat_errors.pop(chunk_key, None)
        stats["chunks_done"] += 1
        done_count += 1
        if flush_every > 0 and done_count % flush_every == 0:
            atomic_write_json(output_path, output_data)
            if cat_errors:
                errors_data[category_name] = cat_errors
                atomic_write_json(errors_path, errors_data)
            if use_cache:
                memory.save(model=model)

    # Final atomic write
    atomic_write_json(output_path, output_data)
    if cat_errors:
        errors_data[category_name] = cat_errors
        atomic_write_json(errors_path, errors_data)
    elif category_name in errors_data:
        del errors_data[category_name]
        if errors_data:
            atomic_write_json(errors_path, errors_data)
        elif errors_path.exists():
            errors_path.unlink()

    if progress is not None:
        progress.quest_done()  # reuse the same progress hook

    return stats


async def _translate_chunk(
    category_name: str,
    prefix: str,
    chunk: list[dict],
    memory: Memory,
    glossary: dict,
    client: LlamaClient,
    use_cache: bool,
    enable_thinking: bool,
) -> tuple[list[dict], str | None]:
    """Translate one chunk. Returns (results, error_message_or_None)."""
    results: list[dict] = []
    to_translate: list[dict] = []
    for entry in chunk:
        tk = entry["key"]
        if use_cache:
            entry_check = memory.lookup_with_check(
                tk,
                current_text_en=entry.get("text_en", ""),
                current_speaker_en="",
            )
            if entry_check is not None:
                mem_entry, _mismatches = entry_check
                results.append({
                    "key": tk,
                    "text_id": mem_entry["text_id"],
                    "from_memory": True,
                    "flags": [],
                })
                continue
        to_translate.append(entry)

    if not to_translate:
        return results, None

    state_glossary = terms_for_category_chunk(glossary, to_translate)
    user_prompt = build_user_prompt_for_categories(
        glossary_subset=state_glossary,
        glossary_categories=None,
        category=category_name,
        prefix=prefix,
        keys=to_translate,
    )
    expected_keys = [e["key"] for e in to_translate]

    base_system = CATEGORY_SYSTEM_PROMPT + ("\n" + THINK_TOKEN if enable_thinking else "")
    try:
        result = await client.translate_lines(base_system, user_prompt, expected_keys)
    except LlamaError as e:
        log.error("category %s prefix %s: LLM failed: %s", category_name, prefix, e)
        for entry in to_translate:
            results.append({"key": entry["key"], "text_id": "", "from_memory": False, "flags": []})
        return results, str(e)[:300]

    records = []
    for src, llm in zip(to_translate, result.lines):
        records.append({
            "key": src["key"],
            "speaker_en": "",
            "text_en": src.get("text_en", ""),
            "text_id": llm.get("text_id", ""),
        })

    total_usage = result.usage
    missing = find_missing_terms_for_category(records, state_glossary) if state_glossary else []

    if missing:
        log.info("category %s prefix %s: %d glossary violations, retrying", category_name, prefix, len(missing))
        aug_system = build_augmented_system_prompt_for_categories(missing)
        if enable_thinking and THINK_TOKEN not in aug_system:
            aug_system = aug_system + "\n" + THINK_TOKEN
        try:
            retry_result = await client.translate_lines(aug_system, user_prompt, expected_keys)
            total_usage = total_usage + retry_result.usage
            for src, llm in zip(to_translate, retry_result.lines):
                for r in records:
                    if r["key"] == src["key"]:
                        r["text_id"] = llm.get("text_id", "")
                        break
        except LlamaError as e:
            log.warning("category %s prefix %s: retry failed, using first pass: %s", category_name, prefix, e)

    for r in records:
        viols = detect_violations_for_category(r, state_glossary)
        flags = ["glossary_violation"] if viols else []
        results.append({
            "key": r["key"],
            "text_id": r["text_id"],
            "from_memory": False,
            "flags": flags,
        })
        if r["text_id"]:
            memory.insert(
                text_key=r["key"],
                text_id=r["text_id"],
                source_text_en=r["text_en"],
                source_speaker_en="",
                from_quest=category_name,
            )

    return results, None
