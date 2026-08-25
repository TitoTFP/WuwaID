#!/usr/bin/env python3
"""Build and validate local WuwaID release artifacts without publishing them."""

from __future__ import annotations

import argparse
import hashlib
import os
from pathlib import Path
import shutil
import sqlite3
import stat
import subprocess
import sys
import tempfile
import zipfile

NORMAL_PAK = "pakchunk0-ID-WindowsNoEditor_1000_P.pak"
HIDE_UID_PAK = "pakchunk0-ID-WindowsNoEditor-HideUID_1000_P.pak"
ARCHIVE = "WuwaID.zip"
CHECKSUMS = "SHA256sums.txt"
LOADER = "winhttp.dll"
TARGET_IDS = ("Text_FriendMyUid_Text", "Text_UserId_Text")
EXPECTED_CONTENT = "ID Pengguna: {0}"
COMMAND_TIMEOUT_SECONDS = 300


class ReleaseError(RuntimeError):
    pass


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sha256_stream(source) -> str:
    digest = hashlib.sha256()
    for chunk in iter(lambda: source.read(1024 * 1024), b""):
        digest.update(chunk)
    return digest.hexdigest()


def require_regular_file(path: Path, *, output: bool = False) -> None:
    try:
        mode = path.lstat().st_mode
    except FileNotFoundError:
        if output:
            return
        raise ReleaseError(f"File wajib tidak ditemukan: {path.name}") from None
    if stat.S_ISLNK(mode) or not stat.S_ISREG(mode):
        raise ReleaseError(f"Path harus berupa file biasa dan bukan symlink: {path}")


def resolve_repak(requested: str | None) -> str:
    candidate = requested or os.environ.get("REPAK") or "repak"
    resolved = shutil.which(candidate)
    if resolved is None and Path(candidate).is_file():
        resolved = str(Path(candidate).resolve())
    if resolved is None:
        raise ReleaseError("repak tidak ditemukan; gunakan --repak PATH atau environment REPAK.")
    return resolved


def run_repak(repak: str, *arguments: str) -> str:
    try:
        completed = subprocess.run(
            [repak, *arguments],
            check=False,
            capture_output=True,
            text=True,
            timeout=COMMAND_TIMEOUT_SECONDS,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        raise ReleaseError(f"Gagal menjalankan repak {' '.join(arguments)}: {error}") from error
    if completed.returncode != 0:
        detail = (completed.stderr or completed.stdout).strip()
        raise ReleaseError(
            f"repak {' '.join(arguments)} gagal ({completed.returncode}): {detail}"
        )
    return completed.stdout


def verify_v12_pak(repak: str, path: Path) -> None:
    output = run_repak(repak, "info", str(path))
    if "version: V12" not in output:
        raise ReleaseError(f"PAK bukan V12 atau tidak dapat diverifikasi: {path.name}")


def quote_identifier(value: str) -> str:
    return '"' + value.replace('"', '""') + '"'


def encode_value(value) -> bytes:
    if value is None:
        payload = b""
        kind = b"n"
    elif isinstance(value, bytes):
        payload = value
        kind = b"b"
    else:
        payload = str(value).encode("utf-8", errors="surrogatepass")
        kind = type(value).__name__.encode("ascii", errors="replace")
    return kind + b":" + len(payload).to_bytes(8, "little") + payload


def digest_rows(connection: sqlite3.Connection, query: str, parameters=()) -> str:
    digest = hashlib.sha256()
    for row in connection.execute(query, parameters):
        for value in row:
            digest.update(encode_value(value))
        digest.update(b"\xff")
    return digest.hexdigest()


def database_candidate(path: Path) -> bool:
    try:
        connection = sqlite3.connect(f"file:{path.resolve()}?mode=ro", uri=True)
        columns = {
            row[1]
            for row in connection.execute(f"PRAGMA table_info({quote_identifier('MultiText')})")
        }
        if not {"Id", "Content"}.issubset(columns):
            return False
        placeholders = ",".join("?" for _ in TARGET_IDS)
        count = connection.execute(
            f"SELECT COUNT(*) FROM MultiText WHERE Id IN ({placeholders})", TARGET_IDS
        ).fetchone()[0]
        return count > 0
    except sqlite3.Error:
        return False
    finally:
        if "connection" in locals():
            connection.close()


def locate_database(unpacked: Path) -> Path:
    root = unpacked.resolve()
    candidates: list[Path] = []
    for path in unpacked.rglob("lang_multi_text.db"):
        require_regular_file(path)
        try:
            path.resolve().relative_to(root)
        except ValueError:
            raise ReleaseError(f"Database keluar dari direktori unpack: {path}") from None
        for suffix in ("-wal", "-shm"):
            companion = Path(str(path) + suffix)
            if companion.exists():
                raise ReleaseError(f"Database companion tidak didukung: {companion.name}")
        if database_candidate(path):
            candidates.append(path)
    if len(candidates) != 1:
        raise ReleaseError(
            f"Harus ada tepat satu lang_multi_text.db target; ditemukan {len(candidates)}."
        )
    return candidates[0]


def snapshot_database(connection: sqlite3.Connection) -> dict:
    columns = [row[1] for row in connection.execute("PRAGMA table_info(MultiText)")]
    quoted_columns = ", ".join(quote_identifier(column) for column in columns)
    placeholders = ",".join("?" for _ in TARGET_IDS)
    schema = list(
        connection.execute(
            "SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name"
        )
    )
    row_count = connection.execute("SELECT COUNT(*) FROM MultiText").fetchone()[0]
    targets = list(
        connection.execute(
            f"SELECT {quoted_columns} FROM MultiText WHERE Id IN ({placeholders}) ORDER BY Id, rowid",
            TARGET_IDS,
        )
    )
    others = digest_rows(
        connection,
        f"SELECT {quoted_columns} FROM MultiText WHERE Id NOT IN ({placeholders}) ORDER BY rowid",
        TARGET_IDS,
    )
    return {
        "columns": columns,
        "schema": schema,
        "row_count": row_count,
        "targets": targets,
        "others": others,
    }


def hide_uid(database: Path) -> None:
    connection = sqlite3.connect(database)
    try:
        before = snapshot_database(connection)
        id_index = before["columns"].index("Id")
        content_index = before["columns"].index("Content")
        if len(before["targets"]) != len(TARGET_IDS):
            raise ReleaseError("Setiap ID Hide UID harus memiliki tepat satu row.")
        by_id = {row[id_index]: row for row in before["targets"]}
        if set(by_id) != set(TARGET_IDS) or len(by_id) != len(TARGET_IDS):
            raise ReleaseError("ID Hide UID hilang atau duplikat.")
        for target_id in TARGET_IDS:
            if by_id[target_id][content_index] != EXPECTED_CONTENT:
                raise ReleaseError(
                    f"Content tidak sesuai untuk {target_id}: {by_id[target_id][content_index]!r}"
                )

        connection.execute("BEGIN IMMEDIATE")
        for target_id in TARGET_IDS:
            cursor = connection.execute(
                "UPDATE MultiText SET Content = '' WHERE Id = ? AND Content = ?",
                (target_id, EXPECTED_CONTENT),
            )
            if cursor.rowcount != 1:
                raise ReleaseError(f"Update tidak unik untuk {target_id}.")
        connection.commit()

        integrity = connection.execute("PRAGMA integrity_check").fetchone()[0]
        if integrity != "ok":
            raise ReleaseError(f"SQLite integrity_check gagal: {integrity}")
        after = snapshot_database(connection)
        if before["schema"] != after["schema"] or before["row_count"] != after["row_count"]:
            raise ReleaseError("Schema atau jumlah row berubah saat Hide UID.")
        if before["others"] != after["others"]:
            raise ReleaseError("Data non-target berubah saat Hide UID.")
        for old_row, new_row in zip(before["targets"], after["targets"]):
            expected = list(old_row)
            expected[content_index] = ""
            if tuple(expected) != new_row:
                raise ReleaseError("Perubahan database melebihi kolom Content target.")
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()
    for suffix in ("-wal", "-shm"):
        if Path(str(database) + suffix).exists():
            raise ReleaseError(f"SQLite meninggalkan companion yang tidak aman: {database.name}{suffix}")


def write_zip(destination: Path, normal: Path, hidden: Path) -> None:
    with zipfile.ZipFile(
        destination, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9
    ) as archive:
        for source, name in ((normal, NORMAL_PAK), (hidden, HIDE_UID_PAK)):
            info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            with source.open("rb") as input_file, archive.open(info, "w") as output_file:
                shutil.copyfileobj(input_file, output_file, length=1024 * 1024)


def checksum_entries(archive: Path, normal: Path, hidden: Path, loader: Path) -> dict[str, str]:
    return {
        ARCHIVE: sha256_file(archive),
        NORMAL_PAK: sha256_file(normal),
        HIDE_UID_PAK: sha256_file(hidden),
        LOADER: sha256_file(loader),
    }


def write_checksums(path: Path, checksums: dict[str, str]) -> None:
    path.write_text(
        "".join(f"{digest}  {name}\n" for name, digest in checksums.items()),
        encoding="utf-8",
        newline="\n",
    )


def verify_outputs(archive_path: Path, checksums_path: Path, expected: dict[str, str]) -> None:
    parsed: dict[str, str] = {}
    for line in checksums_path.read_text(encoding="utf-8").splitlines():
        digest, separator, name = line.partition("  ")
        if not separator or len(digest) != 64 or name in parsed:
            raise ReleaseError("Format SHA256sums.txt tidak valid.")
        parsed[name] = digest
    if parsed != expected:
        raise ReleaseError("Isi SHA256sums.txt tidak sesuai artifact.")

    with zipfile.ZipFile(archive_path) as archive:
        infos = archive.infolist()
        if [info.filename for info in infos] != [NORMAL_PAK, HIDE_UID_PAK]:
            raise ReleaseError("WuwaID.zip tidak berisi tepat dua PAK yang diwajibkan.")
        if any(info.is_dir() for info in infos):
            raise ReleaseError("WuwaID.zip memuat directory entry yang tidak diizinkan.")
        for name in (NORMAL_PAK, HIDE_UID_PAK):
            with archive.open(name) as member:
                if sha256_stream(member) != expected[name]:
                    raise ReleaseError(f"Checksum member ZIP gagal: {name}")
        if archive.testzip() is not None:
            raise ReleaseError("CRC WuwaID.zip gagal.")


def promote_outputs(staged: dict[Path, Path]) -> None:
    backups: dict[Path, Path] = {}
    promoted: list[Path] = []
    staging_root = next(iter(staged.values())).parent
    try:
        for destination in staged:
            require_regular_file(destination, output=True)
            if destination.exists():
                backup = staging_root / f"backup-{destination.name}"
                os.replace(destination, backup)
                backups[destination] = backup
        for destination, source in staged.items():
            os.replace(source, destination)
            promoted.append(destination)
    except Exception:
        for destination in promoted:
            destination.unlink(missing_ok=True)
        for destination, backup in backups.items():
            if backup.exists():
                os.replace(backup, destination)
        raise


def prepare_release(release_dir: Path, repak: str) -> dict[str, str]:
    release_dir = release_dir.resolve()
    normal = release_dir / NORMAL_PAK
    loader = release_dir / LOADER
    for path in (normal, loader):
        require_regular_file(path)
    for name in (HIDE_UID_PAK, ARCHIVE, CHECKSUMS):
        require_regular_file(release_dir / name, output=True)

    source_hashes = {normal: sha256_file(normal), loader: sha256_file(loader)}
    verify_v12_pak(repak, normal)

    with tempfile.TemporaryDirectory(prefix=".prepare-release-", dir=release_dir) as temp_name:
        temp = Path(temp_name)
        unpacked = temp / "unpacked"
        run_repak(repak, "unpack", "--output", str(unpacked), str(normal))
        database = locate_database(unpacked)
        hide_uid(database)

        hidden = temp / HIDE_UID_PAK
        run_repak(repak, "pack", "--version", "V12", str(unpacked), str(hidden))
        require_regular_file(hidden)
        verify_v12_pak(repak, hidden)
        if sha256_file(hidden) == source_hashes[normal]:
            raise ReleaseError("PAK Hide UID identik dengan PAK normal.")

        archive_path = temp / ARCHIVE
        checksums_path = temp / CHECKSUMS
        write_zip(archive_path, normal, hidden)
        checksums = checksum_entries(archive_path, normal, hidden, loader)
        write_checksums(checksums_path, checksums)
        verify_outputs(archive_path, checksums_path, checksums)

        if {path: sha256_file(path) for path in source_hashes} != source_hashes:
            raise ReleaseError("Artifact sumber berubah selama persiapan release.")

        promote_outputs(
            {
                release_dir / HIDE_UID_PAK: hidden,
                release_dir / ARCHIVE: archive_path,
                release_dir / CHECKSUMS: checksums_path,
            }
        )

    return checksums


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Siapkan PAK normal/Hide UID, WuwaID.zip, dan SHA256sums.txt secara lokal."
    )
    parser.add_argument("--repak", help="Path executable repak; fallback ke REPAK atau PATH.")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv if argv is not None else sys.argv[1:])
    try:
        repak = resolve_repak(args.repak)
        checksums = prepare_release(Path.cwd(), repak)
    except (ReleaseError, sqlite3.Error, zipfile.BadZipFile, OSError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 1
    print("Artifact release siap (belum dipublikasikan):")
    for name, digest in checksums.items():
        print(f"  {digest}  {name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
