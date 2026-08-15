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
