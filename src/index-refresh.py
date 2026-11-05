"""Bounded private journal refresh with an OS-released exclusive writer lock.

Invoked only after the Node caller verifies the configured private root ACL.
Does not access accounts, raw chat files, execution status, or providers.
"""
import argparse
import hashlib
import importlib.util
import json
import os
import re
import sys
import uuid
from contextlib import contextmanager, closing
from datetime import date, datetime, timezone
from pathlib import Path

sys.dont_write_bytecode = True

spec = importlib.util.spec_from_file_location("teamloop_log_index", Path(__file__).with_name("log-index.py"))
index = importlib.util.module_from_spec(spec)
spec.loader.exec_module(index)


def stamp():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def physical(file):
    # The Node caller already validates approved-root ancestry and ACLs. Reject
    # aliases introduced below that root, including existing junctions/symlinks.
    if file.is_symlink() or os.path.normcase(str(file.resolve())) != os.path.normcase(str(file.absolute())):
        raise ValueError("index-path-alias")


def read_json(file):
    try:
        return json.loads(index.bounded_read(file, 1048576).decode("utf-8"))
    except (OSError, ValueError):
        return None


def atomic_json(file, value):
    temporary = file.with_name(file.name + "." + str(uuid.uuid4()) + ".tmp")
    try:
        with temporary.open("x", encoding="utf-8") as stream:
            json.dump(value, stream, ensure_ascii=False)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, file)
    finally:
        temporary.unlink(missing_ok=True)


@contextmanager
def writer_lock(file):
    """Persistent lock file; the kernel releases ownership on exit or crash."""
    physical(file)
    handle = file.open("a+b")
    acquired = False
    try:
        # Byte zero exists before Windows' nonblocking byte-range lock.
        handle.seek(0, os.SEEK_END)
        if handle.tell() == 0:
            handle.write(b"0")
            handle.flush()
        handle.seek(0)
        try:
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            acquired = True
        except OSError:
            pass
        yield acquired
    finally:
        if acquired:
            handle.seek(0)
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
        handle.close()


def db_signature(file):
    try:
        info = file.stat()
        return {"databaseBytes": info.st_size, "databaseMtimeNs": str(info.st_mtime_ns)}
    except OSError:
        return {}


def refresh(root, day, force=False):
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", day):
        raise ValueError("invalid-day")
    date.fromisoformat(day)
    root = Path(root).absolute()
    physical(root)
    indexes = root / "indexes"
    indexes.mkdir(exist_ok=True)
    physical(indexes)
    receipt = indexes / (day + ".refresh.json")
    database = indexes / (day + ".sqlite")
    physical(receipt)
    physical(database)
    with writer_lock(indexes / (day + ".lock")) as acquired:
        if not acquired:
            return {"schemaVersion": 1, "selection": day, "status": "busy", "reasonCode": "index-writer-active"}
        previous = read_json(receipt)
        if not isinstance(previous, dict):
            previous = {}
        manifest = None
        try:
            journals = root / "journals"
            folder = journals / day
            physical(journals)
            physical(folder)
            files, total = [], 0
            for source in sorted(folder.glob("*.jsonl")):
                physical(source)
                if not source.is_file():
                    continue
                if len(files) >= 256:
                    raise ValueError("source-count-bound")
                info = source.stat()
                total += info.st_size
                if total > 64 * 1024 * 1024:
                    raise ValueError("source-total-bound")
                content = index.bounded_read(source, index.MAX_FILE)
                entry = {"path": str(source), "sha256": hashlib.sha256(content).hexdigest()}
                seal = Path(str(source) + ".closed")
                physical(seal)
                if seal.exists():
                    entry["seal"] = {"path": str(seal), "sha256": hashlib.sha256(index.bounded_read(seal, 65536)).hexdigest()}
                files.append(entry)
            fingerprint = hashlib.sha256(json.dumps(files, sort_keys=True).encode("utf-8")).hexdigest()
            signature = db_signature(database)
            if not force and signature and previous.get("sourceFingerprint") == fingerprint and all(previous.get(k) == v for k, v in signature.items()):
                value = {**previous, "status": "unchanged", "checkedAt": stamp()}
                atomic_json(receipt, value)
                return value
            if not files:
                value = {"schemaVersion": 1, "selection": day, "status": "empty", "checkedAt": stamp(), "selectedSources": 0}
                atomic_json(receipt, value)
                return value
            manifest = indexes / (".selection-" + str(uuid.uuid4()) + ".json")
            atomic_json(manifest, {"schemaVersion": 1, "files": files})
            report = index.build(manifest, database)
            indexed_at = stamp()
            # Bind the check receipt to this exact source snapshot and build.
            # SQLite transactions keep readers safe; a timeout before receipt
            # publication leaves an un-attested database, never fresh evidence.
            with closing(index.sqlite3.connect(database)) as db:
                with db:
                    db.executemany("INSERT OR REPLACE INTO metadata VALUES(?,?)", [("sourceFingerprint", fingerprint), ("refreshIndexedAt", indexed_at)])
            value = {**report, "schemaVersion": 1, "selection": day, "status": "indexed", "checkedAt": stamp(), "indexedAt": indexed_at, "sourceFingerprint": fingerprint, **db_signature(database)}
            atomic_json(receipt, value)
            return value
        except (OSError, ValueError, TypeError, KeyError, index.sqlite3.Error):
            # Preserve the last good database and attestation fields, but never
            # advertise a failed check as fresh. No raw exception text escapes.
            value = {**previous, "schemaVersion": 1, "selection": day, "status": "unavailable", "checkedAt": stamp(), "reasonCode": "index-refresh-failed"}
            atomic_json(receipt, value)
            return value
        finally:
            if manifest:
                manifest.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", required=True)
    parser.add_argument("--day", required=True)
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    try:
        print(json.dumps(refresh(args.root, args.day, args.force)))
        return 0
    except (OSError, ValueError, TypeError):
        print(json.dumps({"schemaVersion": 1, "status": "unavailable", "reasonCode": "index-refresh-unavailable"}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
