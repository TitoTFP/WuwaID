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
    memory_path = output_dir / "_memory.json"

    if ns.reset_memory and memory_path.exists():
        log.info("Wiping memory file %s", memory_path)
        memory_path.unlink()

    glossary = load_glossary(glossary_path)
    log.info("Loaded %d glossary terms from %s", len(glossary), glossary_path)

    memory = Memory(memory_path)
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

    # Resolve --np "auto" → query llama-server /slots
    if isinstance(ns.np, str) and ns.np.lower() == "auto":
        concurrency = await detect_n_parallel(ns.server, default=4)
    else:
        try:
            concurrency = int(ns.np)
        except (TypeError, ValueError):
            log.warning("Invalid --np value %r; falling back to 4", ns.np)
            concurrency = 4
    log.info(
        "Concurrency=%d (server=%s, model=%r, temperature=%.2f, top_p=%.2f, top_k=%d, "
        "max_tokens=%d, timeout=%.0fs, enable_thinking=%s)",
        concurrency, ns.server, ns.model or "(default)",
        ns.temperature, ns.top_p, ns.top_k, ns.max_tokens, ns.timeout, ns.enable_thinking,
    )

    start = time.time()
    total_lines = 0
    total_from_mem = 0
    total_errors = 0

    async with LlamaClient(
        base_url=ns.server, model=ns.model,
        timeout=ns.timeout,
        temperature=ns.temperature, max_tokens=ns.max_tokens,
        top_p=ns.top_p, top_k=ns.top_k,
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

    elapsed = time.time() - start
    log.info(
        "DONE: %d quests, %d lines (%d from memory), %d errors, %.1f sec (%.2f sec/line)",
        len(quest_paths), total_lines, total_from_mem, total_errors,
        elapsed, elapsed / max(total_lines, 1),
    )
    return 0


def main(repo_root: Path | None = None) -> int:
    """Entry point: parse argv, dispatch to async `run`."""
    from scripts.translate_id import build_arg_parser
    import asyncio

    ns = build_arg_parser().parse_args()
    if repo_root is None:
        repo_root = Path(__file__).resolve().parents[2]
    return asyncio.run(run(ns, repo_root))
