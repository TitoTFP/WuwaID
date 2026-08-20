#!/usr/bin/env python3

import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import update_launcher_background as downloader


class FakeHeaders:
    def __init__(self, content_type: str = "video/mp4"):
        self.content_type = content_type

    def get_content_type(self) -> str:
        return self.content_type


class FakeResponse:
    def __init__(self, body: bytes, content_type: str = "video/mp4"):
        self.body = io.BytesIO(body)
        self.headers = FakeHeaders(content_type)

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return None

    def read(self, size: int = -1) -> bytes:
        return self.body.read(size)


class DownloaderTests(unittest.TestCase):
    def test_config_urls_include_all_config_cdns(self):
        urls = downloader.config_urls("en")
        self.assertEqual(len(urls), 3)
        self.assertTrue(all(url.endswith("/en.json") for url in urls))
        self.assertIn("prod-alicdn-gamestarter.kurogame.com", urls[0])

    def test_media_urls_preserve_configured_host_then_try_fallbacks(self):
        urls = downloader.media_urls(
            "https://hw-pcdownload-qcloud.aki-game.net/launcher/clientUpload/test.mp4"
        )
        self.assertEqual(
            [
                "https://hw-pcdownload-qcloud.aki-game.net/launcher/clientUpload/test.mp4",
                "https://hw-pcdownload-aws.aki-game.net/launcher/clientUpload/test.mp4",
                "https://hw-pcdownload-akamai.aki-game.net/launcher/clientUpload/test.mp4",
            ],
            urls,
        )

    def test_fetch_background_config_falls_back_and_validates_fields(self):
        calls = []

        def fake_fetch(url, _timeout):
            calls.append(url)
            if len(calls) < 2:
                raise downloader.DownloaderError("temporary failure")
            return {
                "functionSwitch": 1,
                "backgroundFileType": 2,
                "backgroundFile": "https://example.test/background.mp4",
                "firstFrameImage": "https://example.test/poster.webp",
                "slogan": "https://example.test/slogan.png",
            }

        result = downloader.fetch_background_config("en", fetch_json=fake_fetch)
        self.assertEqual(len(calls), 2)
        self.assertEqual(result.video_url, "https://example.test/background.mp4")
        self.assertEqual(result.poster_url, "https://example.test/poster.webp")

    def test_download_rejects_html_and_tries_next_url(self):
        calls = []

        def fake_open(request, timeout):
            calls.append(request.full_url)
            if len(calls) == 1:
                return FakeResponse(b"<html>error</html>", "text/html")
            return FakeResponse(b"\x00\x00\x00\x18ftypisom" + b"video", "video/mp4")

        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory) / "bg-video.mp4"
            result = downloader.download_to_file(
                ["https://one.test/bg.mp4", "https://two.test/bg.mp4"],
                destination,
                opener=fake_open,
            )
            self.assertEqual(calls, ["https://one.test/bg.mp4", "https://two.test/bg.mp4"])
            self.assertEqual(result.url, "https://two.test/bg.mp4")
            self.assertTrue(destination.read_bytes().startswith(b"\x00\x00\x00\x18ftyp"))

    def test_update_video_hash_does_not_change_update_date(self):
        manifest = {
            "update_date": "2026-07-10T03:00:00",
            "assets": [
                {"name": "bgm.mp3", "sha256": "bgm", "url": "bgm-url"},
                {"name": "bg-video.mp4", "sha256": "old", "url": "video-url"},
            ],
        }
        updated = downloader.update_video_hash(manifest, "new")
        self.assertEqual(updated["update_date"], manifest["update_date"])
        self.assertEqual(updated["assets"][0], manifest["assets"][0])
        self.assertEqual(updated["assets"][1]["sha256"], "new")
        self.assertEqual(manifest["assets"][1]["sha256"], "old")

    def test_invalid_manifest_is_rejected_before_video_update(self):
        with self.assertRaises(downloader.DownloaderError):
            downloader.get_video_asset(
                {"update_date": "unchanged", "assets": [{"name": "bgm.mp3"}]}
            )

    def test_manifest_write_preserves_update_date(self):
        manifest = {
            "update_date": "2026-07-10T03:00:00",
            "assets": [{"name": "bg-video.mp4", "sha256": "new"}],
        }
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "assets.json"
            downloader.write_manifest_atomically(path, manifest)
            loaded = json.loads(path.read_text(encoding="utf-8"))
        self.assertEqual(loaded["update_date"], "2026-07-10T03:00:00")
        self.assertEqual(loaded["assets"][0]["sha256"], "new")


if __name__ == "__main__":
    unittest.main()
