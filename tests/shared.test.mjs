import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { acquireLock, redact, safeText, scanStrings } from '../src/shared.mjs';
import { classifyFailure, decode, prepare } from '../src/team-loop.mjs';
import { tempDir } from './helpers.mjs';

const review = { packetHash: 'abc', verdict: 'approve', summary: 'Fixture only', findings: [], uncertainties: [] };

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
