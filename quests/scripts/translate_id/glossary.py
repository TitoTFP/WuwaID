"""Glossary loading and lookup utilities."""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Iterable


def load_glossary(path: Path) -> dict[str, dict]:
    """Load glossary JSON. Returns {} on missing or corrupt file.

    Expected format: {term: {zh, category, indonesian_translation}}.
    """
    if not path.exists():
        return {}
    try:
        with path.open(encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, dict):
            return {}
        return data
    except (json.JSONDecodeError, OSError):
        return {}


def terms_for_state(
    glossary: dict[str, dict],
    lines: Iterable[dict],
) -> list[str]:
    """Return glossary terms that appear in any line of the state.

    Case-insensitive word-boundary match. No cap — naturally bounded by state content.
    """
    haystack_parts: list[str] = []
    for line in lines:
        haystack_parts.append(line.get("speaker_en", "") or "")
        haystack_parts.append(line.get("text_en", "") or "")
        for opt in line.get("options", []) or []:
            haystack_parts.append(opt.get("text_en", "") or "")
    haystack = " ".join(haystack_parts).lower()

    hits: list[str] = []
    for term in glossary:
        needle = term.lower()
        if needle in haystack:
            hits.append(term)
    return hits
