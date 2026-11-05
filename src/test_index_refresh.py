import hashlib
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest
import uuid
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

HERE = Path(__file__).parent
spec = importlib.util.spec_from_file_location("index_refresh", HERE / "index-refresh.py")
refresh = importlib.util.module_from_spec(spec)
spec.loader.exec_module(refresh)


class RefreshTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name).resolve()
        self.day = "2026-11-04"
        self.folder = self.root / "journals" / self.day
        self.folder.mkdir(parents=True)
        self.producer = str(uuid.uuid4())
        self.file = self.folder / (self.producer + ".jsonl")
        self.event = {"schemaVersion": 1, "eventId": str(uuid.uuid4()), "producerId": self.producer, "producerSeq": 1, "eventType": "run.finished", "observedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"), "elapsedMs": 1, "severity": "info", "provenance": "runner_observed", "runId": "fixture-run", "details": {"status": "completed"}}
        self.file.write_text(json.dumps(self.event) + "\n", encoding="utf-8")

    def tearDown(self):
        self.temp.cleanup()

    def seal(self):
        Path(str(self.file) + ".closed").write_text(json.dumps({"schemaVersion": 1, "producerId": self.producer, "written": 1, "dropped": 0, "coverageComplete": True}), encoding="utf-8")

    def test_unsealed_changes_to_sealed_and_then_skips_rebuild(self):
        first = refresh.refresh(self.root, self.day)
        self.assertFalse(first["coverageComplete"])
        self.seal()
        closed = refresh.refresh(self.root, self.day)
        self.assertEqual(closed["status"], "indexed")
        self.assertTrue(closed["coverageComplete"])
        self.assertNotEqual(first["sourceFingerprint"], closed["sourceFingerprint"])
        unchanged = refresh.refresh(self.root, self.day)
        self.assertEqual(unchanged["status"], "unchanged")
        self.assertEqual(unchanged["databaseMtimeNs"], closed["databaseMtimeNs"])

    def test_failed_rebuild_retains_last_database_and_invalidates_fresh_check(self):
        self.seal()
        original = refresh.refresh(self.root, self.day)
        database = self.root / "indexes" / (self.day + ".sqlite")
        digest = hashlib.sha256(database.read_bytes()).hexdigest()
        with patch.object(refresh.index, "build", side_effect=ValueError("sensitive failure")):
            failed = refresh.refresh(self.root, self.day, force=True)
        self.assertEqual(failed["status"], "unavailable")
        self.assertEqual(failed["indexedAt"], original["indexedAt"])
        self.assertEqual(hashlib.sha256(database.read_bytes()).hexdigest(), digest)
        self.assertNotIn("sensitive failure", json.dumps(failed))

    def test_os_lock_blocks_second_writer_and_is_released_after_child_exit(self):
        self.seal()
        refresh.refresh(self.root, self.day)
        lock = self.root / "indexes" / (self.day + ".lock")
        code = "import importlib.util,sys;from pathlib import Path;s=importlib.util.spec_from_file_location('r',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);ctx=m.writer_lock(Path(sys.argv[2]));held=ctx.__enter__();print('locked' if held else 'failed',flush=True);sys.stdin.readline();__import__('os')._exit(0)"
        child = subprocess.Popen([sys.executable, "-u", "-c", code, str(HERE / "index-refresh.py"), str(lock)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
        try:
            self.assertEqual(child.stdout.readline().strip(), "locked")
            self.assertEqual(refresh.refresh(self.root, self.day)["status"], "busy")
            child.stdin.write("exit\n")
            child.stdin.flush()
            child.wait(timeout=5)
            self.assertEqual(refresh.refresh(self.root, self.day)["status"], "unchanged")
        finally:
            if child.poll() is None:
                child.kill()
                child.wait(timeout=5)
            child.stdin.close()
            child.stdout.close()

    def test_source_bound_is_explicit_without_replacing_good_database(self):
        self.seal()
        refresh.refresh(self.root, self.day)
        database = self.root / "indexes" / (self.day + ".sqlite")
        digest = hashlib.sha256(database.read_bytes()).hexdigest()
        for n in range(256):
            (self.folder / (str(n) + ".jsonl")).write_text("not an event")
        self.assertEqual(refresh.refresh(self.root, self.day)["status"], "unavailable")
        self.assertEqual(hashlib.sha256(database.read_bytes()).hexdigest(), digest)

    def test_database_mutation_prevents_unchanged_attestation(self):
        self.seal()
        refresh.refresh(self.root, self.day)
        database = self.root / "indexes" / (self.day + ".sqlite")
        os.utime(database, (0, 0))
        self.assertEqual(refresh.refresh(self.root, self.day)["status"], "indexed")


if __name__ == "__main__":
    unittest.main()
