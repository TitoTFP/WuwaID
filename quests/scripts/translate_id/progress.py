"""Skip-already-translated progress tracking + atomic output write."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .atomic import atomic_write_json


def load_existing_output(path: Path) -> dict[str, Any]:
    """Load existing quest output. Returns {} on missing or corrupt file."""
    if not path.exists():
        return {}
    try:
        with path.open(encoding="utf-8") as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError):
        return {}
    if not isinstance(data, dict):
        return {}
    return data.get("states", {}) or {}


def is_state_complete(state_payload: Any, source_line_count: int) -> bool:
    """True iff the state has a `lines` list matching `source_line_count` and no `error`."""
    if not isinstance(state_payload, dict):
        return False
    if "error" in state_payload:
        return False
    lines = state_payload.get("lines")
    if not isinstance(lines, list):
        return False
    return len(lines) == source_line_count


def write_quest_output(path: Path, payload: dict) -> None:
    """Atomically write the full per-quest output JSON."""
    atomic_write_json(path, payload)
