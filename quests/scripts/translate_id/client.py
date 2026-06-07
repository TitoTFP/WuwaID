"""Async OpenAI-compatible client for `llama-server`.

Features:
- 3× retry on 5xx / timeout / connection error with exponential backoff.
- 1× retry on invalid JSON response (with suffix "Return ONLY a valid JSON array").
- 1× retry on line-count mismatch.
- 1× retry on glossary violation (with augmented system prompt).
- Captures token usage from each response and returns it alongside the result.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
from dataclasses import dataclass

import httpx

from .prompt import parse_translation_response
from .usage import Usage

log = logging.getLogger(__name__)


class LlamaError(Exception):
    """Raised when a state cannot be translated after all retries."""


@dataclass
class StateTranslation:
    """Result of translating one state.

    `lines` is the parsed list of {line_id, speaker_id, text_id} in `expected_ids` order.
    `usage` is the sum of token usage across all LLM calls for this state (including retries).
    """
    lines: list[dict]
    usage: Usage


class LlamaClient:
    def __init__(
        self,
        base_url: str | None = None,
        model: str | None = None,
        api_key: str | None = None,
        timeout: float = 300.0,
        max_retries: int = 3,
        temperature: float = 1.0,
        max_tokens: int = 4096,
        top_p: float = 0.95,
        top_k: int | None = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        # Load from environment variables if not provided
        if base_url is None:
            base_url = os.environ.get("MTL_BASE_URL", "http://localhost:8080")
        if model is None:
            model = os.environ.get("MTL_MODEL", "")
        if api_key is None:
            api_key = os.environ.get("MTL_API_KEY") or os.environ.get("OPENAI_API_KEY") or os.environ.get("OPENROUTER_API_KEY")

        self.base_url = base_url.rstrip("/")
        self.model = model
        self.api_key = api_key
        self.timeout = timeout
        self.max_retries = max_retries
        self.temperature = temperature
        self.max_tokens = max_tokens
        self.top_p = top_p
        if top_k is None and not self.api_key:
            top_k = 64
        self.top_k = top_k
        self.extra_headers = headers or {}
        self._client: httpx.AsyncClient | None = None

    async def __aenter__(self) -> "LlamaClient":
        self._client = httpx.AsyncClient(timeout=self.timeout)
        return self

    async def __aexit__(self, *exc) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    async def _post_chat(
        self,
        system_prompt: str,
        user_prompt: str,
    ) -> tuple[str, Usage]:
        """POST to /v1/chat/completions and return (content, usage).

        Raises on network errors after retries.
        """
        if self._client is None:
            raise RuntimeError("LlamaClient must be used as an async context manager")
        url = f"{self.base_url}/v1/chat/completions"

        headers = {
            "Content-Type": "application/json",
        }
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        if self.extra_headers:
            headers.update(self.extra_headers)

        body = {
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "temperature": self.temperature,
            "max_tokens": self.max_tokens,
            "top_p": self.top_p,
            "stream": False,
        }
        if self.model:
            body["model"] = self.model
        if self.top_k is not None:
            body["top_k"] = self.top_k

        last_exc: Exception | None = None
        for attempt in range(self.max_retries):
            try:
                resp = await self._client.post(url, json=body, headers=headers)
            except (httpx.HTTPError, OSError) as e:
                last_exc = e
                if attempt < self.max_retries - 1:
                    await asyncio.sleep(2 ** attempt)
                    continue
                raise LlamaError(f"Cannot reach llama-server: {e}") from e
            if 500 <= resp.status_code < 600:
                last_exc = httpx.HTTPStatusError(
                    f"server {resp.status_code}", request=resp.request, response=resp
                )
                if attempt < self.max_retries - 1:
                    await asyncio.sleep(2 ** attempt)
                    continue
                raise LlamaError(f"server {resp.status_code} after {self.max_retries} retries") from last_exc
            if resp.status_code == 429:
                retry_after = resp.headers.get("Retry-After")
                wait = float(retry_after) if retry_after else 2 ** attempt
                if attempt < self.max_retries - 1:
                    await asyncio.sleep(wait)
                    continue
                raise LlamaError(f"rate limited (429) after {self.max_retries} retries")
            if 400 <= resp.status_code < 500:
                raise LlamaError(f"client error {resp.status_code}: {resp.text[:200]}")
            data = resp.json()
            if "choices" not in data:
                error_msg = data.get("error", {}).get("message") if isinstance(data, dict) and "error" in data else str(data)
                raise LlamaError(f"LLM API response missing 'choices'. Response: {error_msg}")
            content = data["choices"][0]["message"]["content"]
            usage = Usage.from_response(data.get("usage"))
            return content, usage
        raise LlamaError(f"unreachable: {last_exc}")

    async def translate_state(
        self,
        system_prompt: str,
        user_prompt: str,
        expected_ids: list[int],
        expected_options_counts: list[int] | None = None,
    ) -> StateTranslation:
        """One call (with internal retries) to translate a state.

        Returns a StateTranslation with the parsed lines and aggregated token usage.
        Raises LlamaError on hard failure.
        """
        total_usage = Usage()
        # 1st try
        content, usage = await self._post_chat(system_prompt, user_prompt)
        total_usage = total_usage + usage
        try:
            return StateTranslation(
                lines=parse_translation_response(
                    content, expected_ids,
                    expected_options_counts=expected_options_counts,
                ),
                usage=total_usage,
            )
        except ValueError as e:
            log.warning("JSON parse failed, retrying with suffix: %s", e)
        # 1st retry with suffix
        suffix_user = user_prompt + "\n\nReturn ONLY a valid JSON array, no markdown fences."
        content, usage = await self._post_chat(system_prompt, suffix_user)
        total_usage = total_usage + usage
        try:
            return StateTranslation(
                lines=parse_translation_response(
                    content, expected_ids,
                    expected_options_counts=expected_options_counts,
                ),
                usage=total_usage,
            )
        except ValueError as e:
            raise LlamaError(f"LLM response unparseable after retry: {e}") from e

    async def translate_lines(
        self,
        system_prompt: str,
        user_prompt: str,
        expected_keys: list[str],
    ) -> StateTranslation:
        """One call (with internal retries) to translate a category chunk.

        Same retry semantics as `translate_state`:
        - 3x retry on 5xx/timeout/connection error (in `_post_chat`)
        - 1x retry on invalid JSON (with suffix "Return ONLY a valid JSON array")
        - Raises LlamaError on hard failure (parse error after retry, or
          length mismatch).
        """
        from .prompt import parse_translation_response_for_categories

        total_usage = Usage()
        # 1st try
        content, usage = await self._post_chat(system_prompt, user_prompt)
        total_usage = total_usage + usage
        try:
            return StateTranslation(
                lines=parse_translation_response_for_categories(content, expected_keys),
                usage=total_usage,
            )
        except ValueError as e:
            log.warning("translate_lines: JSON parse failed, retrying with suffix: %s", e)
        # 1st retry with suffix
        suffix_user = user_prompt + "\n\nReturn ONLY a valid JSON array, no markdown fences."
        content, usage = await self._post_chat(system_prompt, suffix_user)
        total_usage = total_usage + usage
        try:
            return StateTranslation(
                lines=parse_translation_response_for_categories(content, expected_keys),
                usage=total_usage,
            )
        except ValueError as e:
            raise LlamaError(f"LLM response unparseable after retry: {e}") from e
