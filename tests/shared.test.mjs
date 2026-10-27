import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { acquireLock, execute, redact, safeText, scanStrings } from '../src/shared.mjs';
import { classifyFailure, decode, prepare } from '../src/team-loop.mjs';
import { tempDir } from './helpers.mjs';

const review = { packetHash: 'abc', verdict: 'approve', summary: 'Fixture only', findings: [], uncertainties: [] };

test('execute screens raw EOF stdout once before redaction and contains callback failures', async () => {
  const token = 'sk-' + 'x'.repeat(100);
  for (const ending of ['', '\n']) {
    const seen = [];
    const result = await execute(process.execPath, ['-e', 'process.stdout.write(' + JSON.stringify(token + ending) + ')'], {
      onStdoutLine: line => seen.push(line),
    });
    assert.deepEqual(seen, [token]);
    assert.equal(result.stopped, null);
    assert.equal(result.stdout, '[REDACTED]' + ending);
  }
  for (const [message, expected] of [
    ['invalid receipt', 'worker-policy-violation'],
    ['model/provider mismatch', 'worker-provider-error'],
  ]) {
    const result = await execute(process.execPath, ['-e', 'process.stdout.write("malformed-tail")'], {
      onStdoutLine: () => {
        throw Error(message);
      },
    });
    assert.equal(result.stopped, expected);
    assert.equal(result.policyError, message);
  }
});

test('execute keeps timeout and output-limit precedence without screening interrupted EOF tails', async () => {
  const cancelFile = path.join(await tempDir('teamloop-eof-cancel-'), 'cancel');
  await fs.writeFile(cancelFile, 'cancel');
  for (const [script, options, expected] of [
    ['process.stdout.write("partial");setTimeout(()=>{},5000)', { timeoutMs: 500 }, 'timeout'],
    ['process.stdout.write("partial");setTimeout(()=>{},5000)', { cancelFile }, 'cancelled'],
    ['process.stdout.write("x".repeat(1000))', { maxBytes: 10 }, 'output-limit'],
  ]) {
    let calls = 0;
    const result = await execute(process.execPath, ['-e', script], {
      ...options,
      onStdoutLine: () => {
        calls++;
        throw Error('tail must not replace stop');
      },
    });
    assert.equal(result.stopped, expected);
    assert.equal(result.policyError, null);
    assert.equal(calls, 0);
  }
});

test('screening errors name the pattern and the file or field that tripped it', async () => {
  assert.throws(() => safeText('password="a-real-secret"', [], 'brief.md'), /credential assignment.* in brief\.md/);
  assert.throws(() => safeText('-----BEGIN PRIVATE KEY-----', [], 'keys.txt'), /private key block.* in keys\.txt/);
  assert.throws(() => safeText('contact excluded@example.test', ['excluded@example.test'], 'assignment'), /configured blocked literal in assignment/);
  assert.throws(() => scanStrings({ requirements: ['fine', 'api_key="synthetic-secret-value"'] }), /credential assignment.* in requirements\[1\]/);
  const root = await tempDir('teamloop-shared-');
  await fs.writeFile(path.join(root, 'fine.md'), 'Ordinary evidence.');
  await fs.writeFile(path.join(root, 'leaky.md'), 'token: nvapi-' + 'x'.repeat(30));
  const config = {
    schemaVersion: 1,
    stateRoot: path.join(root, 'state'),
    blockedLiterals: [],
    limits: { maxTaskTimeoutMs: 180000, maxRunsPerProviderPacket: 1 },
    providers: {},
  };
  const spec = { id: 'label-test', root, assignment: 'Review', requirements: [], constraints: [], decisions: [], files: ['fine.md', 'leaky.md'] };
  await assert.rejects(prepare(spec, config), /provider token.* in leaky\.md/);
});

test('redaction is null-safe and still masks tokens and credential assignments', () => {
  assert.equal(redact(undefined), '');
  assert.equal(redact(null), '');
  assert.equal(redact('key nvapi-' + 'x'.repeat(30) + ' end'), 'key [REDACTED] end');
  assert.equal(redact('"api_key": "supersecretvalue"'), '"api_key": "[REDACTED]"');
});

test('a held provider lock reports its holder instead of a raw EEXIST', async () => {
  const lock = path.join(await tempDir('teamloop-lock-'), 'locks', 'mock.lock');
  const release = await acquireLock(lock, 'Provider mock', { runId: 'first-run', runnerPid: 4242 });
  await assert.rejects(
    acquireLock(lock, 'Provider mock', { runId: 'second-run', runnerPid: 4343 }),
    /Provider mock is busy: lock held by run first-run \(runner PID 4242\)/,
  );
  await release();
  const again = await acquireLock(lock, 'Provider mock', { runId: 'third-run', runnerPid: 1 });
  await again();
});

test('failure classification puts account and budget refusals before provider-name matches', () => {
  assert.equal(classifyFailure('Claude must use the personal paid subscription'), 'authentication');
  assert.equal(classifyFailure('Claude overflow-off check must be in the preceding 24 hours'), 'authentication');
  assert.equal(classifyFailure('Codex personal login required'), 'authentication');
  assert.equal(classifyFailure('Per-provider packet attempt budget exhausted; no automatic retry'), 'attempt-budget');
  assert.equal(classifyFailure('Unexpected Claude tool activity'), 'policy');
  assert.equal(classifyFailure('Codex reported failure'), 'model-or-provider');
  assert.equal(classifyFailure('Invalid or mismatched review'), 'output-contract');
  assert.equal(classifyFailure('timeout'), 'timeout');
});

test('Claude decoding accepts a pretty-printed single envelope and a stream-json event list', () => {
  const envelope = { type: 'result', subtype: 'success', num_turns: 1, result: JSON.stringify(review) };
  assert.deepEqual(decode('claude', JSON.stringify(envelope, null, 2), 'abc').review, review);
  const stream = [{ type: 'system', subtype: 'init' }, { type: 'assistant', message: { content: [{ type: 'text', text: 'working' }] } }, envelope]
    .map(JSON.stringify)
    .join('\n');
  assert.deepEqual(decode('claude', stream, 'abc').review, review);
  assert.throws(() => decode('claude', '[]', 'abc'));
  assert.throws(() => decode('unknown-transport', '{}', 'abc'), /Unsupported provider transport/);
});

test('execute checks fast-child watch logs at close without terminating an exited PID', async () => {
  const root = await tempDir('teamloop-watch-close-');
  const watchFile = path.join(root, 'watch.log');
  const originalSpawn = childProcess.spawn;
  let exited = false;
  let postExitKills = 0;
  childProcess.spawn = (...args) => {
    if (exited && /taskkill/i.test(args[0])) postExitKills++;
    const child = originalSpawn(...args);
    if (args[0] === process.execPath)
      child.once('exit', () => {
        exited = true;
      });
    return child;
  };
  syncBuiltinESMExports();
  try {
    const token = 'nvapi-' + 'x'.repeat(30);
    const result = await execute(process.execPath, ['-e', `require('node:fs').writeFileSync(${JSON.stringify(watchFile)}, 'forbidden');`], {
      watchFile,
      checkWatchText: text => {
        assert.equal(text, 'forbidden');
        throw Error('rejected ' + token);
      },
    });
    assert.equal(result.code, 0);
    assert.equal(result.stopped, 'worker-policy-violation');
    assert.equal(result.policyError, 'rejected [REDACTED]');
    assert.equal(postExitKills, 0);
  } finally {
    childProcess.spawn = originalSpawn;
    syncBuiltinESMExports();
  }
});

test('execute settles an in-flight watch read and checks the final appended log before returning', async () => {
  const root = await tempDir('teamloop-watch-inflight-');
  const watchFile = path.join(root, 'watch.log');
  await fs.writeFile(watchFile, 'initial');
  const originalRead = fs.readFile;
  let release;
  const closing = new Promise(resolve => {
    release = resolve;
  });
  let reads = 0;
  let checks = 0;
  fs.readFile = async (...args) => {
    if (args[0] !== watchFile) return originalRead(...args);
    reads++;
    if (reads === 1) {
      // Snapshot before the append, but keep this poll outstanding beyond close.
      const snapshot = await originalRead(...args);
      await closing;
      await new Promise(resolve => setTimeout(resolve, 100));
      return snapshot;
    }
    return originalRead(...args);
  };
  try {
    const script = `setTimeout(()=>{require('node:fs').appendFileSync(${JSON.stringify(watchFile)}, ' forbidden');console.log('closing');},450);`;
    const result = await execute(process.execPath, ['-e', script], {
      watchFile,
      onStdoutLine: () => release(),
      checkWatchText: text => {
        checks++;
        if (text.includes('forbidden')) throw Error('final log rejected');
      },
    });
    assert.ok(reads >= 2);
    assert.equal(result.stopped, 'worker-policy-violation');
    assert.equal(result.policyError, 'final log rejected');
    const counts = [reads, checks];
    await new Promise(resolve => setTimeout(resolve, 300));
    assert.deepEqual([reads, checks], counts, 'no poll mutates state after resolution');
  } finally {
    release();
    fs.readFile = originalRead;
  }
});

test('execute contains final watch read/callback failures, tolerates absence, and preserves earlier stops', async () => {
  const root = await tempDir('teamloop-watch-errors-');
  const absent = path.join(root, 'absent');
  const noWatch = await execute(process.execPath, ['-e', ''], { watchFile: absent, checkWatchText: () => assert.fail('absent file') });
  assert.equal(noWatch.stopped, null);
  const directory = await execute(process.execPath, ['-e', ''], { watchFile: root, checkWatchText: () => assert.fail('directory') });
  assert.equal(directory.stopped, 'worker-policy-violation');
  await fs.writeFile(absent, 'blocked');
  const callbackFailure = await execute(process.execPath, ['-e', ''], {
    watchFile: absent,
    checkWatchText: () => {
      throw null;
    },
  });
  assert.equal(callbackFailure.stopped, 'worker-policy-violation');
  assert.equal(callbackFailure.policyError, 'null');
  const cancelFile = path.join(root, 'cancel');
  await fs.writeFile(cancelFile, 'cancel');
  for (const [script, options, expected] of [
    ['setTimeout(()=>{},5000)', { timeoutMs: 60 }, 'timeout'],
    ['setTimeout(()=>{},5000)', { cancelFile }, 'cancelled'],
    ['process.stdout.write("x".repeat(1000))', { maxBytes: 10 }, 'output-limit'],
    [
      'console.log("bad receipt")',
      {
        onStdoutLine: () => {
          throw Error('original receipt failure');
        },
      },
      'worker-policy-violation',
    ],
    [
      'process.stdout.write("bad EOF")',
      {
        onStdoutLine: () => {
          throw Error('model/provider mismatch');
        },
      },
      'worker-provider-error',
    ],
  ]) {
    const result = await execute(process.execPath, ['-e', script], {
      ...options,
      watchFile: absent,
      checkWatchText: () => {
        throw Error('later watch failure');
      },
    });
    assert.equal(result.stopped, expected);
    assert.equal(
      result.policyError,
      expected === 'worker-policy-violation' ? 'original receipt failure' : expected === 'worker-provider-error' ? 'model/provider mismatch' : null,
    );
  }
});

test('execute fails closed on stalled watch and cancel probes and ignores their late results', async () => {
  const root = await tempDir('teamloop-watch-stall-');
  const watchFile = path.join(root, 'watch.log');
  await fs.writeFile(watchFile, 'allowed');
  const originalRead = fs.readFile;
  const originalAccess = fs.access;
  let releaseRead;
  let releaseAccess;
  let checks = 0;
  fs.readFile = (...args) =>
    args[0] === watchFile
      ? new Promise(resolve => {
          releaseRead = resolve;
        })
      : originalRead(...args);
  try {
    const started = Date.now();
    const result = await execute(process.execPath, ['-e', ''], {
      watchFile,
      checkWatchText: () => {
        checks++;
      },
    });
    assert.equal(result.stopped, 'worker-policy-violation');
    assert.match(result.policyError, /timed out after 1000 ms/);
    assert.ok(Date.now() - started < 4000, 'stalled final read has a finite deadline');
    releaseRead('allowed');
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(checks, 0);
    fs.access = (...args) =>
      args[0] === watchFile
        ? new Promise(resolve => {
            releaseAccess = resolve;
          })
        : originalAccess(...args);
    const cancelled = await execute(process.execPath, ['-e', 'setTimeout(()=>{},450)'], { cancelFile: watchFile });
    assert.equal(cancelled.stopped, 'cancel-check-failed');
    releaseAccess();
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(cancelled.stopped, 'cancel-check-failed');
  } finally {
    fs.readFile = originalRead;
    fs.access = originalAccess;
  }
});
