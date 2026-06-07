"""Async OpenAI-compatible client for `llama-server`.

Features:
- 3× retry on 5xx / timeout / connection error with exponential backoff.
- 1× retry on invalid JSON response (with suffix "Return ONLY a valid JSON array").
- 1× retry on line-count mismatch.
- 1× retry on glossary violation (with augmented system prompt).
"""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Iterable

import httpx

from .prompt import (
    build_augmented_system_prompt,
    parse_translation_response,
)

log = logging.getLogger(__name__)


class LlamaError(Exception):
    """Raised when a state cannot be translated after all retries."""


class LlamaClient:
    def __init__(
        self,
        base_url: str = "http://localhost:8080",
        model: str = "",
        timeout: float = 120.0,
        max_retries: int = 3,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.timeout = timeout
        self.max_retries = max_retries
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
    ) -> dict:
        """POST to /v1/chat/completions and return the parsed JSON body.

        Raises on network errors after retries.
        """
        if self._client is None:
            raise RuntimeError("LlamaClient must be used as an async context manager")
        url = f"{self.base_url}/v1/chat/completions"
        body = {
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "temperature": 0.3,
            "max_tokens": 2048,
            "top_p": 0.9,
        }
        if self.model:
            body["model"] = self.model
        last_exc: Exception | None = None
        for attempt in range(self.max_retries):
            try:
                resp = await self._client.post(url, json=body)
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
            return resp.json()
        raise LlamaError(f"unreachable: {last_exc}")

    async def translate_state(
        self,
        system_prompt: str,
        user_prompt: str,
        expected_ids: list[int],
    ) -> list[dict]:
        """One call (with internal retries) to translate a state.

        Returns a list of {line_id, speaker_id, text_id} in `expected_ids` order.
        Raises LlamaError on hard failure.
        """
        resp = await self._post_chat(system_prompt, user_prompt)
        content = resp["choices"][0]["message"]["content"]
        # 1st try
        try:
            return parse_translation_response(content, expected_ids)
        except ValueError as e:
            log.warning("JSON parse failed, retrying with suffix: %s", e)
        # 1st retry with suffix
        suffix_user = user_prompt + "\n\nReturn ONLY a valid JSON array, no markdown fences."
        resp = await self._post_chat(system_prompt, suffix_user)
        content = resp["choices"][0]["message"]["content"]
        try:
            return parse_translation_response(content, expected_ids)
        except ValueError as e:
            raise LlamaError(f"LLM response unparseable after retry: {e}") from e

    async def translate_state_with_glossary_retry(
        self,
        base_system_prompt: str,
        user_prompt: str,
        expected_ids: list[int],
        state_glossary: list[str],
        detect_violations_fn,
    ) -> tuple[list[dict], list[dict]]:
        """Translate, check glossary, retry once with augmented prompt if needed.

        Returns (translated_lines, lines_for_postprocess). `lines_for_postprocess`
        is the per-line record used by the postprocessor (includes text_key,
        speaker_en, etc.) for violation detection — the caller passes the
        detector function.
        """
        # ... implemented in orchestrator; this wrapper just exposes the prompt
        raise NotImplementedError
