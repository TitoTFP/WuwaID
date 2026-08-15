# Countdown Date Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Otomatiskan pembaruan `Web/assets.json:update_date` dari timestamp `releaseTimeOriginal` pada situs countdown, dengan workflow GitHub Actions mingguan yang commit langsung ke `main` hanya ketika tanggal baru lebih besar.

**Architecture:** Script Python standard library memisahkan pengambilan HTML, parsing timestamp, dan pembaruan JSON sehingga parsing serta aturan no-op/older dapat diuji memakai fixture lokal. Workflow Ubuntu terjadwal setiap Minggu pukul 00:00 UTC menjalankan unit test, menjalankan sinkronisasi HTTPS, lalu commit dan push hanya jika `Web/assets.json` berubah.

**Tech Stack:** Python 3.12 standard library (`urllib`, `re`, `datetime`, `json`, `unittest`), GitHub Actions (`actions/checkout@v4`, `actions/setup-python@v5`), JSON.

---

## File map

- Create: `scripts/update_countdown_date.py` — CLI dan fungsi murni untuk fetch, extract, convert, validate, dan update.
- Create: `scripts/test_update_countdown_date.py` — unit test `unittest` dengan HTML fixture dan temporary JSON files.
- Create: `.github/workflows/update-countdown-date.yml` — schedule mingguan, manual dispatch, test, sync, commit, dan push.
- Reference only: `Web/assets.json` — target yang dibaca/ditulis script; tidak mengubah struktur `assets`.

### Task 1: Define behavior with failing unit tests

**Files:**
- Create: `scripts/test_update_countdown_date.py`

- [ ] **Step 1: Write the failing test file**

```python
import json
import tempfile
import unittest
from pathlib import Path

from update_countdown_date import (
    CountdownSyncError,
    extract_release_value,
    format_utc_timestamp,
    parse_source_timestamp,
    update_assets_file,
)


SOURCE_HTML = """
<script>
const releaseTimeOriginal = new Date('August 20, 2026 11:00:00 UTC+8').getTime();
</script>
"""


class CountdownDateTests(unittest.TestCase):
    def test_extracts_and_converts_release_time_to_utc(self):
        raw = extract_release_value(SOURCE_HTML)

        timestamp = format_utc_timestamp(parse_source_timestamp(raw))

        self.assertEqual(timestamp, "2026-08-20T03:00:00")

    def test_rejects_missing_release_declaration(self):
        with self.assertRaises(CountdownSyncError):
            extract_release_value("<script>const currentVersion = '3.6';</script>")

    def test_rejects_ambiguous_release_declarations(self):
        html = SOURCE_HTML + SOURCE_HTML

        with self.assertRaises(CountdownSyncError):
            extract_release_value(html)

    def test_rejects_invalid_release_value(self):
        with self.assertRaises(CountdownSyncError):
            parse_source_timestamp("August 20, 2026 11:00:00")

    def test_updates_date_without_changing_assets(self):
        payload = {
            "update_date": "2026-08-20T03:00:00",
            "assets": [{"name": "bgm.mp3", "sha256": "abc"}],
        }

        with tempfile.TemporaryDirectory() as temporary_directory:
            path = Path(temporary_directory) / "assets.json"
            path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")

            changed = update_assets_file(path, "2026-09-20T03:00:00")
            updated = json.loads(path.read_text(encoding="utf-8"))

        self.assertTrue(changed)
        self.assertEqual(updated["update_date"], "2026-09-20T03:00:00")
        self.assertEqual(updated["assets"], payload["assets"])

    def test_same_date_is_a_no_op(self):
        payload = {"update_date": "2026-08-20T03:00:00", "assets": []}

        with tempfile.TemporaryDirectory() as temporary_directory:
            path = Path(temporary_directory) / "assets.json"
            original = json.dumps(payload, indent=2) + "\n"
            path.write_text(original, encoding="utf-8")

            changed = update_assets_file(path, "2026-08-20T03:00:00")

            self.assertFalse(changed)
            self.assertEqual(path.read_text(encoding="utf-8"), original)

    def test_older_date_is_rejected_without_writing(self):
        payload = {"update_date": "2026-08-20T03:00:00", "assets": []}

        with tempfile.TemporaryDirectory() as temporary_directory:
            path = Path(temporary_directory) / "assets.json"
            original = json.dumps(payload, indent=2) + "\n"
            path.write_text(original, encoding="utf-8")

            with self.assertRaises(CountdownSyncError):
                update_assets_file(path, "2026-08-19T03:00:00")

            self.assertEqual(path.read_text(encoding="utf-8"), original)

    def test_invalid_assets_json_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            path = Path(temporary_directory) / "assets.json"
            path.write_text("not json", encoding="utf-8")

            with self.assertRaises(CountdownSyncError):
                update_assets_file(path, "2026-09-20T03:00:00")


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run the tests and verify the failure is feature-related**

Run:

```powershell
python -m unittest discover -s scripts -p "test_*.py" -v
```

Expected: collection fails because `scripts/update_countdown_date.py` does not exist yet. Do not add a production placeholder; proceed to the implementation task.

- [ ] **Step 3: Commit the red tests**

```powershell
git add scripts/test_update_countdown_date.py
git commit -m "test: define countdown sync behavior"
```

### Task 2: Implement the standard-library synchronizer

**Files:**
- Create: `scripts/update_countdown_date.py`
- Test: `scripts/test_update_countdown_date.py`

- [ ] **Step 1: Add the minimal implementation matching the test API**

```python
#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.request import Request, urlopen


DEFAULT_SOURCE_URL = "https://wuthering-countdown.gengamer.in/"
DEFAULT_ASSETS_PATH = Path("Web/assets.json")
DEFAULT_TIMEOUT_SECONDS = 30
UTC_FORMAT = "%Y-%m-%dT%H:%M:%S"

RELEASE_DECLARATION = re.compile(
    r"\breleaseTimeOriginal\s*=\s*new\s+Date\(\s*['\"]"
    r"(?P<value>[^'\"]+)['\"]\s*\)\s*\.getTime\(\s*\)",
)
RELEASE_VALUE = re.compile(
    r"^(?P<date>[A-Za-z]+\s+\d{1,2},\s+\d{4}\s+\d{2}:\d{2}:\d{2})"
    r"\s+UTC(?P<sign>[+-])(?P<hours>\d{1,2})(?::?(?P<minutes>\d{2}))?$",
)


class CountdownSyncError(RuntimeError):
    """Raised when source or target data cannot be safely synchronized."""


def extract_release_value(html: str) -> str:
    matches = [match.group("value") for match in RELEASE_DECLARATION.finditer(html)]
    if len(matches) != 1:
        raise CountdownSyncError(
            f"expected exactly one releaseTimeOriginal declaration, found {len(matches)}"
        )
    return matches[0]


def parse_source_timestamp(value: str) -> datetime:
    match = RELEASE_VALUE.fullmatch(value.strip())
    if not match:
        raise CountdownSyncError(f"unsupported release timestamp: {value!r}")

    hours = int(match.group("hours"))
    minutes = int(match.group("minutes") or "0")
    if hours > 23 or minutes > 59:
        raise CountdownSyncError(f"invalid UTC offset in release timestamp: {value!r}")

    sign = 1 if match.group("sign") == "+" else -1
    offset = timezone(sign * timedelta(hours=hours, minutes=minutes))
    try:
        local_time = datetime.strptime(match.group("date"), "%B %d, %Y %H:%M:%S")
    except ValueError as error:
        raise CountdownSyncError(f"invalid release timestamp: {value!r}") from error

    return local_time.replace(tzinfo=offset).astimezone(timezone.utc)


def format_utc_timestamp(value: datetime) -> str:
    return value.astimezone(timezone.utc).replace(tzinfo=None).isoformat(timespec="seconds")


def _parse_assets_timestamp(value: object) -> datetime:
    if not isinstance(value, str):
        raise CountdownSyncError("assets.json update_date must be a string")
    try:
        parsed = datetime.strptime(value, UTC_FORMAT)
    except ValueError as error:
        raise CountdownSyncError(
            f"assets.json update_date must use {UTC_FORMAT}: {value!r}"
        ) from error
    return parsed.replace(tzinfo=timezone.utc)


def update_assets_file(path: Path, new_timestamp: str) -> bool:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise CountdownSyncError(f"could not read JSON file {path}: {error}") from error

    if not isinstance(payload, dict) or "update_date" not in payload:
        raise CountdownSyncError("assets.json must contain an update_date field")

    incoming = _parse_assets_timestamp(new_timestamp)
    current = _parse_assets_timestamp(payload["update_date"])
    if incoming < current:
        raise CountdownSyncError(
            f"source date {new_timestamp} is older than stored date {payload['update_date']}"
        )
    if incoming == current:
        return False

    payload["update_date"] = new_timestamp
    try:
        path.write_text(
            json.dumps(payload, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
    except OSError as error:
        raise CountdownSyncError(f"could not write JSON file {path}: {error}") from error
    return True


def fetch_html(url: str, timeout: float = DEFAULT_TIMEOUT_SECONDS) -> str:
    request = Request(url, headers={"User-Agent": "WuwaID-countdown-updater/1.0"})
    try:
        with urlopen(request, timeout=timeout) as response:
            charset = response.headers.get_content_charset() or "utf-8"
            return response.read().decode(charset)
    except (OSError, UnicodeError) as error:
        raise CountdownSyncError(f"could not fetch countdown page: {error}") from error


def sync(source_url: str, assets_path: Path, timeout: float) -> bool:
    html = fetch_html(source_url, timeout)
    source_value = extract_release_value(html)
    new_timestamp = format_utc_timestamp(parse_source_timestamp(source_value))
    return update_assets_file(assets_path, new_timestamp)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-url", default=DEFAULT_SOURCE_URL)
    parser.add_argument("--assets-path", type=Path, default=DEFAULT_ASSETS_PATH)
    parser.add_argument("--timeout", type=float, default=DEFAULT_TIMEOUT_SECONDS)
    args = parser.parse_args(argv)

    try:
        changed = sync(args.source_url, args.assets_path, args.timeout)
    except CountdownSyncError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1

    if changed:
        print(f"updated {args.assets_path}")
    else:
        print(f"unchanged {args.assets_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 2: Run the focused unit tests and verify they pass**

Run:

```powershell
python -m unittest discover -s scripts -p "test_*.py" -v
```

Expected: all eight tests pass with no warnings or errors.

- [ ] **Step 3: Verify the CLI contract without changing repository data**

Run:

```powershell
python scripts/update_countdown_date.py --help
```

Expected: help text lists `--source-url`, `--assets-path`, and `--timeout`, then exits with code 0.

- [ ] **Step 4: Commit the tested synchronizer**

```powershell
git add scripts/update_countdown_date.py scripts/test_update_countdown_date.py
git commit -m "feat: sync countdown date from source"
```

### Task 3: Add the weekly GitHub Actions workflow

**Files:**
- Create: `.github/workflows/update-countdown-date.yml`
- Reference: `scripts/update_countdown_date.py`, `scripts/test_update_countdown_date.py`, `Web/assets.json`

- [ ] **Step 1: Add the workflow with weekly and manual triggers**

```yaml
name: Update countdown date

on:
  schedule:
    - cron: "0 0 * * 0"
  workflow_dispatch:

permissions:
  contents: write

concurrency:
  group: update-countdown-date
  cancel-in-progress: false

jobs:
  update:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout main
        uses: actions/checkout@v4
        with:
          ref: main

      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: "3.12"

      - name: Run unit tests
        run: python -m unittest discover -s scripts -p "test_*.py" -v

      - name: Synchronize countdown date
        run: >-
          python scripts/update_countdown_date.py
          --source-url https://wuthering-countdown.gengamer.in/
          --assets-path Web/assets.json

      - name: Commit and push changed date
        shell: bash
        run: |
          if git diff --quiet -- Web/assets.json; then
            echo "update_date is already current"
            exit 0
          fi

          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add Web/assets.json
          git commit -m "chore: update game countdown date"
          git push origin HEAD:main
```

- [ ] **Step 2: Check workflow references and formatting locally**

Run:

```powershell
rg -n "schedule|0 0 \* \* 0|workflow_dispatch|contents: write|update_countdown_date|git push origin HEAD:main" .github/workflows/update-countdown-date.yml
git diff --check
```

Expected: all required workflow lines are present and `git diff --check` reports no whitespace errors.

- [ ] **Step 3: Re-run the unit tests after adding CI configuration**

Run:

```powershell
python -m unittest discover -s scripts -p "test_*.py" -v
```

Expected: all eight tests pass; the workflow file does not alter Python behavior.

- [ ] **Step 4: Commit the workflow**

```powershell
git add .github/workflows/update-countdown-date.yml
git commit -m "ci: schedule weekly countdown sync"
```

### Task 4: Run final integration checks and inspect the target diff

**Files:**
- Verify: `Web/assets.json`
- Verify: `scripts/update_countdown_date.py`
- Verify: `.github/workflows/update-countdown-date.yml`

- [ ] **Step 1: Run the full local test command**

```powershell
python -m unittest discover -s scripts -p "test_*.py" -v
```

Expected: all eight tests pass.

- [ ] **Step 2: Exercise the live source once with the repository target**

```powershell
python scripts/update_countdown_date.py --source-url https://wuthering-countdown.gengamer.in/ --assets-path Web/assets.json
```

Expected: either `unchanged Web/assets.json` with exit code 0, or `updated Web/assets.json` with a diff containing only the `update_date` value. A source/network/format error must exit non-zero and leave the file unchanged.

- [ ] **Step 3: Confirm only the intended target field changed**

```powershell
git diff -- Web/assets.json
git diff --check
git status --short
```

Expected: if a date update occurred, the diff contains only `Web/assets.json:update_date`; no generated files or asset hashes change. If no date update occurred, the working tree is clean.

- [ ] **Step 4: Commit a legitimate live date update, if one occurred**

Run only when `git diff -- Web/assets.json` showed an update to `update_date`:

```powershell
git add Web/assets.json
git commit -m "chore: update game countdown date"
```

Expected: the commit contains only the `update_date` line.

- [ ] **Step 5: Confirm the final commit list**

```powershell
git log -4 --oneline --decorate
git status --short --branch
```

Expected: the test, synchronizer, and workflow commits are present, and no
untracked or unstaged files remain.

## Self-review checklist

- Source extraction, explicit UTC offset parsing, UTC formatting, and exact
  `2026-08-20T03:00:00` conversion are covered in Task 1 and Task 2.
- Missing/ambiguous/invalid source data, invalid target JSON, same-date no-op,
  and older-date rejection are covered by the eight unit tests.
- Only `update_date` is assigned before writing; `assets` is asserted unchanged.
- Weekly cron, manual dispatch, Python setup, write permission, concurrency,
  test-before-sync, no-op commit guard, direct `main` push, and no force-push
  are all explicit in Task 3.
- Network errors are handled by `CountdownSyncError`; unit tests stay offline,
  while Task 4 performs the single live integration check.
- No new dependency, launcher change, UI change, or unrelated refactor is
  included.
