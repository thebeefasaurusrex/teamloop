"""Disposable, private SQLite index of explicitly selected TeamLoop event journals.

build --manifest selected.json --database index.sqlite
search --database index.sqlite [--query phrase] [--task-id ID] [--run-id ID]
       [--provider NAME] [--severity LEVEL] [--event-type TYPE] [--limit 50]
coverage --database index.sqlite

Manifest: {"schemaVersion":1,"files":[{"path":"ABS.jsonl","sha256":"..."}]}
No discovery, provider execution, raw SQL, prompt ingestion or source mutation.
"""
import argparse
import hashlib
import json
import os
import re
import sqlite3
import sys
import uuid
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path

KIND = "teamloop_log_index_v1"
MAX_FILE = 16 * 1024 * 1024
MAX_EVENTS = 100000
ID = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,159}$")
TYPE = re.compile(r"^[a-z][a-z0-9_.-]{0,79}$")
CONTEXT = ("taskId", "dispatchId", "runId", "attemptId", "parentRunId", "packetHash", "provider", "requestedModel", "actualModel", "effort", "policyVersion", "runnerVersion", "dataClass", "kind")
TEXT = ("stage", "status", "failureClass", "stopReason", "source", "operation", "reasonCode", "verdict", "coverage", "transport", "metric", "unit", "accountingMode", "estimateKind", "tokenizerId", "tokenizerVersion", "scope")
COUNTS = ("elapsedMs", "durationMs", "exitCode", "stdoutBytes", "stderrBytes", "inputTokens", "outputTokens", "totalTokens", "cachedTokens", "thinkingTokens", "cacheCreationTokens", "sizeBytes", "selectedFiles", "unknownFields", "droppedEvents", "eventCount", "estimatedTokens", "inputBytes")
BOOLS = ("success", "observed", "partial", "meaningfulOutput", "fallbackUsed", "providerCallObserved", "enabled", "authoritative", "cumulative")


def safe_id(value):
    return isinstance(value, str) and ID.fullmatch(value) and not re.search(r"\b(?:sk-(?:ant-)?[A-Za-z0-9_-]{16,}|nvapi-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AIza[A-Za-z0-9_-]{30,})", value) and not re.match(r"^Bearer[-_:]",value,re.I)


def integer(value):
    return type(value) is int and 0 <= value <= 9007199254740991


def bounded_read(file,maximum):
    with Path(file).open("rb") as stream:
        content=stream.read(maximum+1)
    if len(content)>maximum:
        raise ValueError("oversized")
    return content


def normalized_event(value):
    if not isinstance(value, dict) or value.get("schemaVersion") != 1:
        raise ValueError("invalid-schema")
    for key in ("eventId", "producerId"):
        if not isinstance(value.get(key), str):
            raise ValueError("invalid-id")
        uuid.UUID(value[key])
    if not integer(value.get("producerSeq")) or value["producerSeq"] < 1:
        raise ValueError("invalid-sequence")
    if not isinstance(value.get("eventType"), str) or not TYPE.fullmatch(value["eventType"]):
        raise ValueError("invalid-type")
    timestamp = value.get("observedAt")
    if not isinstance(timestamp, str) or not timestamp.endswith("Z"):
        raise ValueError("invalid-time")
    datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
    if not integer(value.get("elapsedMs")):
        raise ValueError("invalid-elapsed")
    if value.get("severity") not in ("debug", "info", "warning", "error"):
        raise ValueError("invalid-severity")
    if value.get("provenance") != "runner_observed":
        raise ValueError("invalid-provenance")
    result = {key: value[key] for key in ("schemaVersion", "eventId", "producerId", "producerSeq", "eventType", "observedAt", "elapsedMs", "severity", "provenance")}
    for key in CONTEXT:
        if key in value:
            if not safe_id(value[key]):
                raise ValueError("invalid-context")
            result[key] = value[key]
    details = value.get("details", {})
    if not isinstance(details, dict):
        raise ValueError("invalid-details")
    selected = {}
    for key in TEXT:
        if key in details:
            if not safe_id(details[key]):
                raise ValueError("invalid-detail")
            selected[key] = details[key]
    for key in COUNTS:
        if key in details:
            if details[key] is not None and not integer(details[key]):
                raise ValueError("invalid-count")
            selected[key] = details[key]
    for key in BOOLS:
        if key in details:
            if type(details[key]) is not bool:
                raise ValueError("invalid-boolean")
            selected[key] = details[key]
    if "evidenceHash" in details:
        if not isinstance(details["evidenceHash"], str) or not re.fullmatch("[a-f0-9]{64}", details["evidenceHash"]):
            raise ValueError("invalid-hash")
        selected["evidenceHash"] = details["evidenceHash"]
    result["details"] = selected
    return result


def load_source(entry):
    source = {"path": entry["path"], "expectedHash": entry["sha256"], "status": "ok", "eventCount": 0, "partialTail": False, "sequenceGap": False}
    try:
        file = Path(entry["path"])
        if file.stat().st_size > MAX_FILE:
            source["status"] = "oversized"
            return source, []
        content = bounded_read(file,MAX_FILE)
        digest = hashlib.sha256(content).hexdigest()
        source["observedHash"] = digest
        if digest != entry["sha256"]:
            source["status"] = "hash-conflict"
            return source, []
        if len(content) > MAX_FILE:
            source["status"] = "oversized"
            return source, []
        lines = content.split(b"\n")
        if content and not content.endswith(b"\n"):
            source["partialTail"] = True
        lines = lines[:-1]  # Unterminated final records are never authoritative.
        events, previous, producer = [], 0, None
        for index, line in enumerate(lines):
            if not line or len(line) > 65536:
                raise ValueError("malformed-record")
            event = normalized_event(json.loads(line.decode("utf-8")))
            if producer is not None and producer != event["producerId"]:
                raise ValueError("mixed-producer")
            producer = event["producerId"]
            if event["producerSeq"] <= previous:
                raise ValueError("sequence-conflict")
            if event["producerSeq"] != previous + 1:
                source["sequenceGap"] = True
            previous = event["producerSeq"]
            events.append(event)
            if len(events) > MAX_EVENTS:
                raise ValueError("too-many-events")
        # Detect observed source drift while indexing, without claiming an atomic snapshot.
        if hashlib.sha256(bounded_read(file,MAX_FILE)).hexdigest() != digest:
            source["status"] = "changed-during-read"
            return source, []
        source["eventCount"] = len(events)
        if source["partialTail"] or source["sequenceGap"]:
            source["status"] = "partial"
        elif "seal" not in entry:
            source["status"] = "unsealed"
        else:
            seal_entry=entry["seal"]
            seal_bytes=bounded_read(seal_entry["path"],8192)
            if len(seal_bytes)>8192 or hashlib.sha256(seal_bytes).hexdigest()!=seal_entry["sha256"]:
                source["status"]="seal-conflict"
            else:
                seal=json.loads(seal_bytes)
                if seal.get("schemaVersion")!=1 or seal.get("written")!=len(events) or seal.get("coverageComplete") is not True or seal.get("dropped")!=0 or (producer is not None and seal.get("producerId")!=producer):
                    source["status"]="seal-incomplete"
                else:
                    source["closure"]="verified"
        return source, events
    except FileNotFoundError:
        source["status"] = "missing"
    except (OSError, UnicodeError, ValueError, TypeError, OverflowError, RecursionError):
        source["status"] = "malformed-or-unreadable"
    return source, []


@contextmanager
def readonly(database):
    connection = sqlite3.connect(Path(database).resolve().as_uri() + "?mode=ro", uri=True)
    try:
        if connection.execute("SELECT value FROM metadata WHERE key='kind'").fetchone() != (KIND,):
            raise ValueError("not-teamloop-index")
        yield connection
    finally:
        connection.close()


def build(manifest_path, database):
    manifest_file = Path(manifest_path).resolve()
    if manifest_file.stat().st_size > 262144:
        raise ValueError("manifest-too-large")
    manifest = json.loads(bounded_read(manifest_file,262144).decode("utf-8-sig"))
    entries = manifest.get("files") if isinstance(manifest, dict) else None
    if not isinstance(manifest,dict) or manifest.get("schemaVersion") != 1 or not isinstance(entries, list) or not 1 <= len(entries) <= 256:
        raise ValueError("invalid-manifest")
    selected = set()
    for entry in entries:
        if not isinstance(entry, dict) or not isinstance(entry.get("path"), str) or not Path(entry["path"]).is_absolute() or not isinstance(entry.get("sha256"), str) or not re.fullmatch("[a-f0-9]{64}", entry["sha256"]):
            raise ValueError("invalid-source")
        resolved = str(Path(entry["path"]).resolve()).casefold()
        if resolved in selected:
            raise ValueError("duplicate-source")
        selected.add(resolved)
        if "seal" in entry:
            seal=entry["seal"]
            if not isinstance(seal,dict) or not isinstance(seal.get("path"),str) or Path(seal["path"]).resolve()!=Path(entry["path"]+".closed").resolve() or not isinstance(seal.get("sha256"),str) or not re.fullmatch("[a-f0-9]{64}",seal["sha256"]):
                raise ValueError("invalid-seal")
    destination = Path(database).resolve()
    if str(destination).casefold() in selected or destination == manifest_file:
        raise ValueError("source-output-conflict")
    if destination.exists():
        with readonly(destination):
            pass
    sources, records, conflicted = [], {}, set()
    sequence_ids,sequence_conflicts={},set()
    duplicate_count = 0
    for entry in entries:
        source, events = load_source(entry)
        sources.append(source)
        for event in events:
            encoded = json.dumps(event, sort_keys=True, separators=(",", ":"))
            event_id = event["eventId"]
            sequence_key=(event["producerId"],event["producerSeq"])
            if sequence_key in sequence_ids and sequence_ids[sequence_key]!=event_id:
                sequence_conflicts.add(sequence_key)
                conflicted.update((sequence_ids[sequence_key],event_id))
            else:
                sequence_ids[sequence_key]=event_id
            if event_id in records:
                if records[event_id][0] != encoded:
                    conflicted.add(event_id)
                else:
                    duplicate_count += 1
            else:
                records[event_id] = (encoded, event)
            if len(records) > MAX_EVENTS:
                raise ValueError("too-many-events")
    for event_id in conflicted:
        records.pop(event_id, None)
    report = {"schemaVersion": 1, "kind": KIND, "selectedSources": len(sources), "indexedEvents": len(records), "duplicateEvents": duplicate_count, "conflictingEvents": len(conflicted), "sequenceConflicts":len(sequence_conflicts), "coverageComplete": all(item["status"] == "ok" for item in sources) and not conflicted, "sources": sources, "providerCalls": None, "providerCallCoverage": "not-inferred"}
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name(destination.name + "." + str(uuid.uuid4()) + ".tmp")
    connection = None
    try:
        connection = sqlite3.connect(temporary)
        connection.execute("PRAGMA journal_mode=DELETE")
        connection.executescript("CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE events(event_id TEXT PRIMARY KEY,observed_at TEXT,producer_id TEXT,producer_seq INTEGER,event_type TEXT,severity TEXT,task_id TEXT,run_id TEXT,provider TEXT,model TEXT,event_json TEXT NOT NULL,search_text TEXT NOT NULL); CREATE INDEX event_task ON events(task_id,observed_at); CREATE INDEX event_run ON events(run_id,observed_at); CREATE TABLE sources(source_path TEXT PRIMARY KEY,record_json TEXT NOT NULL);")
        fts = True
        try:
            connection.execute("CREATE VIRTUAL TABLE event_search USING fts5(event_id UNINDEXED,search_text)")
        except sqlite3.OperationalError:
            fts = False
        report["searchMode"] = "fts5-literal-phrase" if fts else "substring"
        connection.executemany("INSERT INTO metadata VALUES(?,?)", [("kind", KIND), ("coverage", json.dumps(report))])
        connection.executemany("INSERT INTO sources VALUES(?,?)", [(item["path"], json.dumps(item)) for item in sources])
        for event_id, (encoded, event) in records.items():
            searchable = " ".join(str(event.get(key, "")) for key in ("eventType", "severity", "taskId", "runId", "provider", "requestedModel", "actualModel")) + " " + " ".join(str(event["details"].get(key, "")) for key in TEXT)
            connection.execute("INSERT INTO events VALUES(?,?,?,?,?,?,?,?,?,?,?,?)", (event_id, event["observedAt"], event["producerId"], event["producerSeq"], event["eventType"], event["severity"], event.get("taskId"), event.get("runId"), event.get("provider"), event.get("actualModel", event.get("requestedModel")), encoded, searchable))
            if fts:
                connection.execute("INSERT INTO event_search VALUES(?,?)", (event_id, searchable))
        connection.commit()
        connection.close()
        connection = None
        with temporary.open("r+b") as stream:
            os.fsync(stream.fileno())
        os.replace(temporary, destination)
        return report
    finally:
        if connection is not None:
            connection.close()
        if temporary.exists():
            temporary.unlink()


def coverage(database):
    with readonly(database) as connection:
        return json.loads(connection.execute("SELECT value FROM metadata WHERE key='coverage'").fetchone()[0])


def search(database, query=None, limit=50, **filters):
    if not 1 <= limit <= 500 or (query is not None and len(query) > 256):
        raise ValueError("invalid-search-bounds")
    columns = {"task_id": "task_id", "run_id": "run_id", "provider": "provider", "severity": "severity", "event_type": "event_type"}
    clauses, parameters = [], []
    with readonly(database) as connection:
        report = json.loads(connection.execute("SELECT value FROM metadata WHERE key='coverage'").fetchone()[0])
        for key, value in filters.items():
            if key not in columns:
                raise ValueError("invalid-filter")
            if value is not None:
                clauses.append("e." + columns[key] + "=?")
                parameters.append(value)
        if query:
            if report["searchMode"].startswith("fts5"):
                clauses.append("e.event_id IN (SELECT event_id FROM event_search WHERE event_search MATCH ?)")
                parameters.append('"' + query.replace('"', '""') + '"')
            else:
                clauses.append("instr(lower(e.search_text),lower(?))>0")
                parameters.append(query)
        sql = "SELECT e.event_json FROM events e" + (" WHERE " + " AND ".join(clauses) if clauses else "") + " ORDER BY e.observed_at,e.producer_id,e.producer_seq,e.event_id LIMIT ?"
        rows = connection.execute(sql, parameters + [limit + 1]).fetchall()
        return {"schemaVersion": 1, "coverageComplete": report["coverageComplete"], "searchMode": report["searchMode"], "sourceCoverage": report, "truncated": len(rows) > limit, "events": [json.loads(row[0]) for row in rows[:limit]]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    command = commands.add_parser("build")
    command.add_argument("--manifest", required=True)
    command.add_argument("--database", required=True)
    for name in ("search", "coverage"):
        command = commands.add_parser(name)
        command.add_argument("--database", required=True)
        if name == "search":
            command.add_argument("--query")
            command.add_argument("--limit", type=int, default=50)
            for flag in ("task-id", "run-id", "provider", "severity", "event-type"):
                command.add_argument("--" + flag)
    args = vars(parser.parse_args())
    operation = args.pop("command")
    try:
        if operation == "build":
            result = build(args["manifest"], args["database"])
        elif operation == "coverage":
            result = coverage(args["database"])
        else:
            result = search(**args)
        print(json.dumps(result, ensure_ascii=False))
    except (OSError, ValueError, sqlite3.Error, TypeError, KeyError):
        print(json.dumps({"status": "failed", "reasonCode": "index-operation-failed"}))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
