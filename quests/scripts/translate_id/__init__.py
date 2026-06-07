"""Translate Wuthering Waves quest dialogue to Indonesian via llama-server."""
from __future__ import annotations

import argparse
from pathlib import Path

from scripts.translate_id._cli import main, run

__all__ = ["build_arg_parser", "main", "run"]


def build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="translate_id",
        description="Machine-translate Wuthering Waves quest dialogue to Indonesian.",
    )
    p.add_argument("qid", nargs="?", default=None,
                   help="Translate one quest (skips chapter sweep).")
    p.add_argument("--chapter", type=int, default=None,
                   help="Translate all quests in chapter N (still orders by `order`).")
    p.add_argument("--all", dest="all", action="store_true", default=True,
                   help="(default) Sweep all quests in chapter-priority order.")
    p.add_argument("--server", default="http://localhost:8080",
                   help="llama-server URL (default http://localhost:8080).")
    p.add_argument("--model", default="",
                   help="Model name (default: server default).")
    p.add_argument("--concurrency", type=int, default=4,
                   help="Parallel requests (default 4).")
    p.add_argument("--glossary", type=Path, default=None,
                   help="Glossary JSON (default data/glossary.json).")
    p.add_argument("--output-dir", type=Path, default=None,
                   help="Output directory (default data/quests_id).")
    p.add_argument("--temperature", type=float, default=0.3)
    p.add_argument("--max-tokens", type=int, default=2048)
    p.add_argument("--limit", type=int, default=None,
                   help="Translate only first N states (testing).")
    p.add_argument("--state-key", default=None,
                   help="Translate only one state within the quest (testing).")
    p.add_argument("--no-cache", action="store_true",
                   help="Bypass translation-memory cache; force LLM for every line.")
    p.add_argument("--reset-memory", action="store_true",
                   help="Wipe data/quests_id/_memory.json before starting.")
    p.add_argument("--force", action="store_true",
                   help="Re-translate even if output already exists.")
    p.add_argument("--dry-run", action="store_true",
                   help="Print plan, no LLM calls.")
    p.add_argument("--verbose", action="store_true",
                   help="Per-state timing + retry info.")
    return p
