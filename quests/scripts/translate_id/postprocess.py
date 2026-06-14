"""Glossary violation detection (Option D, always-on).

The algorithm: for each glossary term that appears in the EN source (speaker +
text), check whether it also appears in the ID translation. If not, the LLM
over-translated it; flag it.
"""
from __future__ import annotations


from .glossary import is_term_in_text


def detect_violations(line: dict, state_glossary: list[str], glossary: dict | None = None) -> list[str]:
    """Return glossary terms present in EN but missing from ID for this line.

    Includes checking each option's English and Indonesian text.
    """
    speaker_en = line.get("speaker_en", "") or ""
    speaker_id = line.get("speaker_id", "") or ""

    text_en_parts: list[str] = [line.get("text_en", "") or ""]
    text_id_parts: list[str] = [line.get("text_id", "") or ""]
    # Add option text to the source/target checks
    for opt in (line.get("options") or []):
        if isinstance(opt, dict):
            text_en_parts.append(opt.get("text_en", "") or "")
            text_id_parts.append(opt.get("text_id", "") or "")

    text_en = " ".join(text_en_parts)
    text_id = " ".join(text_id_parts)

    violations: list[str] = []
    for term in state_glossary:
        # Determine category if glossary is provided
        category = ""
        if glossary is not None:
            entry = glossary.get(term)
            if entry:
                category = entry.get("category", "")

        if category == "Speaker/NPC":
            # For Speaker/NPC name category, only validate against the speaker name field.
            # Do NOT validate in the dialogue text body, to avoid homonym false positives (e.g. Do, Will, Cat, Everyone).
            if is_term_in_text(term, speaker_en) and not is_term_in_text(term, speaker_id):
                violations.append(term)
        else:
            # For other categories (gameplay terms, locations, etc.), validate against both speaker and text.
            combined_en = speaker_en + " " + text_en
            combined_id = speaker_id + " " + text_id
            if is_term_in_text(term, combined_en) and not is_term_in_text(term, combined_id):
                violations.append(term)
    return violations


def find_missing_terms(lines: list[dict], state_glossary: list[str], glossary: dict | None = None) -> list[str]:
    """Aggregate violations across all lines, returning unique missing terms."""
    seen: set[str] = set()
    for line in lines:
        for t in detect_violations(line, state_glossary, glossary):
            seen.add(t)
    return sorted(seen)


def detect_violations_for_category(record: dict, state_glossary: list[str]) -> list[str]:
    """Return glossary terms present in text_en but missing from text_id.

    Simpler than `detect_violations` (quest version): only checks `text_en`
    vs `text_id`. No speaker, no options to consider.
    """
    en_text = record.get("text_en", "") or ""
    id_text = record.get("text_id", "") or ""
    violations: list[str] = []
    for term in state_glossary:
        if is_term_in_text(term, en_text) and not is_term_in_text(term, id_text):
            violations.append(term)
    return violations


def find_missing_terms_for_category(records: list[dict], state_glossary: list[str]) -> list[str]:
    """Aggregate missing-glossary-terms across all records (category mode)."""
    seen: set[str] = set()
    for rec in records:
        for t in detect_violations_for_category(rec, state_glossary):
            seen.add(t)
    return sorted(seen)
