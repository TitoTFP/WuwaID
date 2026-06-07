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
    import os
    p.add_argument("--server", default=os.environ.get("MTL_BASE_URL", "http://localhost:8080"),
                   help="llama-server or cloud API URL (default: http://localhost:8080 or MTL_BASE_URL).")
    p.add_argument("--api-key", default=None,
                   help="API key for LLM provider (default: MTL_API_KEY/OPENAI_API_KEY/OPENROUTER_API_KEY).")
    p.add_argument("--headers", default=None,
                   help="Extra request headers in JSON format (e.g. '{\"HTTP-Referer\": \"...\"}').")
    p.add_argument("--model", default=None,
                   help="Model name (default: server default or MTL_MODEL).")
    p.add_argument("--np", default="auto",
                   help="Parallel requests: 'auto' (query server /slots), or integer. (default auto)")
    p.add_argument("--glossary", type=Path, default=None,
                   help="Glossary JSON (default data/glossary.json).")
    p.add_argument("--output-dir", type=Path, default=None,
                   help="Output directory (default data/quests_id).")
    p.add_argument("--temperature", type=float, default=1.0,
                   help="Sampling temperature (default 1.0, matches Gemma 4 model card).")
    p.add_argument("--max-tokens", type=int, default=32768,
                   help="Max response tokens (default 32768, matches the 32K context window).")
    p.add_argument("--top-p", type=float, default=0.95,
                   help="Nucleus sampling top_p (default 0.95, matches model card).")
    p.add_argument("--top-k", type=int, default=64,
                   help="Top-k sampling (default: 64, set to None for cloud APIs).")
    p.add_argument("--timeout", type=float, default=300.0,
                   help="HTTP request timeout in seconds (default 300s).")
    p.add_argument("--enable-thinking", dest="enable_thinking",
                   action=argparse.BooleanOptionalAction, default=True,
                   help="Enable Gemma 4 thinking mode via <|think|> token (default ON).")
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
    p.add_argument("--no-progress", dest="no_progress", action="store_true",
                   help="Disable the tqdm progress bar (default: bar shown).")
    p.add_argument("--flush-every", type=int, default=0,
                   help="Flush <qid>.json + _memory.json after every N states "
                        "in a quest (default 0 = flush once at end of quest).")
    return p
