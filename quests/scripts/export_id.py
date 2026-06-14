#!/usr/bin/env python3
import sys
from pathlib import Path

# Allow running as a plain script by adding the parent dir (repo root) to sys.path
_REPO_ROOT = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from app.export import export_indonesian_translations

def main() -> int:
    try:
        export_indonesian_translations(_REPO_ROOT)
        return 0
    except Exception as e:
        print(f"Error during export: {e}", file=sys.stderr)
        return 1

if __name__ == "__main__":
    sys.exit(main())
