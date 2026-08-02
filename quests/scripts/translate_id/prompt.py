"""System + user prompt builders for the translation LLM call."""
from __future__ import annotations

import json
import re
from typing import Iterable


SYSTEM_PROMPT = """You are a professional translator localizing a video game's dialogue from English to Indonesian (Bahasa Indonesia). The game is "Wuthering Waves", a Chinese open-world action RPG with anime aesthetics.

Rules:
1. Translate dialogue naturally into Indonesian, preserving tone, emotion, and register (formal/casual/excited).
   - Character Register: Ensure characters like Arman (professor/academic) speak in a formal/polite tone (using 'saya' / 'Anda' appropriately), while peers/friends (like Sigrika, Denia) speak in a natural, casual tone (using 'aku' / 'kamu', with conversational particles like 'sih', 'kan', 'deh').
2. Avoid literal word-for-word translations of English idioms, prepositions, or phrases. Translate them to natural, idiomatic Indonesian equivalents:
   - "kills the mood" -> "merusak suasana" / "bikin hilang mood" (NOT "bunuh suasana")
   - "how did it go?" -> "bagaimana hasilnya?" / "bagaimana perkembangannya?" (NOT "apa yang sudah selesai?")
   - "in time" -> "pada akhirnya" / "kelak" (NOT "in waktu akhir")
   - "is the word" -> "memang tepat" / "bisa dibilang..." (NOT "adalah katanya")
   - "rest assured" -> "tenang saja" / "jangan khawatir" (NOT "mohon tenangkanlah")
3. Pay close attention to contextual meanings:
   - "at best" (in medical/time limits) -> "paling lama" / "paling bagus" (NOT "minimal sekali")
   - "take visitors" (medical/infirmary context) -> "menerima kunjungan" / "dikunjungi" (NOT "dipuji")
   - "Yawn" (action/sound descriptor) -> "*Menguap*" / "*Uap*" (NOT "Enggan")
   - "dorms" -> "asrama" (NOT "kamtin" / "kantin")
4. Keep proper nouns, game terms, and character names in their English form exactly as listed in the Glossary below. Do NOT translate them.
   - If a compound phrase contains a glossary term (e.g., "Voidmatters Science" containing "Voidmatter"), keep the glossary term consistent (e.g., "Sains Voidmatter" or "Ilmu Voidmatter", do NOT translate "Voidmatter" to "Penjelamaan").
5. Speaker names: keep the English form unless an explicit canonical Indonesian name is provided in the Glossary.
6. Preserve sentence meaning faithfully. Do not add or omit information.
7. For plot_mode "PhoneMessage": use casual chat tone, no quotation marks.
8. For plot_mode "CenterText" (narrative beat): maintain the cinematic, poetic tone.
9. Preserve any in-game markup tokens (e.g., {Item#123}, {NpcName}, {PlayerName}, color tags) exactly as they appear. Do NOT translate tokens.
10. Ensure correct Indonesian spelling, grammar, and proper spacing. Do not merge separate words (e.g., write "dari prediksi", NOT "daraprediksi").
11. Return ONLY a valid JSON array, no markdown fences, no commentary.
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
                "options_en": [
                    {
                        "text_key": o.get("text_key", ""),
                        "text_en": o.get("text_en", ""),
                    }
                    for o in (l.get("options") or [])
                ],
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
                "options_id": [
                    {
                        "text_key": o.get("text_key", ""),
                        "text_id": "<translation of option text_en>",
                    }
                    for o in (l.get("options") or [])
                ],
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


def parse_translation_response(
    raw: str,
    expected_ids: list[int],
    expected_options_counts: list[int] | None = None,
) -> list[dict]:
    """Parse the LLM JSON-array response, re-ordering to match `expected_ids`.

    Supports three response formats:
    1. Direct JSON: `[{"line_id": 1, ...}, ...]`
    2. Gemma 4 thinking (channel format):
       `<|channel>analysis\n...<|channel|>\n<|channel>final\n[...JSON...]<|channel|>`
    3. Gemma 4 thinking (think tag format):
       `<|think|>...<|think|>[...JSON...]`

    Markdown code fences are also stripped defensively.

    If `expected_options_counts` is provided (a list parallel to `expected_ids`),
    each line's `options_id` array length is validated against the expected count.
    A mismatch raises `ValueError` so the caller can retry.

    Raises ValueError on parse error, missing line_ids, or options_id length mismatch.
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
    for idx, lid in enumerate(expected_ids):
        try:
            resolved_lid = int(lid)
        except (ValueError, TypeError):
            resolved_lid = lid
        if resolved_lid not in by_id:
            raise ValueError(f"LLM response missing line_id {lid}; got {sorted(str(k) for k in by_id.keys())[:10]}...")
        entry = by_id[resolved_lid]
        # Validate options_id count if requested
        if expected_options_counts is not None:
            expected_count = expected_options_counts[idx]
            actual_count = len(entry.get("options_id") or [])
            if actual_count != expected_count:
                raise ValueError(
                    f"line_id {lid}: expected {expected_count} options_id entries, got {actual_count}"
                )
        result.append(entry)
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


CATEGORY_SYSTEM_PROMPT = """You are a professional translator localizing short game text from English to Indonesian (Bahasa Indonesia). The game is "Wuthering Waves", a Chinese open-world action RPG with anime aesthetics.

The text in this batch is from the "<CATEGORY>" category (e.g. item names, skill descriptions, UI labels, NPC titles). Translate it concisely and naturally, matching the register of the original (proper-noun name, short label, descriptive blurb, etc.).

Rules:
1. Keep the following proper nouns, game terms, and character names in their English form exactly as listed in the Glossary below. Do NOT translate them.
2. Preserve any in-game markup tokens (e.g., {Item#123}, {NpcName}, {PlayerName}, color tags, {0}, {1}) exactly as they appear. Do NOT translate tokens.
3. Preserve capitalization and punctuation style of the source (e.g., "COST 3 (Glacio)" stays title-cased; "16:08" stays as-is).
4. Preserve sentence meaning faithfully. Do not add or omit information.
5. Return ONLY a valid JSON array, no markdown fences, no commentary.
"""


def build_user_prompt_for_categories(
    glossary_subset: list[str],
    glossary_categories: dict[str, str] | None,
    category: str,
    prefix: str,
    keys: list[dict],
) -> str:
    """Build the per-chunk user prompt for category translation.

    `keys` is a list of `{key, text_en, text_zh, text_ja}` dicts (in order).
    Output schema uses `key`/`text_id` (vs quest's `line_id`/`text_id`).
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
        parts.append("(no glossary terms needed for this chunk)")

    parts.append("")
    parts.append("# Category context")
    parts.append(f"- category: {category}")
    parts.append(f"- prefix group: {prefix}")

    parts.append("")
    parts.append("# Input keys (preserve order in output)")
    parts.append(json.dumps(
        [
            {
                "key": k["key"],
                "text_zh": k.get("text_zh", ""),
                "text_en": k.get("text_en", ""),
                "text_ja": k.get("text_ja", ""),
            }
            for k in keys
        ],
        ensure_ascii=False,
    ))

    parts.append("")
    parts.append("# Output format (JSON array, same length, same order)")
    parts.append(json.dumps(
        [
            {"key": k["key"], "text_id": "<translation>"}
            for k in keys
        ],
        ensure_ascii=False,
    ))

    return "\n".join(parts)


def build_augmented_system_prompt_for_categories(missing_terms: list[str]) -> str:
    """Augmented system prompt for the glossary-violation retry.

    Same shape as `build_augmented_system_prompt` (quest version).
    """
    injection = (
        "\n\n# Mandatory terms (these MUST appear in English in the output, do NOT translate)\n"
        + "\n".join(f"- {t}" for t in missing_terms)
    )
    return CATEGORY_SYSTEM_PROMPT + injection


def parse_translation_response_for_categories(
    raw: str,
    expected_keys: list[str],
) -> list[dict]:
    """Parse the LLM JSON-array response for category translation.

    Reuses `_extract_json_from_thinking` (already defined in this module)
    to handle Gemma 4 thinking-mode wrappers. Re-orders to match
    `expected_keys`. Raises ValueError on parse error, missing keys.
    """
    s = raw.strip()
    s = _extract_json_from_thinking(s)
    if s.startswith("```"):
        s = re.sub(r"^```(?:json)?\s*", "", s)
        s = re.sub(r"\s*```$", "", s)
    try:
        data = json.loads(s)
    except json.JSONDecodeError as e:
        raise ValueError(f"LLM response is not valid JSON: {e}\n--- raw ---\n{raw[:500]}") from e
    if not isinstance(data, list):
        raise ValueError(f"LLM response is not a JSON array, got {type(data).__name__}")
    by_key: dict[str, dict] = {}
    for entry in data:
        if not isinstance(entry, dict):
            raise ValueError(f"LLM array contains non-object entry: {entry!r}")
        k = entry.get("key")
        if k is None:
            raise ValueError(f"LLM array entry missing key: {entry!r}")
        by_key[str(k)] = entry
    result: list[dict] = []
    for k in expected_keys:
        if k not in by_key:
            raise ValueError(f"LLM response missing key {k}; got {sorted(by_key.keys())[:10]}...")
        result.append(by_key[k])
    return result
