import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { openJournal } from '../src/event-journal.mjs';
async function fixture(t, extra = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tl-journal-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const config = { observability: { enabled: true, root } };
  const journal = await openJournal(config, { taskId: 'safe-task', runId: 'safe-run', provider: 'codex' }, { fixtureRoot: root, ...extra });
  return { root, journal };
}
test('disabled mode writes nothing and returns nonthrowing booleans', async () => {
  const journal = await openJournal({});
  assert.equal(await journal.emit('worker.start'), false);
  assert.equal((await journal.close()).enabled, false);
});
test('invalid roots fail closed without raw errors', async () => {
  const journal = await openJournal({ observability: { enabled: true, root: 'relative' } });
  assert.equal(await journal.emit('worker.start'), false);
  assert.deepEqual(journal.health().errorCodes, ['invalid-root']);
});

test('ordinary task IDs with sk substring survive while actual token-shaped IDs are omitted visibly', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tl-journal-ids-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const taskId of ['task-1', 'risk-review', 'disk-cleanup', 'tokenizer-audit']) {
    const journal = await openJournal({ observability: { enabled: true, root } }, { taskId }, { fixtureRoot: root });
    await journal.emit('validation.local');
    const health = await journal.close();
    const event = JSON.parse((await fs.readFile(health.journalPath, 'utf8')).trim());
    assert.equal(event.taskId, taskId);
    assert.equal(health.coverageComplete, true);
  }
  const journal = await openJournal({ observability: { enabled: true, root } }, { taskId: 'sk-' + 'x'.repeat(20) }, { fixtureRoot: root });
  await journal.emit('validation.local');
  const health = await journal.close();
  const event = JSON.parse((await fs.readFile(health.journalPath, 'utf8')).trim());
  assert.equal(event.taskId, undefined);
  assert.equal(event.details.unknownFields, 1);
  assert.equal(health.coverageComplete, false);
});
test('sequence, producer, schema and private allowlist survive concurrent emit', async t => {
  const { journal } = await fixture(t);
  assert.ok(journal.health().healthy);
  const result = await Promise.all(
    Array.from({ length: 10 }, (_, index) =>
      journal.emit('worker.progress', {
        inputTokens: index,
        prompt: 'SECRET',
        raw: 'sk-secret',
        command: 'rm secrets',
        status: 'running',
        severity: 'warning',
      }),
    ),
  );
  assert.ok(result.every(Boolean));
  const health = await journal.close();
  assert.equal(health.written, 10);
  const content = await fs.readFile(health.journalPath, 'utf8');
  assert.ok(!content.includes('SECRET'));
  assert.ok(!content.includes('sk-secret'));
  const events = content.trim().split('\n').map(JSON.parse);
  assert.deepEqual(
    events.map(item => item.producerSeq),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  );
  assert.equal(new Set(events.map(item => item.producerId)).size, 1);
  assert.equal(events[0].severity, 'warning');
  const seal = JSON.parse(await fs.readFile(health.journalPath + '.closed', 'utf8'));
  assert.equal(seal.coverageComplete, true);
});
test('concurrent producers use different files', async t => {
  const { root, journal } = await fixture(t);
  const other = await openJournal({ observability: { enabled: true, root } }, { provider: 'claude' }, { fixtureRoot: root });
  await Promise.all([journal.emit('worker.start'), other.emit('worker.start')]);
  const [a, b] = await Promise.all([journal.close(), other.close()]);
  assert.notEqual(a.journalPath, b.journalPath);
});
test('slow storage bounds queue and exposes coverage gaps', async t => {
  let unblock;
  const pause = new Promise(resolve => {
    unblock = resolve;
  });
  const { journal } = await fixture(t, {
    write: async (file, line) => {
      await pause;
      await file.writeFile(line);
    },
  });
  const pending = Array.from({ length: 1000 }, () => journal.emit('worker.progress', { status: 'running' }));
  assert.ok(journal.health().dropped > 0);
  unblock();
  await Promise.all(pending);
  const health = await journal.close();
  assert.equal(health.coverageComplete, false);
  assert.ok(health.errorCodes.includes('queue-overflow'));
});
test('disk error does not reject emit and marks journal degraded', async t => {
  const { journal } = await fixture(t, {
    write: async () => {
      throw Object.assign(Error('PRIVATE PATH AND SECRET'), { code: 'ENOSPC' });
    },
  });
  assert.equal(await journal.emit('worker.start'), false);
  assert.equal(journal.health().healthy, false);
  assert.deepEqual(journal.health().errorCodes, ['write-failed']);
  assert.ok(!JSON.stringify(journal.health()).includes('PRIVATE'));
  await journal.close();
});
test('stalled writes bound exposed waits and later cleanup does not seal unknown coverage', async t => {
  let unblock;
  const pause = new Promise(resolve => {
    unblock = resolve;
  });
  const { journal } = await fixture(t, {
    waitMs: 20,
    write: async (file, line) => {
      await pause;
      await file.writeFile(line);
    },
  });
  assert.equal(await journal.emit('worker.start'), false);
  const health = await journal.close();
  assert.equal(health.closePending, true);
  assert.equal(health.closed, false);
  assert.equal(health.coverageComplete, false);
  unblock();
  for (let i = 0; i < 50 && journal.health().closePending; i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(journal.health().closed, true);
  await assert.rejects(fs.access(health.journalPath + '.closed'));
});
test('rejected values cannot inject raw payloads', async t => {
  const { journal } = await fixture(t);
  await journal.emit('usage.observed', {
    status: 'Bearer-secret',
    inputTokens: -1,
    totalTokens: null,
    thinkingTokens: 1.5,
    success: 'true',
    accountingMode: 'subscription',
  });
  const health = await journal.close(),
    event = JSON.parse((await fs.readFile(health.journalPath, 'utf8')).trim());
  assert.deepEqual(event.details, { accountingMode: 'subscription', totalTokens: null });
});
test('close is idempotent and later emits visibly lose coverage', async t => {
  const { journal } = await fixture(t);
  await journal.emit('worker.start');
  await journal.close();
  await journal.close();
  assert.equal(await journal.emit('worker.end'), false);
  assert.ok(journal.health().errorCodes.includes('emit-after-close'));
});
test('junction or symlink partition is rejected', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tl-journal-link-')),
    target = await fs.mkdtemp(path.join(os.tmpdir(), 'tl-journal-target-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  t.after(() => fs.rm(target, { recursive: true, force: true }));
  try {
    await fs.symlink(target, path.join(root, 'journals'), process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    t.skip('symlink privilege unavailable');
    return;
  }
  const journal = await openJournal({ observability: { enabled: true, root } }, {}, { fixtureRoot: root });
  assert.equal(journal.health().healthy, false);
});
