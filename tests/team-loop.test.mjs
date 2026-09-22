import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  hash,
  safeText,
  contained,
  readSource,
  readImage,
  prepare,
  checkPacket,
  cleanEnv,
  execute,
  validateResponse,
  validateArtifact,
  outputSchema,
  decode,
  run,
  recentAttestation,
  workerFailure,
  assertImageTransport,
} from '../src/team-loop.mjs';
import { tempDir } from './helpers.mjs';

const temp = await tempDir('team-loop-tests-');
const root = path.join(temp, 'project');
await fs.mkdir(root);
await fs.writeFile(path.join(root, 'brief.md'), 'A small synthetic task.\n');
const config = {
  schemaVersion: 1,
  stateRoot: path.join(temp, 'state'),
  blockedLiterals: ['excluded@example.test'],
  limits: { maxTaskTimeoutMs: 900000, maxRunsPerProviderPacket: 1 },
  providers: {
    mock: { enabled: true, models: { fixture: { efforts: ['default'], imageInput: false } } },
    codex: { enabled: true, allowedAccounts: ['operator@example.test'], models: { 'example-coder': { efforts: ['default', 'high'], imageInput: false } } },
  },
};
const spec = { id: 'test', root, assignment: 'Review', requirements: ['R1: evidence'], constraints: ['no tools'], decisions: [], files: ['brief.md'] };
const packetFile = await prepare(spec, config);
const packet = JSON.parse(await fs.readFile(packetFile, 'utf8'));
const review = { packetHash: packet.packetHash, verdict: 'approve', summary: 'Meets the provided requirement.', findings: [], uncertainties: [] };
const artifactPacketFile = await prepare({ ...spec, id: 'artifact-test', kind: 'artifact', assignment: 'Create HTML', maxArtifactBytes: 262144 }, config);
const artifactPacket = JSON.parse(await fs.readFile(artifactPacketFile, 'utf8'));
const artifact = {
  packetHash: artifactPacket.packetHash,
  artifact: { filename: 'example.html', mediaType: 'text/html', content: '<!doctype html><html><body><button>Works</button></body></html>' },
  rationale: 'A functional minimal example.',
  uncertainties: [],
};

test('explicit file packet has stable content hash', async () => {
  await checkPacket(packet);
  assert.equal(await prepare(spec, config), packetFile);
});
test('task timeout is packet-bound, defaulted, and capped', async () => {
  assert.equal(packet.payload.timeoutMs, 180000);
  const deep = JSON.parse(await fs.readFile(await prepare({ ...spec, id: 'deep-timeout', timeoutMs: 720000 }, config), 'utf8'));
  assert.equal(deep.payload.timeoutMs, 720000);
  for (const timeoutMs of [29999, 900001, 720000.5, '720000']) await assert.rejects(prepare({ ...spec, id: 'bad-timeout', timeoutMs }, config), /timeout/);
});
test('artifact byte ceiling is disclosed, packet-bound, and enforced', async () => {
  assert.equal(artifactPacket.payload.maxArtifactBytes, 262144);
  assert.doesNotThrow(() => validateArtifact(artifact, artifactPacket.packetHash, 262144));
  assert.throws(
    () =>
      validateArtifact(
        { ...artifact, artifact: { ...artifact.artifact, content: '<!doctype html><html><body>' + 'x'.repeat(20000) + '</body></html>' } },
        artifactPacket.packetHash,
        16384,
      ),
    /disclosed/,
  );
  for (const maxArtifactBytes of [16383, 1048577, 32768.5, '32768'])
    await assert.rejects(prepare({ ...spec, id: 'bad-artifact-limit', kind: 'artifact', maxArtifactBytes }, config), /byte limit/);
  await assert.rejects(prepare({ ...spec, id: 'review-with-artifact-limit', maxArtifactBytes: 32768 }, config), /only for artifact/);
});
test('UTF-8 BOM input survives exact-byte packet integrity and staleness checks', async () => {
  await fs.writeFile(path.join(root, 'bom.md'), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('Valid text.\n')]));
  const prepared = JSON.parse(await fs.readFile(await prepare({ ...spec, id: 'bom', files: ['bom.md'] }, config), 'utf8'));
  assert.equal(prepared.payload.sources[0].content.charCodeAt(0), 0xfeff);
  await checkPacket(prepared);
  await fs.writeFile(path.join(root, 'bom.md'), 'Valid text.\n');
  await assert.rejects(checkPacket(prepared), /Stale/);
});
test('identical tasks in distinct roots do not reuse the wrong project', async () => {
  const second = path.join(temp, 'second');
  await fs.mkdir(second);
  await fs.writeFile(path.join(second, 'brief.md'), 'A small synthetic task.\n');
  const secondFile = await prepare({ ...spec, root: second }, config);
  assert.notEqual(secondFile, packetFile);
  const secondPacket = JSON.parse(await fs.readFile(secondFile, 'utf8'));
  assert.equal(secondPacket.root, second);
  await checkPacket(secondPacket);
  await assert.rejects(checkPacket({ ...packet, root: second }), /root integrity/);
});
test('legacy packets require explicit repreparation, not a silent compatibility fallback', async () => {
  const legacy = structuredClone(packet);
  legacy.payload.version = 2;
  legacy.packetHash = hash(legacy.payload);
  await assert.rejects(checkPacket(legacy), /Old packet/);
});
test('reject path traversal and broad or secret paths', async () => {
  assert.equal(contained(root, path.join(root, '..', 'other')), false);
  for (const file of ['../outside.md', '.env', 'auth.json', 'C:\\secrets.txt']) await assert.rejects(readSource(root, file));
  await assert.rejects(prepare({ ...spec, root: os.homedir() }, config));
});
test('reject symlink escape', async () => {
  const outside = path.join(temp, 'outside');
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, 'file.md'), 'not allowed');
  await fs.symlink(outside, path.join(root, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(readSource(root, 'link/file.md'), /escapes/);
});
test('reject forbidden account and likely secrets', () => {
  assert.throws(() => safeText('excluded@example.test', config.blockedLiterals));
  assert.throws(() => safeText('-----BEGIN PRIVATE KEY-----'));
  assert.throws(() => safeText('password="a-real-secret"'));
});
test('reject stale and tampered packets', async () => {
  await assert.rejects(checkPacket({ ...packet, packetHash: 'wrong' }));
  const altered = structuredClone(packet);
  altered.payload.sources[0].content = 'changed';
  altered.packetHash = hash(altered.payload);
  await assert.rejects(checkPacket(altered), /integrity/);
  await fs.writeFile(path.join(root, 'brief.md'), 'New revision');
  await assert.rejects(checkPacket(packet), /Stale/);
  await fs.writeFile(path.join(root, 'brief.md'), 'A small synthetic task.\n');
});
test('reject malformed, empty, mismatched and failed responses', () => {
  assert.throws(() => validateResponse({ ...review, summary: '' }, packet.packetHash));
  assert.throws(() => validateResponse({ ...review, packetHash: 'wrong' }, packet.packetHash));
  assert.throws(() => decode('claude', '', packet.packetHash));
  assert.throws(() => decode('claude', '{}', packet.packetHash));
  assert.throws(() => decode('claude', JSON.stringify({ is_error: true, result: JSON.stringify(review) }), packet.packetHash));
  assert.deepEqual(
    decode('claude', JSON.stringify({ type: 'result', subtype: 'success', num_turns: 1, result: JSON.stringify(review) }), packet.packetHash).review,
    review,
  );
});
test('artifact packets decode complete self-contained HTML and reject unsafe output', () => {
  assert.equal(artifactPacket.payload.kind, 'artifact');
  assert.deepEqual(
    decode(
      'claude',
      JSON.stringify({ type: 'result', subtype: 'success', num_turns: 1, result: JSON.stringify(artifact) }),
      artifactPacket.packetHash,
      null,
      'artifact',
      artifactPacket.payload.maxArtifactBytes,
    ).review,
    artifact,
  );
  assert.throws(() => validateArtifact({ ...artifact, artifact: { ...artifact.artifact, filename: '../bad.html' } }, artifactPacket.packetHash));
  assert.throws(
    () => validateArtifact({ ...artifact, artifact: { ...artifact.artifact, content: '<!doctype html><html><body>truncated' } }, artifactPacket.packetHash),
    /Invalid artifact/,
  );
  assert.throws(
    () =>
      validateArtifact(
        {
          ...artifact,
          artifact: { ...artifact.artifact, content: '<!doctype html><html><body><script src="https://bad.example/x.js"></script></body></html>' },
        },
        artifactPacket.packetHash,
      ),
    /self-contained/,
  );
});
test('output schemas bind the packet hash and reject extra properties', () => {
  const reviewSchema = outputSchema('review', packet.packetHash);
  const artifactSchema = outputSchema('artifact', artifactPacket.packetHash);
  assert.equal(reviewSchema.properties.packetHash.const, packet.packetHash);
  assert.equal(artifactSchema.properties.artifact.properties.mediaType.const, 'text/html');
  assert.equal(reviewSchema.additionalProperties, false);
  assert.equal(artifactSchema.properties.artifact.additionalProperties, false);
});
test('Claude accepts schema-normalization turns and rejects incomplete or tool-active results', () => {
  const envelope = { type: 'result', subtype: 'success', num_turns: 1, result: JSON.stringify(review) };
  assert.deepEqual(
    decode('claude', JSON.stringify({ ...envelope, num_turns: 2, stop_reason: 'tool_use', terminal_reason: 'completed' }), packet.packetHash).review,
    review,
  );
  for (const change of [
    { type: 'message' },
    { subtype: 'error_max_turns' },
    { num_turns: 0 },
    { terminal_reason: 'model_error' },
    { usage: { server_tool_use: { web_search_requests: 1 } } },
    { permission_denials: [{ tool_name: 'Read' }] },
  ])
    assert.throws(() => decode('claude', JSON.stringify({ ...envelope, ...change }), packet.packetHash));
});
test('overflow attestation accepts only the preceding 24 hours, never future dates', () => {
  const now = Date.parse('2026-09-04T12:00:00Z');
  assert.equal(recentAttestation('2026-09-04T11:00:00Z', now), true);
  for (const value of ['invalid', '2026-09-04T12:00:01Z', '2026-09-03T11:59:59Z']) assert.equal(recentAttestation(value, now), false);
});
test('reject unexpected model tool activity', () => {
  assert.throws(() => decode('gemini', JSON.stringify({ response: JSON.stringify(review), stats: { tools: { totalCalls: 1 } } }), packet.packetHash));
  assert.throws(() => decode('codex', JSON.stringify({ type: 'item.completed', item: { type: 'command_execution' } }), packet.packetHash));
});
test('expected disabled-tool startup notice is retained, unrelated errors reject', () => {
  const warning = {
    type: 'item.completed',
    item: {
      type: 'error',
      message:
        'Code Mode is unavailable because code-mode host is disabled. Code mode will fail closed; enable `features.code_mode_host` and install `codex-code-mode-host`.',
    },
  };
  const answer = { type: 'item.completed', item: { type: 'agent_message', text: JSON.stringify(review) } };
  const completed = { type: 'turn.completed', usage: { input_tokens: 10 } };
  assert.equal(decode('codex', [warning, answer, completed].map(JSON.stringify).join('\n'), packet.packetHash).warnings.length, 1);
  warning.item.message = 'Unexpected provider problem';
  assert.throws(() => decode('codex', [warning, answer, completed].map(JSON.stringify).join('\n'), packet.packetHash));
});
test('truncated successful-looking Codex stream is not a completed review', () => {
  const answer = { type: 'item.completed', item: { type: 'agent_message', text: JSON.stringify(review) } };
  assert.throws(() => decode('codex', JSON.stringify(answer), packet.packetHash), /terminal/);
});
test('image packets bind verified image bytes and reject stale or mislabeled media', async () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  await fs.writeFile(path.join(root, 'picture.png'), png);
  const file = await prepare({ ...spec, id: 'image-test', images: ['picture.png'], dataClass: 'public' }, config);
  const prepared = JSON.parse(await fs.readFile(file, 'utf8'));
  assert.equal(prepared.payload.version, 4);
  assert.equal(prepared.payload.images[0].mediaType, 'image/png');
  assert.equal((await readImage(root, 'picture.png')).sha256, prepared.payload.images[0].sha256);
  await checkPacket(prepared);
  await fs.writeFile(path.join(root, 'picture.png'), Buffer.concat([png, Buffer.from([4])]));
  await assert.rejects(checkPacket(prepared), /Stale/);
  await fs.writeFile(path.join(root, 'fake.jpg'), png);
  await assert.rejects(readImage(root, 'fake.jpg'), /mislabeled/);
});
test('image transports fail closed and NVIDIA uses the empirically verified payload ceiling', () => {
  const imagePacket = { payload: { images: [{ sizeBytes: 1000 }] } };
  assert.doesNotThrow(() => assertImageTransport('claude', imagePacket));
  assert.doesNotThrow(() => assertImageTransport('nvidia', imagePacket));
  assert.throws(() => assertImageTransport('gemini', imagePacket), /no verified native image/);
  assert.throws(() => assertImageTransport('nvidia', { payload: { images: [{ sizeBytes: 2097153 }] } }), /2 MiB/);
});
test('child environment excludes provider keys, redirects and proxy settings', () => {
  assert.deepEqual(
    cleanEnv({
      PATH: 'ok',
      ANTHROPIC_API_KEY: 'secret',
      OPENAI_API_KEY: 'secret',
      GOOGLE_API_KEY: 'secret',
      ANTHROPIC_BASE_URL: 'bad',
      HTTP_PROXY: 'bad',
      NODE_OPTIONS: 'bad',
      GEMINI_CLI_HOME: 'bad',
    }),
    { PATH: 'ok' },
  );
});
test('process wrapper uses stdin without shell interpolation', async () => {
  const text = 'hello "world" & echo no; $(no)';
  const result = await execute(process.execPath, ['-e', 'process.stdin.pipe(process.stdout)'], { cwd: root, env: cleanEnv(), input: text });
  assert.equal(result.code, 0);
  assert.equal(result.stdout, text);
});
test('nonzero exits and stderr remain observable', async () => {
  const result = await execute(process.execPath, ['-e', 'console.error("fixture failure");process.exit(3)'], { cwd: root, env: cleanEnv() });
  assert.equal(result.code, 3);
  assert.match(result.stderr, /fixture failure/);
  assert.equal(workerFailure(result), 'Worker exited 3: fixture failure');
  assert.equal(workerFailure({ ...result, stderr: 'nvapi-secret', policyError: 'worker-policy-violation' }), 'worker-policy-violation');
});
test('timeouts and output limits terminate owned child', async () => {
  const timeout = await execute(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { cwd: root, env: cleanEnv(), timeoutMs: 100 });
  assert.equal(timeout.stopped, 'timeout');
  const large = await execute(process.execPath, ['-e', 'console.log("x".repeat(10000))'], { cwd: root, env: cleanEnv(), maxBytes: 100 });
  assert.equal(large.stopped, 'output-limit');
});
test('cancellation marker terminates owned child', async () => {
  const marker = path.join(temp, 'cancel.request');
  await fs.writeFile(marker, 'cancel');
  const result = await execute(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { cwd: root, env: cleanEnv(), cancelFile: marker });
  assert.equal(result.stopped, 'cancelled');
});
test('policy and unknown-model gates happen before authentication', async () => {
  await assert.rejects(run(packetFile, 'unconfigured', 'example', config), /not enabled/);
  await assert.rejects(run(packetFile, 'gemini', 'example', config), /not enabled/);
  await assert.rejects(run(packetFile, 'codex', 'imaginary-model', config), /Unsupported/);
  await assert.rejects(run(packetFile, 'codex', 'example-coder', config, 'ultra'), /Unsupported reasoning effort/);
  const apiConfig = {
    ...config,
    allowApiSpend: true,
    providers: { nvidia: { enabled: true, models: { 'example/model': { efforts: ['default'], imageInput: false } } } },
  };
  await assert.rejects(run(packetFile, 'nvidia', 'example/model', apiConfig), /public or synthetic/);
});
