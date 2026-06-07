"""CLI entry point logic for translate_id.

Lives inside the package (not as `scripts/translate_id.py`) because Python's
import system would shadow this file with the `scripts/translate_id/` package.
The thin `scripts/translate_id.py` shim imports and calls `main()` from here.
"""
from __future__ import annotations

import json
import logging
import sys
import time
from pathlib import Path

from scripts.translate_id.client import LlamaClient
from scripts.translate_id.glossary import load_glossary
from scripts.translate_id.memory import Memory
from scripts.translate_id.orchestrator import translate_quest
from scripts.translate_id.progress import ProgressReporter
from scripts.translate_id.slot_detect import detect_n_parallel
from scripts.translate_id.state_iter import order_quests_by_chapter


def _setup_logging(verbose: bool) -> None:
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )


def _collect_quests(
    repo_root: Path,
    qid: str | None,
    chapter: int | None,
) -> list[Path]:
    """Return quest JSON paths to translate, in chapter-priority order.

    If `qid` is given, returns just that one path. Otherwise walks
    `data/quests/` and orders by chapter.
    """
    quests_dir = repo_root / "data" / "quests"
    if qid is not None:
        p = quests_dir / f"{qid}.json"
        if not p.exists():
            raise FileNotFoundError(f"Quest {qid} not found at {p}")
        return [p]

    paths = sorted(quests_dir.glob("*.json"))
    quests = []
    for p in paths:
        try:
            with p.open(encoding="utf-8") as f:
                q = json.load(f)
        except (json.JSONDecodeError, OSError):
            continue
        if chapter is not None and int(q.get("chapter_id", 0)) != chapter:
            continue
        q["_path"] = str(p)
        quests.append(q)
    quests = order_quests_by_chapter(quests)
    return [Path(q["_path"]) for q in quests]


async def run(ns, repo_root: Path) -> int:
    """Run the CLI. Returns process exit code."""
    _setup_logging(ns.verbose)
    log = logging.getLogger("translate_id")
    glossary_path = ns.glossary or repo_root / "data" / "glossary.json"
    output_dir = ns.output_dir or repo_root / "data" / "quests_id"
    memory_path = repo_root / "data" / "_translation_memory.json"

    if ns.reset_memory and memory_path.exists():
        log.info("Wiping memory file %s", memory_path)
        memory_path.unlink()

    glossary = load_glossary(glossary_path)
    log.info("Loaded %d glossary terms from %s", len(glossary), glossary_path)

    memory = Memory(memory_path)
    memory.legacy_path = output_dir / "_memory.json"
    memory.load()
    log.info("Memory: %d entries (path=%s)", memory.size(), memory_path)

    # Collect quest paths
    try:
        quest_paths = _collect_quests(repo_root, ns.qid, ns.chapter)
    except FileNotFoundError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 2
    log.info("Quests to process: %d", len(quest_paths))

    if ns.dry_run:
        for p in quest_paths:
            print(f"DRY-RUN: would translate {p.name}")
        return 0

    # Build glossary category lookup for prompt display
    glossary_categories = {t: meta.get("category", "") for t, meta in glossary.items()}

    import os
    server_url = ns.server or os.environ.get("MTL_BASE_URL", "http://localhost:8080")

    # Resolve top_k: if cloud API is used and top_k is 64 (parser default), omit it unless passed explicitly
    resolved_top_k = ns.top_k
    api_key_env = os.environ.get("MTL_API_KEY") or os.environ.get("OPENAI_API_KEY") or os.environ.get("OPENROUTER_API_KEY")
    is_cloud = bool(getattr(ns, "api_key", None) or api_key_env)
    if is_cloud and ns.top_k == 64:
        import sys
        if "--top-k" not in sys.argv:
            resolved_top_k = None

    # Resolve --np "auto" → query llama-server /slots
    if isinstance(ns.np, str) and ns.np.lower() == "auto":
        concurrency = await detect_n_parallel(server_url, default=4)
    else:
        try:
            concurrency = int(ns.np)
        except (TypeError, ValueError):
            log.warning("Invalid --np value %r; falling back to 4", ns.np)
            concurrency = 4
    log.info(
        "Concurrency=%d (server=%s, model=%r, temperature=%.2f, top_p=%.2f, top_k=%s, "
        "max_tokens=%d, timeout=%.0fs, enable_thinking=%s)",
        concurrency, server_url, ns.model or "(default)",
        ns.temperature, ns.top_p, str(resolved_top_k), ns.max_tokens, ns.timeout, ns.enable_thinking,
    )

    extra_headers = None
    if getattr(ns, "headers", None):
        try:
            extra_headers = json.loads(ns.headers)
        except Exception as e:
            log.warning("Failed to parse --headers JSON (%s); ignoring headers", e)

    start = time.time()
    total_lines = 0
    total_from_mem = 0
    total_errors = 0

    progress = ProgressReporter(total_quests=len(quest_paths), enabled=not ns.no_progress)
    try:
        async with LlamaClient(
            base_url=server_url, model=ns.model,
            api_key=getattr(ns, "api_key", None),
            timeout=ns.timeout,
            temperature=ns.temperature, max_tokens=ns.max_tokens,
            top_p=ns.top_p, top_k=resolved_top_k,
            headers=extra_headers,
        ) as client:
            for p in quest_paths:
                try:
                    with p.open(encoding="utf-8") as f:
                        quest_data = json.load(f)
                except (json.JSONDecodeError, OSError) as e:
                    log.error("Cannot load %s: %s", p, e)
                    continue

                # Apply --limit / --state-key filters
                if ns.state_key:
                    quest_data["all_lines"] = [
                        l for l in (quest_data.get("all_lines") or [])
                        if l.get("state_key") == ns.state_key
                    ]
                if ns.limit is not None:
                    # Group by state, keep first N states
                    from scripts.translate_id.state_iter import group_lines_by_state
                    by_state = group_lines_by_state(quest_data.get("all_lines") or [])
                    kept = []
                    for i, (sk, ls) in enumerate(by_state.items()):
                        if i >= ns.limit:
                            break
                        kept.extend(ls)
                    quest_data["all_lines"] = kept

                stats = await translate_quest(
                    quest_path=p, quest_data=quest_data,
                    output_dir=output_dir, memory=memory, glossary=glossary,
                    client=client, concurrency=concurrency,
                    glossary_categories=glossary_categories,
                    use_cache=not ns.no_cache,
                    force=ns.force,
                    enable_thinking=ns.enable_thinking,
                    progress=progress,
                    flush_every=ns.flush_every,
                    model=ns.model,
                )
                total_lines += stats["lines_translated"] + stats["lines_from_memory"]
                total_from_mem += stats["lines_from_memory"]
                total_errors += stats["errors"]
                log.info(
                    "qid %s: %d/%d states done, %d lines translated (%d from memory), %d errors, %d violations",
                    quest_data.get("quest_id"),
                    stats["states_done"],
                    stats["states_done"] + stats["states_skipped"],
                    stats["lines_translated"] + stats["lines_from_memory"],
                    stats["lines_from_memory"],
                    stats["errors"],
                    stats["violations"],
                )

                # Flush memory after each quest (unless --no-cache)
                if not ns.no_cache:
                    memory.save(model=ns.model)
    finally:
        progress.close()

    elapsed = time.time() - start
    summary = progress.summary()
    tu = summary["total_usage"]
    log.info(
        "DONE: %d quests, %d lines (%d from memory), %d errors, %.1f sec (%.2f sec/line)",
        len(quest_paths), total_lines, total_from_mem, total_errors,
        elapsed, elapsed / max(total_lines, 1),
    )
    log.info(
        "Tokens: %d prompt + %d completion (%d reasoning) = %d total | "
        "states: %d done (%d from memory)",
        tu.prompt_tokens, tu.completion_tokens, tu.reasoning_tokens, tu.total_tokens,
        summary["states_done"], summary["states_from_memory"],
    )
    if summary["max_state_usage"] is not None:
        mu = summary["max_state_usage"]
        log.info(
            "Max state: %s — %d prompt + %d completion (%d reasoning) = %d total",
            summary["max_state_ref"],
            mu.prompt_tokens, mu.completion_tokens, mu.reasoning_tokens, mu.total_tokens,
        )
    return 0


async def run_categories(ns, repo_root: Path) -> int:
    """Run the CLI in categories mode. Returns process exit code."""
    from scripts.translate_id.categories_orchestrator import translate_category_file

    glossary_path = ns.glossary or repo_root / "data" / "glossary.json"
    output_dir = ns.output_dir or repo_root / "data" / "categories_id"
    memory_path = getattr(ns, "memory", None) or repo_root / "data" / "_translation_memory.json"

    if ns.reset_memory and memory_path.exists():
        logging.getLogger("translate_id").info("Wiping memory file %s", memory_path)
        memory_path.unlink()

    glossary = load_glossary(glossary_path)
    log = logging.getLogger("translate_id")
    log.info("Loaded %d glossary terms from %s", len(glossary), glossary_path)

    memory = Memory(memory_path)
    memory.legacy_path = repo_root / "data" / "quests_id" / "_memory.json"
    memory.load()
    log.info("Memory: %d entries (path=%s)", memory.size(), memory_path)

    categories_dir = repo_root / "data" / "categories"
    if not categories_dir.is_dir():
        log.error("Categories directory not found: %s", categories_dir)
        return 2

    if ns.category:
        cat_files = [categories_dir / f"{ns.category}.json"]
    else:
        cat_files = sorted(
            categories_dir.glob("*.json"),
            key=lambda p: p.stat().st_size,
        )
        if ns.limit is not None:
            cat_files = cat_files[: ns.limit]

    log.info("Categories to process: %d (max_keys_per_call=%d)", len(cat_files), ns.max_keys_per_call)

    if ns.dry_run:
        for p in cat_files:
            print(f"DRY-RUN: would translate {p.name} (size={p.stat().st_size} bytes)")
        return 0

    if isinstance(ns.np, str) and ns.np.lower() == "auto":
        concurrency = await detect_n_parallel(ns.server, default=4)
    else:
        try:
            concurrency = int(ns.np)
        except (TypeError, ValueError):
            concurrency = 4

    extra_headers = None
    if getattr(ns, "headers", None):
        try:
            extra_headers = json.loads(ns.headers)
        except Exception as e:
            log.warning("Failed to parse --headers JSON (%s); ignoring headers", e)

    glossary_categories = {t: meta.get("category", "") for t, meta in glossary.items()}

    start = time.time()
    total_keys = 0
    total_errors = 0

    async with LlamaClient(
        base_url=ns.server, model=ns.model,
        api_key=getattr(ns, "api_key", None),
        timeout=ns.timeout,
        temperature=ns.temperature, max_tokens=ns.max_tokens,
        top_p=ns.top_p, top_k=ns.top_k,
        headers=extra_headers,
    ) as client:
        for cat_path in cat_files:
            try:
                stats = await translate_category_file(
                    category_path=cat_path,
                    output_dir=output_dir,
                    memory=memory,
                    glossary=glossary,
                    client=client,
                    max_keys_per_call=ns.max_keys_per_call,
                    concurrency=concurrency,
                    glossary_categories=glossary_categories,
                    use_cache=not ns.no_cache,
                    force=ns.force,
                    enable_thinking=ns.enable_thinking,
                    model=ns.model or "",
                    flush_every=ns.flush_every,
                )
                total_keys += stats.get("keys_translated", 0) + stats.get("keys_from_memory", 0)
                total_errors += stats.get("errors", 0)
                log.info(
                    "category %s: %d keys (%d translated, %d from cache), %d errors",
                    cat_path.stem,
                    stats.get("keys_translated", 0) + stats.get("keys_from_memory", 0),
                    stats.get("keys_translated", 0),
                    stats.get("keys_from_memory", 0),
                    stats.get("errors", 0),
                )
            except Exception as e:
                log.error("Failed to process %s: %s", cat_path, e)
                total_errors += 1
                continue

            if not ns.no_cache:
                memory.save(model=ns.model or "")

    elapsed = time.time() - start
    log.info(
        "DONE: %d categories, %d keys, %d errors, %.1f sec",
        len(cat_files), total_keys, total_errors, elapsed,
    )
    return 0


def main(repo_root: Path | None = None) -> int:
    """Entry point: parse argv, dispatch to async `run`."""
    from scripts.translate_id import build_arg_parser
    import asyncio

    ns = build_arg_parser().parse_args()
    if repo_root is None:
        repo_root = Path(__file__).resolve().parents[2]
    if ns.mode == "categories":
        return asyncio.run(run_categories(ns, repo_root))
    if ns.mode == "all":
        rc1 = asyncio.run(run(ns, repo_root))
        rc2 = asyncio.run(run_categories(ns, repo_root))
        return rc1 or rc2
    return asyncio.run(run(ns, repo_root))
