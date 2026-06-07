"""Token usage data structures for chat completions responses.

Mirrors the OpenAI API `usage` field, with optional `reasoning_tokens` for
thinking-mode output (newer OpenAI spec; supported by Gemma 4 via llama-server).
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Usage:
    """Token usage for a single chat completions call (or aggregated across calls)."""
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0
    reasoning_tokens: int = 0

    @classmethod
    def from_response(cls, usage_dict: dict | None) -> "Usage":
        """Extract a Usage from an OpenAI-style `usage` dict. Defensive: missing
        or malformed fields default to 0."""
        if not isinstance(usage_dict, dict):
            return cls()
        prompt = int(usage_dict.get("prompt_tokens", 0) or 0)
        completion = int(usage_dict.get("completion_tokens", 0) or 0)
        total = int(usage_dict.get("total_tokens", 0) or 0)
        # Newer OpenAI spec: completion_tokens_details.reasoning_tokens
        details = usage_dict.get("completion_tokens_details") or {}
        reasoning = int(details.get("reasoning_tokens", 0) or 0) if isinstance(details, dict) else 0
        return cls(
            prompt_tokens=prompt,
            completion_tokens=completion,
            total_tokens=total,
            reasoning_tokens=reasoning,
        )

    def __add__(self, other: "Usage") -> "Usage":
        return Usage(
            prompt_tokens=self.prompt_tokens + other.prompt_tokens,
            completion_tokens=self.completion_tokens + other.completion_tokens,
            total_tokens=self.total_tokens + other.total_tokens,
            reasoning_tokens=self.reasoning_tokens + other.reasoning_tokens,
        )

    def is_zero(self) -> bool:
        return (
            self.prompt_tokens == 0
            and self.completion_tokens == 0
            and self.total_tokens == 0
            and self.reasoning_tokens == 0
        )
