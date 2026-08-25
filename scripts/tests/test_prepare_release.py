from __future__ import annotations

import hashlib
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import textwrap
import unittest
import zipfile

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT = REPO_ROOT / "scripts" / "prepare_release.py"
NORMAL_PAK = "pakchunk0-ID-WindowsNoEditor_1000_P.pak"
HIDE_UID_PAK = "pakchunk0-ID-WindowsNoEditor-HideUID_1000_P.pak"
TARGET_IDS = ("Text_FriendMyUid_Text", "Text_UserId_Text")
EXPECTED_CONTENT = "ID Pengguna: {0}"


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def create_database(path: Path, *, missing: str | None = None, duplicate: str | None = None,
                    wrong_content: str | None = None) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path)
    connection.execute("CREATE TABLE MultiText (Id TEXT, Content TEXT, RedirectDbIndex INT)")
    rows = [
        ("Other_Text", "Jangan diubah", 7),
        *[
            (target, "Teks berubah" if target == wrong_content else EXPECTED_CONTENT, 0)
            for target in TARGET_IDS
            if target != missing
        ],
    ]
    if duplicate:
        rows.append((duplicate, EXPECTED_CONTENT, 0))
    connection.executemany("INSERT INTO MultiText VALUES (?, ?, ?)", rows)
    connection.commit()
    connection.close()


def write_fake_repak(path: Path) -> None:
    path.write_text(
        textwrap.dedent(
            """\
            #!/usr/bin/env python3
            import pathlib, sys, zipfile

            args = sys.argv[1:]
            command = args[0]
            if command == "info":
                pak = pathlib.Path(args[1])
                with zipfile.ZipFile(pak) as archive:
                    count = len(archive.namelist())
                print("mount point: ../../../")
                print("version: V12")
                print(f"{count} file entries")
            elif command == "unpack":
                output = pathlib.Path(args[args.index("--output") + 1])
                source = pathlib.Path(args[-1])
                output.mkdir(parents=True)
                with zipfile.ZipFile(source) as archive:
                    archive.extractall(output)
            elif command == "pack":
                source = pathlib.Path(args[-2])
                output = pathlib.Path(args[-1])
                with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_STORED) as archive:
                    for item in sorted(source.rglob("*")):
                        if item.is_file():
                            archive.write(item, item.relative_to(source).as_posix())
            else:
                print(f"unsupported fake repak command: {command}", file=sys.stderr)
                raise SystemExit(2)
            """
        ),
        encoding="utf-8",
    )
    path.chmod(0o755)


def create_fake_pak(release: Path, **database_options) -> None:
    source = release / "pak-source"
    db = source / "Client/Content/Aki/ConfigDB/en/lang_multi_text.db"
    create_database(db, **database_options)
    first_half = source / "Client/Content/Aki/ConfigDB/en/lang_multi_text_1sthalf.db"
    create_database(first_half, missing=TARGET_IDS[0])
    # Ensure the secondary DB has no Hide UID IDs, matching actual release behavior.
    connection = sqlite3.connect(first_half)
    connection.execute("DELETE FROM MultiText WHERE Id IN (?, ?)", TARGET_IDS)
    connection.commit()
    connection.close()
    (source / "keep.bin").write_bytes(b"untouched")
    with zipfile.ZipFile(release / NORMAL_PAK, "w", compression=zipfile.ZIP_STORED) as archive:
        for item in sorted(source.rglob("*")):
            if item.is_file():
                archive.write(item, item.relative_to(source).as_posix())
    shutil.rmtree(source)
    (release / "winhttp.dll").write_bytes(b"loader fixture")


def run_script(release: Path, repak: Path, *, timeout: int = 180) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(SCRIPT), "--repak", str(repak)],
        cwd=release,
        text=True,
        capture_output=True,
        timeout=timeout,
    )


def read_database_from_fake_pak(pak: Path, destination: Path) -> sqlite3.Connection:
    with zipfile.ZipFile(pak) as archive:
        archive.extract("Client/Content/Aki/ConfigDB/en/lang_multi_text.db", destination)
    db = destination / "Client/Content/Aki/ConfigDB/en/lang_multi_text.db"
    return sqlite3.connect(db)


class PrepareReleaseTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.release = self.root / "release/v-test"
        self.release.mkdir(parents=True)
        self.repak = self.root / "repak"
        write_fake_repak(self.repak)

    def tearDown(self) -> None:
        self.temp.cleanup()

    def assert_no_staging(self) -> None:
        self.assertEqual([], list(self.release.glob(".prepare-release-*")))

    def test_success_creates_verified_artifacts_and_preserves_sources(self) -> None:
        create_fake_pak(self.release)
        normal_hash = sha256(self.release / NORMAL_PAK)
        loader_hash = sha256(self.release / "winhttp.dll")
        source_tree = self.release / NORMAL_PAK.removesuffix(".pak")
        source_tree.mkdir()
        sentinel = source_tree / "sentinel.txt"
        sentinel.write_text("do not touch", encoding="utf-8")

        result = run_script(self.release, self.repak)

        self.assertEqual(0, result.returncode, result.stderr)
        self.assertIn("belum dipublikasikan", result.stdout)
        self.assertEqual(normal_hash, sha256(self.release / NORMAL_PAK))
        self.assertEqual(loader_hash, sha256(self.release / "winhttp.dll"))
        self.assertEqual("do not touch", sentinel.read_text(encoding="utf-8"))
        with zipfile.ZipFile(self.release / "WuwaID.zip") as archive:
            self.assertEqual([NORMAL_PAK, HIDE_UID_PAK], archive.namelist())
            self.assertEqual(normal_hash, hashlib.sha256(archive.read(NORMAL_PAK)).hexdigest())
            self.assertEqual(
                sha256(self.release / HIDE_UID_PAK),
                hashlib.sha256(archive.read(HIDE_UID_PAK)).hexdigest(),
            )
        lines = (self.release / "SHA256sums.txt").read_text(encoding="utf-8").splitlines()
        self.assertEqual(4, len(lines))
        self.assertEqual(
            ["WuwaID.zip", NORMAL_PAK, HIDE_UID_PAK, "winhttp.dll"],
            [line.split("  ", 1)[1] for line in lines],
        )
        extracted = self.root / "hidden-db"
        connection = read_database_from_fake_pak(self.release / HIDE_UID_PAK, extracted)
        self.assertEqual(
            [(target, "") for target in TARGET_IDS],
            list(
                connection.execute(
                    "SELECT Id, Content FROM MultiText WHERE Id IN (?, ?) ORDER BY Id", TARGET_IDS
                )
            ),
        )
        self.assertEqual(
            ("Jangan diubah", 7),
            connection.execute(
                "SELECT Content, RedirectDbIndex FROM MultiText WHERE Id = 'Other_Text'"
            ).fetchone(),
        )
        self.assertEqual("ok", connection.execute("PRAGMA integrity_check").fetchone()[0])
        connection.close()
        self.assert_no_staging()

    def test_missing_target_fails_without_replacing_outputs(self) -> None:
        create_fake_pak(self.release, missing=TARGET_IDS[1])
        previous = {
            HIDE_UID_PAK: b"old hide",
            "WuwaID.zip": b"old zip",
            "SHA256sums.txt": b"old sums",
        }
        for name, content in previous.items():
            (self.release / name).write_bytes(content)

        result = run_script(self.release, self.repak)

        self.assertNotEqual(0, result.returncode)
        for name, content in previous.items():
            self.assertEqual(content, (self.release / name).read_bytes())
        self.assert_no_staging()

    def test_duplicate_target_fails_without_outputs(self) -> None:
        create_fake_pak(self.release, duplicate=TARGET_IDS[0])

        result = run_script(self.release, self.repak)

        self.assertNotEqual(0, result.returncode)
        self.assertFalse((self.release / HIDE_UID_PAK).exists())
        self.assertFalse((self.release / "WuwaID.zip").exists())
        self.assertFalse((self.release / "SHA256sums.txt").exists())
        self.assert_no_staging()

    def test_unexpected_content_fails_closed(self) -> None:
        create_fake_pak(self.release, wrong_content=TARGET_IDS[0])

        result = run_script(self.release, self.repak)

        self.assertNotEqual(0, result.returncode)
        self.assertIn("Content tidak sesuai", result.stderr)
        self.assert_no_staging()

    def test_database_companion_is_refused(self) -> None:
        create_fake_pak(self.release)
        with zipfile.ZipFile(self.release / NORMAL_PAK, "a") as archive:
            archive.writestr(
                "Client/Content/Aki/ConfigDB/en/lang_multi_text.db-wal", b"unsafe companion"
            )

        result = run_script(self.release, self.repak)

        self.assertNotEqual(0, result.returncode)
        self.assertIn("companion tidak didukung", result.stderr)
        self.assert_no_staging()

    @unittest.skipUnless(
        os.environ.get("REPAK_INTEGRATION") and os.environ.get("WUWAID_RELEASE_FIXTURE"),
        "set REPAK_INTEGRATION and WUWAID_RELEASE_FIXTURE for the real-repak test",
    )
    def test_real_repak_release_fixture(self) -> None:
        real_repak = Path(os.environ["REPAK_INTEGRATION"]).resolve()
        fixture = Path(os.environ["WUWAID_RELEASE_FIXTURE"]).resolve()
        release = self.root / "real-release"
        release.mkdir()
        shutil.copy2(fixture / NORMAL_PAK, release / NORMAL_PAK)
        shutil.copy2(fixture / "winhttp.dll", release / "winhttp.dll")
        source_hashes = (sha256(release / NORMAL_PAK), sha256(release / "winhttp.dll"))

        result = run_script(release, real_repak, timeout=300)

        self.assertEqual(0, result.returncode, result.stderr)
        self.assertEqual(source_hashes, (sha256(release / NORMAL_PAK), sha256(release / "winhttp.dll")))
        with zipfile.ZipFile(release / "WuwaID.zip") as archive:
            self.assertEqual([NORMAL_PAK, HIDE_UID_PAK], archive.namelist())
        extracted_contents = {}
        for pak in (release / NORMAL_PAK, release / HIDE_UID_PAK):
            info = subprocess.run(
                [str(real_repak), "info", str(pak)], capture_output=True, text=True, timeout=30
            )
            self.assertEqual(0, info.returncode, info.stderr)
            self.assertIn("version: V12", info.stdout)
            unpacked = self.root / f"unpacked-{pak.stem}"
            unpack = subprocess.run(
                [str(real_repak), "unpack", "--output", str(unpacked), str(pak)],
                capture_output=True,
                text=True,
                timeout=60,
            )
            self.assertEqual(0, unpack.returncode, unpack.stderr)
            databases = list(unpacked.rglob("lang_multi_text.db"))
            self.assertEqual(1, len(databases))
            connection = sqlite3.connect(databases[0])
            extracted_contents[pak.name] = list(
                connection.execute(
                    "SELECT Id, Content FROM MultiText WHERE Id IN (?, ?) ORDER BY Id", TARGET_IDS
                )
            )
            self.assertEqual("ok", connection.execute("PRAGMA integrity_check").fetchone()[0])
            connection.close()
        self.assertEqual(
            [(target, EXPECTED_CONTENT) for target in TARGET_IDS],
            extracted_contents[NORMAL_PAK],
        )
        self.assertEqual(
            [(target, "") for target in TARGET_IDS],
            extracted_contents[HIDE_UID_PAK],
        )
        manifest = {}
        for line in (release / "SHA256sums.txt").read_text(encoding="utf-8").splitlines():
            digest, name = line.split("  ", 1)
            manifest[name] = digest
        self.assertEqual(
            ["WuwaID.zip", NORMAL_PAK, HIDE_UID_PAK, "winhttp.dll"], list(manifest)
        )
        self.assertEqual(sha256(release / "WuwaID.zip"), manifest["WuwaID.zip"])
        self.assertEqual(sha256(release / NORMAL_PAK), manifest[NORMAL_PAK])
        self.assertEqual(sha256(release / HIDE_UID_PAK), manifest[HIDE_UID_PAK])
        self.assertEqual(sha256(release / "winhttp.dll"), manifest["winhttp.dll"])
        self.assert_no_staging()


if __name__ == "__main__":
    unittest.main()
