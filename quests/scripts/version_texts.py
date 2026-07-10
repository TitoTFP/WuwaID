#!/usr/bin/env python3
"""CLI for immutable official-text snapshots and diffs."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from app.text_versions import (
    LANGUAGES,
    create_snapshot,
    diff_groups,
    diff_page,
    diff_rows,
    enrich_snapshot_paths,
    export_csv,
    export_sqlite,
    export_structured_zip,
    list_versions,
)

DEFAULT_SOURCE = REPO_ROOT / "data"
DEFAULT_HISTORY = DEFAULT_SOURCE / "version_history.db"


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(description="Version official Wuthering Waves MultiText rows")
    root.add_argument("--history", type=Path, default=DEFAULT_HISTORY)
    commands = root.add_subparsers(dest="command", required=True)

    snapshot = commands.add_parser("snapshot")
    snapshot.add_argument("--tag", required=True)
    snapshot.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    snapshot.add_argument("--note")

    commands.add_parser("list")

    enrich = commands.add_parser("enrich-paths")
    enrich.add_argument("--tag", required=True)
    enrich.add_argument("--source", type=Path, required=True)

    diff = commands.add_parser("diff")
    diff.add_argument("--base", required=True)
    diff.add_argument("--target", required=True)
    diff.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    diff.add_argument("--lang", choices=LANGUAGES, default="en")
    diff.add_argument("--status", action="append", choices=("added", "removed", "changed"))
    diff.add_argument("--query")
    diff.add_argument("--page", type=int, default=1)
    diff.add_argument("--page-size", type=int, default=100)

    export = commands.add_parser("export")
    export.add_argument("--base", required=True)
    export.add_argument("--target", required=True)
    export.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    export.add_argument("--lang", choices=LANGUAGES, default="en")
    export.add_argument("--format", choices=("sqlite", "csv", "structured"), required=True)
    export.add_argument("--output", type=Path, required=True)
    export.add_argument("--group", action="append", help="Structured group id; defaults to all")
    return root


def main() -> int:
    args = parser().parse_args()
    if args.command == "snapshot":
        result = create_snapshot(args.history, args.source, args.tag, args.note)
    elif args.command == "list":
        result = list_versions(args.history)
    elif args.command == "enrich-paths":
        result = enrich_snapshot_paths(args.history, args.tag, args.source)
    elif args.command == "diff":
        result = diff_page(
            args.history, args.source, args.base, args.target, args.lang,
            args.status or ("added", "removed", "changed"), args.query,
            max(1, args.page), max(1, args.page_size),
        )
    else:
        rows, summary = diff_rows(args.history, args.source, args.base, args.target, args.lang)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        if args.format == "structured":
            groups = args.group or [
                group["group_id"]
                for group in diff_groups(args.history, args.source, args.base, args.target, args.lang)["groups"]
            ]
            manifest = export_structured_zip(
                args.output, args.history, args.source, args.base, args.target, args.lang, groups
            )
            result = {"output": str(args.output), "manifest": manifest}
        else:
            (export_sqlite if args.format == "sqlite" else export_csv)(args.output, rows)
            result = {"output": str(args.output), "summary": summary}
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
