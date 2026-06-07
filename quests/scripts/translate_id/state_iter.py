"""Quest → state → line iteration with chapter-priority ordering."""
from __future__ import annotations

from collections import OrderedDict
from typing import Iterable


def group_lines_by_state(all_lines: Iterable[dict]) -> "OrderedDict[str, list[dict]]":
    """Group `all_lines` by `state_key`, preserving source order for both.

    Lines without a `state_key` are dropped (they are not addressable in the
    output structure).
    """
    by_state: OrderedDict[str, list[dict]] = OrderedDict()
    for line in all_lines:
        sk = line.get("state_key")
        if not sk:
            continue
        by_state.setdefault(sk, []).append(line)
    return by_state


def order_quests_by_chapter(
    quests: list[dict],
    chapters_index: dict[int, str] | None = None,
) -> list[dict]:
    """Sort quests so main story (ch 1..N) comes first, then side (ch 0).

    Within each chapter, sort by `order` ascending. Falls back to `(qid,)`
    if `order` is missing.
    """
    def sort_key(q: dict) -> tuple:
        chapter_id = int(q.get("chapter_id", 0) or 0)
        is_side = (chapter_id == 0)
        order = q.get("order")
        order_key = order if isinstance(order, int) else 10**9
        return (is_side, chapter_id, order_key, int(q.get("quest_id", 0)))

    return sorted(quests, key=sort_key)
