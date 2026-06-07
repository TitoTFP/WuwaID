"""Skip-already-translated progress tracking + atomic output write + live progress reporter."""
from __future__ import annotations

import json
import logging
import time
from pathlib import Path
from typing import Any

from tqdm import tqdm

from .atomic import atomic_write_json
from .usage import Usage

log = logging.getLogger(__name__)


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


class ProgressReporter:
    """Live progress bar + token usage aggregator.

    Two-level tqdm bar (outer = quests, inner = states in current quest).
    `enabled=False` makes every method a no-op (safe for tests and CI logs).

    Aggregates token usage across all states for the final summary, and tracks
    the single state with the highest total_tokens (for "biggest prompt" reporting).
    """

    def __init__(self, total_quests: int, enabled: bool = True) -> None:
        self._enabled = enabled
        self._total_quests = total_quests
        self._quest_bar: tqdm | None = None
        self._state_bar: tqdm | None = None
        self._current_qid: int = 0
        self._current_quest_name: str = ""
        # Aggregate stats (used regardless of enabled state).
        self._quests_done = 0
        self._states_done = 0
        self._states_from_memory = 0
        self._total_usage = Usage()
        self._max_state_usage: Usage | None = None
        self._max_state_ref: str = ""
        self._start_time = time.time()
        self._closed = False
        if enabled:
            self._quest_bar = tqdm(
                total=total_quests,
                desc="Quests",
                unit="quest",
                position=0,
                dynamic_ncols=True,
            )

    def quest_start(self, qid: int, quest_name: str, total_states: int) -> None:
        """Call when starting a new quest. Refreshes the inner state bar."""
        self._current_qid = qid
        self._current_quest_name = quest_name
        if not self._enabled:
            return
        # Close any previous inner bar.
        if self._state_bar is not None:
            self._state_bar.close()
        if self._quest_bar is not None:
            short_name = quest_name[:30] if quest_name else ""
            self._quest_bar.set_postfix_str(f"qid={qid} {short_name}")
        self._state_bar = tqdm(
            total=total_states,
            desc=f"qid={qid} states",
            unit="state",
            position=1,
            leave=False,
            dynamic_ncols=True,
        )

    def state_done(
        self,
        state_key: str,
        usage: Usage,
        *,
        from_memory: bool = False,
        flow_name: str = "",
    ) -> None:
        """Call when a state finishes (either from cache or LLM)."""
        self._states_done += 1
        if from_memory:
            self._states_from_memory += 1
        if not usage.is_zero():
            self._total_usage = self._total_usage + usage
            if (
                self._max_state_usage is None
                or usage.total_tokens > self._max_state_usage.total_tokens
            ):
                self._max_state_usage = usage
                ref = f"qid={self._current_qid}"
                if flow_name:
                    ref += f' flow="{flow_name}"'
                ref += f" state={state_key}"
                self._max_state_ref = ref
        if self._enabled and self._state_bar is not None:
            self._state_bar.update(1)
            # Show postfix with last call's token counts (or "cache" for memory hits).
            if from_memory or usage.is_zero():
                self._state_bar.set_postfix_str("last: cache")
            else:
                self._state_bar.set_postfix_str(
                    f"last: p={usage.prompt_tokens} c={usage.completion_tokens}"
                )

    def quest_done(self) -> None:
        """Call when a quest finishes. Advances the outer bar."""
        self._quests_done += 1
        if not self._enabled:
            return
        if self._state_bar is not None:
            self._state_bar.close()
            self._state_bar = None
        if self._quest_bar is not None:
            self._quest_bar.update(1)
            self._quest_bar.set_postfix_str("")

    def summary(self) -> dict[str, Any]:
        """Return aggregate stats for the final CLI summary log."""
        elapsed = time.time() - self._start_time
        return {
            "quests_done": self._quests_done,
            "states_done": self._states_done,
            "states_from_memory": self._states_from_memory,
            "total_usage": self._total_usage,
            "max_state_usage": self._max_state_usage,
            "max_state_ref": self._max_state_ref,
            "elapsed_sec": elapsed,
        }

    def close(self) -> None:
        """Tear down the tqdm bars. Idempotent."""
        if self._closed:
            return
        self._closed = True
        if self._state_bar is not None:
            self._state_bar.close()
            self._state_bar = None
        if self._quest_bar is not None:
            self._quest_bar.close()
            self._quest_bar = None
