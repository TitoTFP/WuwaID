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
