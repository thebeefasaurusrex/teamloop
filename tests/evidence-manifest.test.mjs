import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { prepare, checkPacket, inspectEvidence, hash, run } from '../src/team-loop.mjs';
import { tempDir } from './helpers.mjs';
import { selectEvidence } from '../src/evidence-manifest.mjs';

const runner = fileURLToPath(new URL('../src/team-loop.mjs', import.meta.url));
async function fixture(t) {
  const root = await tempDir('teamloop-evidence-');
  await fs.writeFile(path.join(root, 'source.md'), 'Heading\nRequired fact\nRequired detail\nUnrelated appendix\n');
  const config = {
    schemaVersion: 1,
    stateRoot: path.join(root, 'state'),
    blockedLiterals: [],
    limits: { maxTaskTimeoutMs: 180000, maxRunsPerProviderPacket: 1 },
    providers: { mock: { enabled: true, models: { fixture: { efforts: ['default'], imageInput: false } } } },
  };
  const spec = {
    id: 'evidence-test',
    root,
    assignment: 'Review selected evidence',
    requirements: ['R1: required facts'],
    constraints: [],
    decisions: [],
    files: ['source.md'],
    dataClass: 'synthetic',
    evidenceManifest: { version: 1, required: [{ requirement: 'R1', path: 'source.md', lines: { startLine: 2, endLine: 3 } }] },
  };
  return { root, config, spec };
}
const load = async file => JSON.parse(await fs.readFile(file, 'utf8'));

test('full input records explicit hashes and exact required-line pointers', async t => {
  const { spec, config } = await fixture(t);
  const report = await inspectEvidence(spec, config);
  assert.equal(report.status, 'ready');
  assert.equal(report.manifestDeclared, true);
  assert.equal(report.covered, 1);
  assert.equal(report.sources[0].coverage, 'full');
  const packet = await load(await prepare(spec, config));
  assert.equal(packet.payload.evidenceManifest.required[0].sha256, packet.payload.sources[0].sha256);
  assert.deepEqual(packet.payload.evidenceManifest.required[0].lines, { startLine: 2, endLine: 3 });
  await checkPacket(packet);
});

test('manifest does not read or include an unselected required file even when it exists', async t => {
  const { root, spec, config } = await fixture(t);
  await fs.writeFile(path.join(root, 'not-selected.md'), 'Exists but not authorized for packet.');
  spec.evidenceManifest.required.push({ requirement: 'R2', path: 'not-selected.md' });
  const report = await inspectEvidence(spec, config);
  assert.equal(report.status, 'awaiting_evidence');
  assert.equal(report.findings[0].code, 'missing-required-input');
  assert.equal(report.findings[0].path, 'not-selected.md');
  assert.equal(report.sources.length, 1);
  await assert.rejects(prepare(spec, config), error => error.evidenceReport?.status === 'awaiting_evidence');
  await assert.rejects(fs.access(config.stateRoot), { code: 'ENOENT' });
});

test('missing selected file returns compact evidence gaps without a packet or provider', async t => {
  const { spec, config } = await fixture(t);
  spec.files.push('missing.md');
  const report = await inspectEvidence(spec, config);
  assert.equal(report.status, 'awaiting_evidence');
  assert.ok(report.findings.some(f => f.code === 'missing-file' && f.path === 'missing.md'));
  assert.equal(JSON.stringify(report).includes('Required fact'), false);
  await assert.rejects(prepare(spec, config), /missing-file/);
});

test('intentional slice preserves required facts, parent hash, coverage and original line numbers', async t => {
  const { spec, config } = await fixture(t);
  spec.sourceSlices = [{ path: 'source.md', startLine: 2, endLine: 3, reason: 'R1 needs facts; appendix omitted deliberately.' }];
  const packet = await load(await prepare(spec, config));
  const selected = packet.payload.sources[0];
  assert.equal(selected.content, 'Required fact\nRequired detail\n');
  assert.equal(selected.sha256, hash(selected.content));
  assert.notEqual(selected.originalSha256, selected.sha256);
  assert.equal(selected.coverage.omittedLines, 2);
  assert.equal(selected.coverage.startLine, 2);
  await checkPacket(packet);
});

test('full-file or uncovered-section requirements cannot be satisfied by smaller slices', async t => {
  const { spec, config } = await fixture(t);
  spec.sourceSlices = [{ path: 'source.md', startLine: 2, endLine: 2, reason: 'Too narrow.' }];
  assert.equal((await inspectEvidence(spec, config)).findings[0].code, 'missing-required-coverage');
  spec.evidenceManifest.required[0] = { requirement: 'R1', path: 'source.md' };
  assert.equal((await inspectEvidence(spec, config)).findings[0].code, 'missing-required-coverage');
  spec.sourceSlices[0].endLine = 99;
  assert.ok((await inspectEvidence(spec, config)).findings.some(f => f.code === 'missing-lines'));
});

test('known undeclared truncation markers block prepare, including manifest-free specs', async t => {
  const { root, spec, config } = await fixture(t);
  for (const marker of [
    'Warning: truncated output (original token count: 9000)',
    '[... 259,335 bytes truncated ...]',
    '…123 tokens truncated…',
    '[truncated]',
  ]) {
    await fs.writeFile(path.join(root, 'source.md'), 'Heading\n' + marker + '\n');
    const bare = { ...spec };
    delete bare.evidenceManifest;
    const report = await inspectEvidence(bare, config);
    assert.equal(report.status, 'awaiting_evidence', marker);
    assert.equal(report.findings[0].line, 2);
    await assert.rejects(prepare(bare, config), /truncated-source/);
  }
  await fs.writeFile(path.join(root, 'source.md'), 'The report discusses truncated output and token limits.\n');
  const bare = { ...spec };
  delete bare.evidenceManifest;
  assert.equal((await inspectEvidence(bare, config)).status, 'ready');
});

test('expected hashes fail on drift, including changes outside submitted slice', async t => {
  const { root, spec, config } = await fixture(t);
  spec.evidenceManifest.required[0].sha256 = '0'.repeat(64);
  assert.equal((await inspectEvidence(spec, config)).findings[0].code, 'source-drift');
  delete spec.evidenceManifest.required[0].sha256;
  spec.sourceSlices = [{ path: 'source.md', startLine: 2, endLine: 3, reason: 'Required section.' }];
  const packetFile = await prepare(spec, config);
  const packet = await load(packetFile);
  await fs.appendFile(path.join(root, 'source.md'), 'Outside-slice change.\n');
  await assert.rejects(checkPacket(packet), /Stale packet/);
  await assert.rejects(run(packetFile, 'mock', 'fixture', config), /Stale packet/);
  await assert.rejects(fs.access(path.join(config.stateRoot, 'runs')), { code: 'ENOENT' });
});

test('manifest missing requirements or forged coverage cannot pass a rehashed durable packet', async t => {
  const { spec, config } = await fixture(t);
  const packet = await load(await prepare(spec, config));
  packet.payload.evidenceManifest.required.push({ requirement: 'R2', path: 'omitted.md' });
  packet.packetHash = hash(packet.payload);
  await assert.rejects(checkPacket(packet), /missing-required-input/);
  const sliced = { ...spec, sourceSlices: [{ path: 'source.md', startLine: 2, endLine: 3, reason: 'Required.' }] };
  const selected = await load(await prepare({ ...sliced, id: 'sliced' }, config));
  selected.payload.sources[0].coverage.omittedLines = 0;
  selected.packetHash = hash(selected.payload);
  await assert.rejects(checkPacket(selected), /coverage integrity/);
});

test('inspect CLI prints compact gaps and exits nonzero without credentials or dispatch', async t => {
  const { root, spec, config } = await fixture(t);
  spec.evidenceManifest.required.push({ requirement: 'R2', path: 'omitted.md' });
  const specFile = path.join(root, 'spec.json'),
    configFile = path.join(root, 'config.json');
  await fs.writeFile(specFile, JSON.stringify(spec));
  await fs.writeFile(configFile, JSON.stringify(config));
  const result = spawnSync(process.execPath, [runner, 'inspect-evidence', specFile, configFile], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 1, result.stderr);
  assert.equal(JSON.parse(result.stdout).status, 'awaiting_evidence');
  assert.equal(result.stderr, '');
  await assert.rejects(fs.access(path.join(config.stateRoot, 'runs')), { code: 'ENOENT' });
});

test('invalid manifest, ranges and unselected slice configuration fail explicitly', () => {
  const inputs = [{ path: 'a', sha256: hash('a\n'), content: 'a\n' }];
  for (const spec of [
    { evidenceManifest: { version: 2, required: [] } },
    { evidenceManifest: { version: 1, required: [{ requirement: 'R1', path: 'a', sha256: 'bad' }] } },
    { sourceSlices: [{ path: 'a', startLine: 0, endLine: 1, reason: 'bad' }] },
    { sourceSlices: [{ path: 'outside', startLine: 1, endLine: 1, reason: 'bad' }] },
  ])
    assert.throws(() => selectEvidence(inputs, spec));
});
