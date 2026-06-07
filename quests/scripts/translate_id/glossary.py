"""Glossary loading and lookup utilities."""
from __future__ import annotations

import json
import logging
import re
from pathlib import Path
from typing import Iterable

log = logging.getLogger(__name__)


def load_glossary(path: Path) -> dict[str, dict]:
    """Load glossary JSON. Returns {} on missing or corrupt file.

    Expected format: {term: {zh, category, indonesian_translation}}.

    Missing files log a WARNING so callers can see why enforcement is
    effectively disabled, instead of silently translating without
    glossary coverage.
    """
    if not path.exists():
        log.warning("Glossary file not found at %s; continuing with empty glossary", path)
        return {}
    try:
        with path.open(encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, dict):
            log.warning("Glossary at %s is not a JSON object; continuing with empty glossary", path)
            return {}
        return data
    except (json.JSONDecodeError, OSError) as e:
        log.warning("Glossary at %s is unreadable (%s); continuing with empty glossary", path, e)
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
