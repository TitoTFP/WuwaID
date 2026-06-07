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


def is_term_in_text(term: str, text: str) -> bool:
    """Check if a glossary term is present in text using word boundary matching.

    If the term starts or ends with a word character (alphanumeric/underscore),
    word boundary checks (\b) are applied at those respective ends.

    Capitalized terms (containing any uppercase characters) are matched
    case-sensitively to avoid matching lowercase homonyms (e.g. character name
    "Will" vs. lowercase verb "will").
    """
    pattern = re.escape(term)
    if term and (term[0].isalnum() or term[0] == '_'):
        pattern = r'\b' + pattern
    if term and (term[-1].isalnum() or term[-1] == '_'):
        pattern = pattern + r'\b'
    has_upper = any(c.isupper() for c in term)
    flags = 0 if has_upper else re.IGNORECASE
    return bool(re.search(pattern, text, flags))



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
    haystack = " ".join(haystack_parts)

    hits: list[str] = []
    for term in glossary:
        if is_term_in_text(term, haystack):
            hits.append(term)
    return hits


def terms_for_category_chunk(
    glossary: dict[str, dict],
    keys: list[dict],
) -> list[str]:
    """Return glossary terms that appear in any text_en/text_zh of the chunk.

    Same word-boundary rules as `terms_for_state` (case-insensitive for
    non-capitalized terms, case-sensitive for capitalized ones). Naturally
    bounded by chunk content -- no cap. Matches the term KEY (English) only;
    does NOT match against the glossary entry's `zh` alias.
    """
    haystack = " ".join(
        (k.get("text_en", "") or "") + " " + (k.get("text_zh", "") or "")
        for k in keys
    )
    hits: list[str] = []
    for term in glossary:
        if is_term_in_text(term, haystack):
            hits.append(term)
    return hits

