#!/usr/bin/env python3
"""Update WuwaID's background video from the official Kuro launcher config.

The generated ``Web/assets.json`` keeps the existing manifest contract used by
WuwaIDLauncher. Only the SHA-256 value for ``bg-video.mp4`` is changed;
``update_date`` is deliberately not managed by this script because it drives
the in-game update countdown.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO, Callable, Iterable
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen


APP_ID = "50004"
APP_KEY = "obOHXFrFanqsaIEOmuKroCcbZkQRBC7c"
GAME_ID = "G153"
BACKGROUND_FUNCTION = "dOlPEc8xvpP8r4k2lyIOK6p0R7hNNqRf"
DEFAULT_LANGUAGE = "en"
DEFAULT_TIMEOUT = 30
DEFAULT_CHUNK_SIZE = 1024 * 1024
MEDIA_HOSTS = (
    "hw-pcdownload-qcloud.aki-game.net",
    "hw-pcdownload-aws.aki-game.net",
    "hw-pcdownload-akamai.aki-game.net",
)
CONFIG_HOSTS = (
    "prod-alicdn-gamestarter.kurogame.com",
    "prod-volcdn-gamestarter.kurogame.net",
    "prod-tencentcdn-gamestarter.kurogame.net",
)
MEDIA_BASE_PATH = "/launcher/clientUpload/"
MP4_SIGNATURES = (b"ftyp",)


class DownloaderError(RuntimeError):
    """Raised when a launcher asset cannot be safely fetched or updated."""


@dataclass(frozen=True)
class BackgroundConfig:
    video_url: str
    video_type: int
    poster_url: str | None
    slogan_url: str | None
    source_url: str


@dataclass(frozen=True)
class DownloadResult:
    url: str
    bytes_written: int
    sha256: str


def repository_root() -> Path:
    return Path(__file__).resolve().parents[1]


def default_config_path() -> Path:
    return repository_root() / "Web" / "assets.json"


def default_video_path() -> Path:
    return repository_root() / "Web" / "Video" / "bg-video.mp4"


def config_urls(language: str) -> list[str]:
    path = (
        f"/launcher/{APP_ID}_{APP_KEY}/{GAME_ID}/background/"
        f"{BACKGROUND_FUNCTION}/{language}.json"
    )
    return [f"https://{host}{path}" for host in CONFIG_HOSTS]


def media_urls(url: str) -> list[str]:
    """Return the configured URL followed by equivalent CDN host variants."""

    parsed = urlparse(url)
    if parsed.scheme != "https" or not parsed.netloc:
        raise DownloaderError(f"backgroundFile bukan URL HTTPS yang valid: {url}")

    if parsed.path.startswith(MEDIA_BASE_PATH):
        path = parsed.path
        if parsed.query:
            path += f"?{parsed.query}"
        urls = [f"https://{host}{path}" for host in MEDIA_HOSTS]
        configured = f"{parsed.scheme}://{parsed.netloc}{path}"
        return [configured, *[candidate for candidate in urls if candidate != configured]]

    return [url]


def request_json(url: str, timeout: int = DEFAULT_TIMEOUT) -> dict:
    request = Request(
        url,
        headers={
            "Accept": "application/json",
            "User-Agent": "WuwaID-background-downloader/1.0",
        },
    )
    try:
        with urlopen(request, timeout=timeout) as response:
            body = response.read()
    except (HTTPError, URLError, TimeoutError, OSError) as error:
        raise DownloaderError(f"Gagal mengambil konfigurasi {url}: {error}") from error

    try:
        payload = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise DownloaderError(f"Response konfigurasi bukan JSON valid: {url}") from error

    if not isinstance(payload, dict):
        raise DownloaderError(f"Response konfigurasi harus berupa object JSON: {url}")
    return payload


def fetch_background_config(
    language: str,
    timeout: int = DEFAULT_TIMEOUT,
    fetch_json: Callable[[str, int], dict] = request_json,
) -> BackgroundConfig:
    errors: list[str] = []
    for url in config_urls(language):
        try:
            payload = fetch_json(url, timeout)
            if payload.get("functionSwitch") != 1:
                raise DownloaderError("functionSwitch bukan 1")
            if payload.get("backgroundFileType") != 2:
                raise DownloaderError(
                    f"backgroundFileType tidak didukung: {payload.get('backgroundFileType')}"
                )

            video_url = payload.get("backgroundFile")
            if not isinstance(video_url, str) or not video_url:
                raise DownloaderError("field backgroundFile tidak tersedia")
            return BackgroundConfig(
                video_url=video_url,
                video_type=2,
                poster_url=optional_url(payload.get("firstFrameImage")),
                slogan_url=optional_url(payload.get("slogan")),
                source_url=url,
            )
        except DownloaderError as error:
            errors.append(f"{url}: {error}")

    raise DownloaderError(
        "Semua endpoint konfigurasi background gagal:\n- " + "\n- ".join(errors)
    )


def optional_url(value: object) -> str | None:
    return value if isinstance(value, str) and value else None


def is_mp4_header(header: bytes) -> bool:
    """Validate the ISO Base Media File Format ftyp box near the start."""

    if len(header) < 12 or header[4:8] not in MP4_SIGNATURES:
        return False
    box_size = int.from_bytes(header[:4], "big")
    return box_size >= 8 or box_size == 0


def download_to_file(
    urls: Iterable[str],
    destination: Path,
    timeout: int = DEFAULT_TIMEOUT,
    chunk_size: int = DEFAULT_CHUNK_SIZE,
    opener: Callable[..., object] = urlopen,
) -> DownloadResult:
    errors: list[str] = []
    for url in urls:
        request = Request(
            url,
            headers={
                "Accept": "video/mp4,application/octet-stream;q=0.9,*/*;q=0.1",
                "User-Agent": "WuwaID-background-downloader/1.0",
            },
        )
        temp_path: Path | None = None
        try:
            with opener(request, timeout=timeout) as response:
                content_type = response.headers.get_content_type()
                if content_type in {"text/html", "application/json"}:
                    raise DownloaderError(
                        f"response bukan video (Content-Type: {content_type})"
                    )

                destination.parent.mkdir(parents=True, exist_ok=True)
                with tempfile.NamedTemporaryFile(
                    mode="wb", dir=destination.parent, prefix=f".{destination.name}.", delete=False
                ) as output:
                    temp_path = Path(output.name)
                    result = stream_download(response, output, chunk_size)

                with temp_path.open("rb") as downloaded:
                    header = downloaded.read(32)
                if not is_mp4_header(header):
                    raise DownloaderError("download bukan file MP4 yang valid")

                os.replace(temp_path, destination)
                return DownloadResult(url, result[0], result[1])
        except (HTTPError, URLError, TimeoutError, OSError, DownloaderError) as error:
            if temp_path is not None:
                temp_path.unlink(missing_ok=True)
            errors.append(f"{url}: {error}")

    raise DownloaderError("Semua URL background gagal:\n- " + "\n- ".join(errors))


def stream_download(response: object, output: BinaryIO, chunk_size: int) -> tuple[int, str]:
    hasher = hashlib.sha256()
    first_chunk = True
    bytes_written = 0
    while True:
        chunk = response.read(chunk_size)  # type: ignore[attr-defined]
        if not chunk:
            break
        if first_chunk and len(chunk) < 32:
            # A small initial chunk can still be valid; read more before checking.
            prefix = bytearray(chunk)
            while len(prefix) < 32:
                extra = response.read(32 - len(prefix))  # type: ignore[attr-defined]
                if not extra:
                    break
                prefix.extend(extra)
                chunk += extra
        first_chunk = False
        output.write(chunk)
        hasher.update(chunk)
        bytes_written += len(chunk)
    if bytes_written == 0:
        raise DownloaderError("response video kosong")
    return bytes_written, hasher.hexdigest()


def read_manifest(path: Path) -> dict:
    try:
        with path.open("r", encoding="utf-8") as manifest_file:
            payload = json.load(manifest_file)
    except (OSError, json.JSONDecodeError) as error:
        raise DownloaderError(f"Gagal membaca manifest {path}: {error}") from error
    if not isinstance(payload, dict) or not isinstance(payload.get("assets"), list):
        raise DownloaderError("Manifest harus memiliki field assets berupa array")
    return payload


def update_video_hash(manifest: dict, video_hash: str) -> dict:
    updated = json.loads(json.dumps(manifest))
    video_asset = get_video_asset(updated)
    video_asset["sha256"] = video_hash
    return updated


def get_video_asset(manifest: dict) -> dict:
    matches = [
        asset
        for asset in manifest["assets"]
        if isinstance(asset, dict) and asset.get("name") == "bg-video.mp4"
    ]
    if len(matches) != 1:
        raise DownloaderError(
            f"Manifest harus memiliki tepat satu entry bg-video.mp4, ditemukan {len(matches)}"
        )
    return matches[0]


def write_manifest_atomically(path: Path, manifest: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        mode="w", encoding="utf-8", dir=path.parent, prefix=f".{path.name}.", delete=False
    ) as output:
        temp_path = Path(output.name)
        json.dump(manifest, output, ensure_ascii=False, indent=2)
        output.write("\n")
    try:
        os.replace(temp_path, path)
    except OSError:
        temp_path.unlink(missing_ok=True)
        raise


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Update Web/Video/bg-video.mp4 from the Kuro launcher background config."
    )
    parser.add_argument("--language", default=DEFAULT_LANGUAGE, help="Launcher config language (default: en).")
    parser.add_argument("--manifest", type=Path, default=default_config_path(), help="Path to Web/assets.json.")
    parser.add_argument("--video", type=Path, default=default_video_path(), help="Path to bg-video.mp4.")
    parser.add_argument("--timeout", type=int, default=DEFAULT_TIMEOUT, help="HTTP timeout in seconds.")
    parser.add_argument("--dry-run", action="store_true", help="Fetch and validate but do not modify files.")
    return parser.parse_args(argv)


def run(args: argparse.Namespace) -> int:
    if args.timeout <= 0:
        raise DownloaderError("--timeout harus lebih besar dari 0")

    manifest = read_manifest(args.manifest)
    current_hash = get_video_asset(manifest).get("sha256")
    background = fetch_background_config(args.language, args.timeout)
    result = download_to_file(media_urls(background.video_url), args.video, args.timeout)

    print(f"Config: {background.source_url}")
    print(f"Video:  {result.url}")
    print(f"Size:   {result.bytes_written:,} bytes")
    print(f"SHA256: {result.sha256}")

    if args.dry_run:
        print("Dry run: tidak ada file yang diubah.")
        return 0

    updated_manifest = update_video_hash(manifest, result.sha256)
    if current_hash != result.sha256:
        write_manifest_atomically(args.manifest, updated_manifest)
        print(f"Updated: {args.manifest}")
    else:
        print(f"Manifest sudah memiliki SHA-256 yang sama: {args.manifest}")
    return 0


def main(argv: list[str] | None = None) -> int:
    try:
        return run(parse_args(argv))
    except DownloaderError as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
