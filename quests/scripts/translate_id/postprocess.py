"""Glossary violation detection (Option D, always-on).

The algorithm: for each glossary term that appears in the EN source (speaker +
text), check whether it also appears in the ID translation. If not, the LLM
over-translated it; flag it.
"""
from __future__ import annotations


from .glossary import is_term_in_text


def detect_violations(line: dict, state_glossary: list[str]) -> list[str]:
    """Return glossary terms present in EN but missing from ID for this line.

    Includes checking each option's English and Indonesian text.
    """
    en_parts: list[str] = [
        line.get("speaker_en", "") or "",
        line.get("text_en", "") or "",
    ]
    id_parts: list[str] = [
        line.get("speaker_id", "") or "",
        line.get("text_id", "") or "",
    ]
    # Add option text to the source/target checks
    for opt in (line.get("options") or []):
        if isinstance(opt, dict):
            en_parts.append(opt.get("text_en", "") or "")
            id_parts.append(opt.get("text_id", "") or "")

    en_text = " ".join(en_parts)
    id_text = " ".join(id_parts)

    violations: list[str] = []
    for term in state_glossary:
        if is_term_in_text(term, en_text) and not is_term_in_text(term, id_text):
            violations.append(term)
    return violations



def find_missing_terms(lines: list[dict], state_glossary: list[str]) -> list[str]:
    """Aggregate violations across all lines, returning unique missing terms."""
    seen: set[str] = set()
    for line in lines:
        for t in detect_violations(line, state_glossary):
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
