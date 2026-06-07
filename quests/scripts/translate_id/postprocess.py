"""Glossary violation detection (Option D, always-on).

The algorithm: for each glossary term that appears in the EN source (speaker +
text), check whether it also appears in the ID translation. If not, the LLM
over-translated it; flag it.
"""
from __future__ import annotations


def detect_violations(line: dict, state_glossary: list[str]) -> list[str]:
    """Return glossary terms present in EN but missing from ID for this line."""
    en_text = " ".join([
        line.get("speaker_en", "") or "",
        line.get("text_en", "") or "",
    ]).lower()
    id_text = " ".join([
        line.get("speaker_id", "") or "",
        line.get("text_id", "") or "",
    ]).lower()

    violations: list[str] = []
    for term in state_glossary:
        needle = term.lower()
        if needle in en_text and needle not in id_text:
            violations.append(term)
    return violations


def find_missing_terms(lines: list[dict], state_glossary: list[str]) -> list[str]:
    """Aggregate violations across all lines, returning unique missing terms."""
    seen: set[str] = set()
    for line in lines:
        for t in detect_violations(line, state_glossary):
            seen.add(t)
    return sorted(seen)
