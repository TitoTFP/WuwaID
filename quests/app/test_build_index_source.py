"""Characterization tests for the quest-export source resolver."""
from __future__ import annotations

from pathlib import Path

import pytest

from scripts import build_index


def test_resolve_source_accepts_explicit_existing_directory(tmp_path: Path) -> None:
    source = tmp_path / "export_quest_ordered"
    source.mkdir()

    assert build_index.resolve_source(str(source)) == source.resolve()


def test_resolve_source_uses_first_existing_default_candidate(tmp_path: Path, monkeypatch) -> None:
    missing = tmp_path / "missing"
    source = tmp_path / "export_quest_ordered"
    source.mkdir()
    monkeypatch.setattr(build_index, "DEFAULT_CANDIDATES", [missing, source])

    assert build_index.resolve_source(None) == source.resolve()


def test_resolve_source_reports_missing_explicit_directory(tmp_path: Path) -> None:
    missing = tmp_path / "missing"

    with pytest.raises(FileNotFoundError, match="Source directory not found"):
        build_index.resolve_source(str(missing))
