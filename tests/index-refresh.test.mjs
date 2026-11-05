import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { refreshIndexDay, refreshRecentIndexes, refreshClosedJournal } from '../src/index-refresh.mjs';
import { openJournal } from '../src/event-journal.mjs';
import { beginTelemetry } from '../src/runner-telemetry.mjs';

let python;
try {
  python = execFileSync(
    'python',
    ['-c', 'import sqlite3,sys; c=sqlite3.connect(":memory:"); c.execute("create virtual table f using fts5(x)"); print(sys.executable)'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
  ).trim();
} catch {}
const testWithPython = (name, fn) => test(name, { skip: !python && 'Python with SQLite FTS5 is optional' }, fn);

async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'tl-refresh-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return { root, config: { observability: { enabled: true, root, python } }, inspectRoot: async () => ({ healthy: true }) };
}
testWithPython('sealed run becomes searchable and unchanged sources avoid a database rewrite', async t => {
  const f = await fixture(t),
    journal = await openJournal(f.config, { taskId: 'automatic-search', runId: 'fixture-run' }, { fixtureRoot: f.root });
  await journal.emit('run.finished', { status: 'completed' });
  const health = await journal.close(),
    day = path.basename(path.dirname(health.journalPath));
  const first = await refreshIndexDay(f.config, day, f);
  assert.equal(first.status, 'indexed');
  assert.equal(first.coverageComplete, true);
  assert.equal(first.indexedEvents, 1);
  const next = await refreshIndexDay(f.config, day, f);
  assert.equal(next.status, 'unchanged');
  assert.equal(next.databaseMtimeNs, first.databaseMtimeNs);
  assert.equal(next.indexedAt, first.indexedAt);
  const closed = await refreshClosedJournal(f.config, health.journalPath, f);
  assert.equal(closed.status, 'unchanged');
  assert.equal(closed.selection, day);
});
testWithPython('recovery scans only existing bounded UTC window and accepts an empty installation', async t => {
  const f = await fixture(t),
    observed = [];
  assert.equal((await refreshRecentIndexes(f.config, 8, f)).results.length, 0);
  for (const day of ['2026-10-01', '2026-11-04', '2026-11-05', '2026-11-06']) await fs.mkdir(path.join(f.root, 'journals', day), { recursive: true });
  const result = await refreshRecentIndexes(f.config, 2, {
    ...f,
    now: Date.parse('2026-11-05T00:01:00Z'),
    execute: async (_file, args) => {
      const day = args[args.indexOf('--day') + 1];
      observed.push(day);
      return { stdout: JSON.stringify({ schemaVersion: 1, selection: day, status: 'empty' }) };
    },
  });
  assert.deepEqual(observed, ['2026-11-05', '2026-11-04']);
  assert.equal(result.providerGenerationCalls, 0);
  await assert.rejects(refreshRecentIndexes(f.config, 31, f), /1..30/);
  const invalid = await refreshClosedJournal(f.config, path.join(f.root, 'outside.jsonl'), f);
  assert.equal(invalid.status, 'unavailable');
});
testWithPython('completion index follows known journal closure without changing execution status', async () => {
  const events = [],
    record = { status: 'failed', provider: 'codex' };
  const trace = await beginTelemetry({ observability: { enabled: true } }, record, {
    journalFactory: async () => ({
      emit: async type => {
        events.push(type);
      },
      close: async () => {
        events.push('closed');
        return { healthy: true, closed: true, closePending: false, journalPath: 'fixture' };
      },
    }),
    indexRefresh: async (_config, file) => {
      assert.equal(file, 'fixture');
      events.push('index');
      throw Error('private diagnostic');
    },
  });
  await trace.finish();
  assert.deepEqual(events, ['run.finished', 'closed', 'index']);
  assert.equal(record.status, 'failed');
  assert.equal(record.observability.index.status, 'unavailable');
  assert.equal(JSON.stringify(record).includes('private diagnostic'), false);
});
testWithPython('unknown closure defers indexing rather than indexing a falsely sealed run', async () => {
  const record = { status: 'completed' };
  let indexed = false;
  const trace = await beginTelemetry({ observability: { enabled: true } }, record, {
    journalFactory: async () => ({
      emit: async () => true,
      close: async () => ({ healthy: false, closed: false, closePending: true, journalPath: 'fixture' }),
    }),
    indexRefresh: async () => {
      indexed = true;
    },
  });
  await trace.finish();
  assert.equal(indexed, false);
  assert.equal(record.status, 'completed');
});
