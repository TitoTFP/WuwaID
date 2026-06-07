"""Load glossary and compute per-state subset for prompt inclusion."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def load(path: Path) -> dict[str, str]:
    """Load glossary from `data/glossary.json`.

    Returns dict mapping normalized source term (lowercased) → Indonesian value
    (or English source if `keep_in_english` is True).
    """
    data: dict[str, Any] = json.loads(path.read_text(encoding="utf-8"))
    if "entries" not in data:
        raise KeyError("glossary file must contain 'entries' key")

    out: dict[str, str] = {}
    for entry in data["entries"]:
        en = entry["en"]
        if entry.get("keep_in_english", False):
            value = en
        else:
            value = entry["id"]
        out[en.lower()] = value
    return out


def subset(glossary: dict[str, str], state_lines: list[dict[str, str]]) -> dict[str, str]:
    """Return only the glossary entries whose source term appears in `state_lines`.

    Matches against `text_en` and `speaker_en`. Match is case-insensitive
    (glossary keys are already lowercased by `load`).
    """
    haystack_parts: list[str] = []
    for line in state_lines:
        haystack_parts.append(line.get("text_en", ""))
        haystack_parts.append(line.get("speaker_en", ""))
    haystack = " ".join(haystack_parts).lower()

    return {k: v for k, v in glossary.items() if k in haystack}
