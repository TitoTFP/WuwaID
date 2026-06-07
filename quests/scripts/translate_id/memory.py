"""Persistent translation-memory cache.

Maps `text_key` → `text_id` (Indonesian translation), built from per-quest
outputs at startup. Write-once: once a key is in the cache, its translation
is never overwritten (consistency > freshness). Atomic save via tmp + rename.
"""
from __future__ import annotations

import json
import logging
import time
from pathlib import Path
from typing import Any

from .atomic import atomic_write_json

log = logging.getLogger(__name__)

CURRENT_VERSION = 1


class Memory:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.entries: dict[str, dict] = {}
        self.model: str = ""
        self.created_at: str = ""
        self.updated_at: str = ""
        self.legacy_path: Path | None = None

    def size(self) -> int:
        return len(self.entries)

    def lookup(self, text_key: str) -> dict | None:
        return self.entries.get(text_key)

    def lookup_with_check(
        self,
        text_key: str,
        current_text_en: str,
        current_speaker_en: str,
    ) -> tuple[dict, list[str]] | None:
        """Lookup + report whether current source fields match the cache.

        Returns (entry, mismatches) where mismatches is a list of
        `text_en`/`speaker_en` if they differ. Returns None if the key
        is not in the cache (caller should LLM-translate).
        """
        entry = self.entries.get(text_key)
        if entry is None:
            return None
        mismatches: list[str] = []
        if entry.get("source_text_en", "") != current_text_en:
            mismatches.append("text_en")
        if entry.get("source_speaker_en", "") != current_speaker_en:
            mismatches.append("speaker_en")
        return entry, mismatches

    def insert(
        self,
        text_key: str,
        text_id: str,
        source_text_en: str,
        source_speaker_en: str,
        from_quest: int | str,
    ) -> bool:
        """Insert if not already present. Returns True if inserted, False if existed.

        `from_quest` may be an int (quest id, v1 behavior) or a str (category
        file name, v2 behavior). Stored as-is.
        """
        if text_key in self.entries:
            return False
        self.entries[text_key] = {
            "text_id": text_id,
            "source_text_en": source_text_en,
            "source_speaker_en": source_speaker_en,
            "from_quest": from_quest,
        }
        return True

    def save(self, model: str) -> None:
        """Atomically save to `self.path`."""
        now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        if not self.created_at:
            self.created_at = now
        self.updated_at = now
        self.model = model
        payload = {
            "version": CURRENT_VERSION,
            "model": self.model,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "entries": self.entries,
        }
        atomic_write_json(self.path, payload)

    def load(self) -> None:
        """Load memory from `self.path` (if valid), else migrate from legacy path.

        Behavior:
        - If `self.path` exists and parses cleanly with `version` matching
          `CURRENT_VERSION`, load it as the source of truth.
        - If it is corrupt (JSON error), back it up to `<path>.corrupt-<ts>`
          and start with empty memory.
        - If it is missing but `self.legacy_path` is set and exists, migrate:
          load from legacy, save to new path, delete legacy.
        - If the memory file has a wrong/unknown `version`, start empty.
        - If the new path doesn't exist and no legacy path, fall through to
          one-time seed from per-quest outputs (sibling scan).
        """
        if self.path.exists():
            try:
                with self.path.open(encoding="utf-8") as f:
                    data = json.load(f)
            except (json.JSONDecodeError, OSError):
                self._backup_corrupt()
                return
            if not isinstance(data, dict) or data.get("version") != CURRENT_VERSION:
                return
            self.entries = data.get("entries", {}) or {}
            self.model = data.get("model", "") or ""
            self.created_at = data.get("created_at", "") or ""
            self.updated_at = data.get("updated_at", "") or ""
            return

        # New path missing: try one-time migration from legacy path.
        legacy = self.legacy_path
        if legacy is not None and legacy.exists():
            try:
                with legacy.open(encoding="utf-8") as f:
                    data = json.load(f)
                if isinstance(data, dict) and data.get("version") == CURRENT_VERSION:
                    self.entries = data.get("entries", {}) or {}
                    self.model = data.get("model", "") or ""
                    self.created_at = data.get("created_at", "") or ""
                    self.updated_at = data.get("updated_at", "") or ""
                    # Save to new path, then delete legacy.
                    self.save(model=self.model or "")
                    legacy.unlink()
                    log.info(
                        "Migrated translation memory: %s -> %s (%d entries)",
                        legacy, self.path, len(self.entries),
                    )
                    return
            except (json.JSONDecodeError, OSError):
                pass

        # No new path, no legacy: one-time seed from per-quest outputs (sibling
        # of the memory file's parent dir, scanning **/quests_id/*.json).
        output_dir = self.path.parent
        if not output_dir.is_dir():
            return
        for quest_path in sorted(output_dir.glob("**/quests_id/*.json")):
            if quest_path.name.startswith("_"):
                continue
            try:
                with quest_path.open(encoding="utf-8") as f:
                    quest = json.load(f)
            except (json.JSONDecodeError, OSError):
                continue
            qid = quest.get("quest_id")
            states = quest.get("states", {}) or {}
            for state_payload in states.values():
                if not isinstance(state_payload, dict):
                    continue
                lines = state_payload.get("lines", []) or []
                for line in lines:
                    if not isinstance(line, dict):
                        continue
                    tk = line.get("text_key")
                    ti = line.get("text_id")
                    if not tk or not ti:
                        continue
                    self.insert(
                        text_key=tk,
                        text_id=ti,
                        source_text_en=line.get("source_text_en", ""),
                        source_speaker_en=line.get("source_speaker_en", ""),
                        from_quest=int(qid) if qid is not None else 0,
                    )

    def _backup_corrupt(self) -> None:
        ts = int(time.time())
        backup = self.path.with_name(f"{self.path.name}.corrupt-{ts}")
        try:
            self.path.rename(backup)
        except OSError:
            pass


    def seed_from_quest(self, quest: dict) -> int:
        """Add all `text_key → text_id` from a freshly-written quest output.

        Returns the number of new entries inserted (write-once: existing
        keys are not overwritten).
        """
        qid = quest.get("quest_id")
        states = quest.get("states", {}) or {}
        added = 0
        for state_payload in states.values():
            if not isinstance(state_payload, dict):
                continue
            for line in (state_payload.get("lines") or []):
                if not isinstance(line, dict):
                    continue
                tk = line.get("text_key")
                ti = line.get("text_id")
                if not tk or not ti:
                    continue
                if self.insert(
                    text_key=tk,
                    text_id=ti,
                    source_text_en=line.get("source_text_en", ""),
                    source_speaker_en=line.get("source_speaker_en", ""),
                    from_quest=int(qid) if qid is not None else 0,
                ):
                    added += 1
        return added
