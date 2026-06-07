"""System + user prompt builders for the translation LLM call."""
from __future__ import annotations

import json
import re
from typing import Iterable


SYSTEM_PROMPT = """You are a professional translator localizing a video game's dialogue from English to Indonesian (Bahasa Indonesia). The game is "Wuthering Waves", a Chinese open-world action RPG with anime aesthetics.

Rules:
1. Translate dialogue naturally into Indonesian, preserving tone, emotion, and register (formal/casual/excited).
2. Keep the following proper nouns, game terms, and character names in their English form exactly as listed in the Glossary below. Do NOT translate them.
3. Speaker names: keep the English form unless an explicit canonical Indonesian name is provided in the Glossary.
4. Preserve sentence meaning faithfully. Do not add or omit information.
5. For plot_mode "PhoneMessage": use casual chat tone, no quotation marks.
6. For plot_mode "CenterText" (narrative beat): maintain the cinematic, poetic tone.
7. Preserve any in-game markup tokens (e.g., {Item#123}, {NpcName}, {PlayerName}, color tags) exactly as they appear. Do NOT translate tokens.
8. Return ONLY a valid JSON array, no markdown fences, no commentary.
"""

# Gemma 4 chat-template token: when present in the system prompt, the model emits
# a <|channel>analysis block (thinking) followed by a <|channel>final block (answer).
# Omit to disable thinking. See https://huggingface.co/unsloth/gemma-4-12B-it-qat-GGUF
THINK_TOKEN = "<|think|>"


def build_system_prompt(enable_thinking: bool = True) -> str:
    """The system prompt — same for every request (modulo thinking token).

    When `enable_thinking` is True (default), the Gemma 4 `<|think|>` token is
    appended, prompting the model to reason before answering. The response will
    contain `<|channel>analysis...<|channel|>` (discarded) and
    `<|channel>final...<|channel|>` (extracted by `parse_translation_response`).
    """
    if enable_thinking:
        return SYSTEM_PROMPT + "\n" + THINK_TOKEN
    return SYSTEM_PROMPT


def build_user_prompt(
    glossary_subset: list[str],
    glossary_categories: dict[str, str] | None,
    state_context: dict,
    lines: list[dict],
) -> str:
    """Build the per-state user prompt.

    glossary_categories: optional map of term → category label for display.
    """
    parts: list[str] = ["# Glossary (terms to keep in English exactly as written)"]
    if glossary_subset:
        if glossary_categories:
            for t in glossary_subset:
                cat = glossary_categories.get(t, "")
                parts.append(f"- {t} ({cat})" if cat else f"- {t}")
        else:
            for t in glossary_subset:
                parts.append(f"- {t}")
    else:
        parts.append("(no glossary terms needed for this state)")

    parts.append("")
    parts.append("# State context")
    parts.append(f"- quest: {state_context.get('quest_name', '')} (id={state_context.get('quest_id', '')})")
    parts.append(f"- chapter: {state_context.get('chapter_name', '')} (id={state_context.get('chapter_id', '')})")
    parts.append(f"- flow: {state_context.get('flow_name', '')}")
    parts.append(f"- state: {state_context.get('state_key', '')}")
    parts.append(f"- plot_mode: {state_context.get('plot_mode', '')}")

    parts.append("")
    parts.append("# Input lines (preserve order in output)")
    parts.append(json.dumps(
        [
            {
                "line_id": l["id"],
                "type": l.get("type", ""),
                "speaker_en": l.get("speaker_en", ""),
                "text_en": l.get("text_en", ""),
            }
            for l in lines
        ],
        ensure_ascii=False,
    ))

    parts.append("")
    parts.append("# Output format (JSON array, same length, same order)")
    parts.append(json.dumps(
        [
            {
                "line_id": l["id"],
                "speaker_id": "<translation or English form if kept>",
                "text_id": "<translation>",
            }
            for l in lines
        ],
        ensure_ascii=False,
    ))

    return "\n".join(parts)


def build_augmented_system_prompt(missing_terms: list[str]) -> str:
    """Augmented system prompt used for the glossary-violation retry."""
    base = SYSTEM_PROMPT
    injection = (
        "\n\n# Mandatory terms (these MUST appear in English in the output, do NOT translate)\n"
        + "\n".join(f"- {t}" for t in missing_terms)
    )
    return base + injection


def parse_translation_response(raw: str, expected_ids: list[int]) -> list[dict]:
    """Parse the LLM JSON-array response, re-ordering to match `expected_ids`.

    Supports three response formats:
    1. Direct JSON: `[{"line_id": 1, ...}, ...]`
    2. Gemma 4 thinking (channel format):
       `<|channel>analysis\n...<|channel|>\n<|channel>final\n[...JSON...]<|channel|>`
    3. Gemma 4 thinking (think tag format):
       `<|think|>...<|think|>[...JSON...]`

    Markdown code fences are also stripped defensively.

    Raises ValueError on parse error or missing line_ids.
    """
    s = raw.strip()

    # Extract JSON from thinking-mode wrappers (try each format).
    s = _extract_json_from_thinking(s)

    # Strip markdown fences if present (defensive).
    if s.startswith("```"):
        s = re.sub(r"^```(?:json)?\s*", "", s)
        s = re.sub(r"\s*```$", "", s)

    try:
        data = json.loads(s)
    except json.JSONDecodeError as e:
        raise ValueError(f"LLM response is not valid JSON: {e}\n--- raw ---\n{raw[:500]}") from e

    if not isinstance(data, list):
        raise ValueError(f"LLM response is not a JSON array, got {type(data).__name__}")

    by_id: dict[int | str, dict] = {}
    for entry in data:
        if not isinstance(entry, dict):
            raise ValueError(f"LLM array contains non-object entry: {entry!r}")
        lid = entry.get("line_id")
        if lid is None:
            raise ValueError(f"LLM array entry missing line_id: {entry!r}")
        try:
            resolved_lid = int(lid)
        except (ValueError, TypeError):
            resolved_lid = lid
        by_id[resolved_lid] = entry

    result: list[dict] = []
    for lid in expected_ids:
        try:
            resolved_lid = int(lid)
        except (ValueError, TypeError):
            resolved_lid = lid
        if resolved_lid not in by_id:
            raise ValueError(f"LLM response missing line_id {lid}; got {sorted(str(k) for k in by_id.keys())[:10]}...")
        result.append(by_id[resolved_lid])
    return result


def _extract_json_from_thinking(s: str) -> str:
    """If `s` contains a Gemma 4 thinking block, return only the final-answer portion.

    Tries in order:
    1. `<|channel|>final\\n(...)<|channel|>` (channel format)
    2. `<|think|>(...)<|think|>(...)` (think tag format, take content after the closing tag)
    3. Strip `<|channel|>analysis\\n...<|channel|>` if no final block (model leaked analysis only)
    Returns `s` unchanged if no thinking markers are found.
    """
    if "<|channel|>" in s or "<|think|>" in s:
        # Channel format: extract <|channel|>final\n(...)\n<|channel|>
        m = re.search(
            r"<\|channel\|>\s*final\s*\n(.*?)<\|channel\|>",
            s,
            re.DOTALL,
        )
        if m:
            return m.group(1).strip()
        # Think-tag format: take everything after the last <|think|>...<|think|>
        if "<|think|>" in s:
            # Discard analysis (if any) and take content after closing think tag.
            parts = re.split(r"<\|think\|>", s)
            # parts is ['', 'analysis...', 'final answer...']
            if len(parts) >= 3:
                return parts[-1].strip()
        # Analysis-only or malformed: strip any analysis channel as last resort.
        s = re.sub(
            r"<\|channel\|>\s*analysis\s*\n.*?<\|channel\|>",
            "",
            s,
            flags=re.DOTALL,
        )
        s = re.sub(r"<\|think\|>.*?<\|think\|>", "", s, flags=re.DOTALL)
    return s
