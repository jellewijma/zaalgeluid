#!/usr/bin/python3
"""Create a verified local Convex snapshot and retain the latest seven days."""

from datetime import datetime
import fcntl
import os
from pathlib import Path
import stat
import subprocess
import sys
from uuid import uuid4
from zipfile import ZipFile


BASE_DIR = Path(__file__).resolve().parent.parent
BACKUP_DIR = BASE_DIR / "backups"
CLI_DIR = BASE_DIR / "backup-client"
ADMIN_KEY_PATH = Path("/home/jelle/.config/play-audio-convex/admin-key")
CLI_PATH = "/home/jelle/.local/bin/convex"


def main():
    os.umask(0o077)
    BACKUP_DIR.mkdir(mode=0o700, parents=True, exist_ok=True)
    BACKUP_DIR.chmod(0o700)
    with (BACKUP_DIR / ".backup.lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print("A Play Audio backup is already running.")
            return

        key_stat = ADMIN_KEY_PATH.stat()
        if key_stat.st_uid != os.getuid() or stat.S_IMODE(key_stat.st_mode) & 0o077:
            raise RuntimeError("The backup admin key must be private to this user.")
        admin_key = ADMIN_KEY_PATH.read_text().strip()
        if not admin_key:
            raise RuntimeError("The backup admin key is empty.")

        # Export uses only the native backend. CI disables CLI error telemetry;
        # the loopback provision host also prevents cloud management requests.
        environment = {
            name: value
            for name, value in os.environ.items()
            if name in {"HOME", "LANG", "LC_ALL", "TZ"}
        }
        environment.update({
            "PATH": "/home/jelle/.local/bin:/usr/local/bin:/usr/bin:/bin",
            "CI": "1",
            "CONVEX_PROVISION_HOST": "http://127.0.0.1:3210",
            "CONVEX_SELF_HOSTED_URL": "http://127.0.0.1:3210",
            "CONVEX_SELF_HOSTED_ADMIN_KEY": admin_key,
        })
        destination = BACKUP_DIR / f"snapshot-{datetime.now():%Y-%m-%d}.zip"
        pending = BACKUP_DIR / f".pending-{uuid4()}.zip"
        try:
            result = subprocess.run(
                [CLI_PATH, "export", "--include-file-storage", "--path", str(pending)],
                cwd=CLI_DIR,
                env=environment,
                capture_output=True,
                text=True,
                timeout=45 * 60,
                check=False,
            )
            if result.returncode:
                # Do not send captured CLI output or credential values to logs.
                raise RuntimeError(f"Convex snapshot export failed with status {result.returncode}.")
            with ZipFile(pending) as archive:
                if not any(name.endswith("/documents.jsonl") for name in archive.namelist()):
                    raise RuntimeError("The exported snapshot contains no database tables.")
                if archive.testzip() is not None:
                    raise RuntimeError("The exported snapshot failed its ZIP integrity check.")
            pending.chmod(0o600)
            pending.replace(destination)
            snapshots = sorted(BACKUP_DIR.glob("snapshot-????-??-??.zip"), reverse=True)
            for obsolete in snapshots[7:]:
                obsolete.unlink()
            print(f"Verified backup saved: {destination.name} ({destination.stat().st_size} bytes).")
            print(f"Daily snapshots retained: {min(len(snapshots), 7)}.")
        finally:
            pending.unlink(missing_ok=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"Play Audio backup failed: {error}", file=sys.stderr)
        sys.exit(1)
