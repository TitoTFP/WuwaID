import hashlib
import json
import os
import tempfile
import unittest
from pathlib import Path

import export_text_grouped as exporter


class ExportTextGroupedTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        root = Path(self.temp_dir.name)
        self.originals = {
            "REPO_ROOT": exporter.REPO_ROOT,
            "VERSION_HISTORY_FILE": exporter.VERSION_HISTORY_FILE,
            "VERSION_MANIFEST_DIR": exporter.VERSION_MANIFEST_DIR,
        }
        exporter.REPO_ROOT = str(root)
        exporter.VERSION_HISTORY_FILE = str(root / "data" / "version_history.json")
        exporter.VERSION_MANIFEST_DIR = str(root / "data" / "version_manifests")
        (root / "data").mkdir()

    def tearDown(self):
        for name, value in self.originals.items():
            setattr(exporter, name, value)
        self.temp_dir.cleanup()

    def test_manifest_and_version_history_track_database_changes(self):
        config_dir = Path(self.temp_dir.name) / "config"
        (config_dir / "en").mkdir(parents=True)
        (config_dir / "ja").mkdir()
        first = config_dir / "en" / "first.db"
        second = config_dir / "ja" / "second.db"
        first.write_bytes(b"first")
        second.write_bytes(b"second")
        (config_dir / "README.txt").write_text("ignore", encoding="utf-8")

        manifest = exporter.build_db_manifest(str(config_dir))
        self.assertEqual(list(manifest), ["en/first.db", "ja/second.db"])
        self.assertEqual(manifest["en/first.db"]["bytes"], 5)
        self.assertEqual(
            manifest["en/first.db"]["sha256"], hashlib.sha256(b"first").hexdigest()
        )

        first_record = exporter.record_data_version(
            str(config_dir), "v-test-1", "tester", None, manifest
        )
        self.assertEqual(first_record["addedFiles"], 2)
        self.assertEqual(first_record["changedFiles"], 0)
        self.assertEqual(first_record["removedFiles"], 0)
        self.assertEqual(first_record["description"], "Snapshot database game v-test-1.")

        first.write_bytes(b"updated")
        second.unlink()
        (config_dir / "en" / "third.db").write_bytes(b"third")

        second_record = exporter.record_data_version(
            str(config_dir), "v-test-2", "tester", "fixture update"
        )
        self.assertEqual(second_record["previousVersionTag"], "v-test-1")
        self.assertEqual(second_record["changedFiles"], 1)
        self.assertEqual(second_record["addedFiles"], 1)
        self.assertEqual(second_record["removedFiles"], 1)
        self.assertEqual(second_record["description"], "fixture update")
        self.assertEqual(
            second_record["diffSummary"],
            [
                {
                    "questTitle": "en",
                    "linesChanged": 1,
                    "filesChanged": 1,
                    "addedFiles": 1,
                    "removedFiles": 0,
                },
                {
                    "questTitle": "ja",
                    "linesChanged": 0,
                    "filesChanged": 0,
                    "addedFiles": 0,
                    "removedFiles": 1,
                },
            ],
        )

        history = json.loads(Path(exporter.VERSION_HISTORY_FILE).read_text())
        self.assertEqual([item["versionTag"] for item in history], ["v-test-2", "v-test-1"])
        manifest_path = Path(exporter.REPO_ROOT) / second_record["manifestPath"]
        self.assertTrue(manifest_path.is_file())
        self.assertEqual(json.loads(manifest_path.read_text())["files"], exporter.build_db_manifest(str(config_dir)))

    def test_manifest_comparison_and_filename_sanitization(self):
        changed, added, removed, stats = exporter._compare_manifests(
            {
                "en/a.db": {"sha256": "old"},
                "ja/remove.db": {"sha256": "same"},
            },
            {
                "en/a.db": {"sha256": "new"},
                "en/add.db": {"sha256": "added"},
                "ja/remove.db": {"sha256": "same"},
            },
        )
        self.assertEqual(changed, ["en/a.db"])
        self.assertEqual(added, ["en/add.db"])
        self.assertEqual(removed, [])
        self.assertEqual(stats["en"], {"changed": 1, "added": 1, "removed": 0})
        self.assertEqual(exporter._version_filename("v 3/6:prod"), "v_3_6_prod")
        self.assertEqual(exporter._version_filename("..."), "version")


if __name__ == "__main__":
    unittest.main()
