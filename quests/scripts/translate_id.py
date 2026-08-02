#!/usr/bin/env python3
"""CLI entry point: `python scripts/translate_id.py [args]`.

Thin shim — the real logic lives in `scripts.translate_id._cli` (a submodule
of the `scripts.translate_id` package). This file exists so you can run the
tool with `python scripts/translate_id.py` without `-m`.
"""
from __future__ import annotations

import sys
from pathlib import Path

# Allow running as a plain script (`python scripts/translate_id.py`) by
# adding the parent dir (repo root) to sys.path so `scripts.translate_id` is
# importable as a package.
_REPO_ROOT = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from scripts.translate_id._cli import main

if __name__ == "__main__":
    raise SystemExit(main(repo_root=_REPO_ROOT))
