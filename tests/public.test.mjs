import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { prepare, run, safeText, redact, hash, loadImages, decode, validateResponse, validateArtifact, statuses } from '../src/team-loop.mjs';
import { loadConfig, validateConfig, resolveModel } from '../src/config.mjs';
import { route } from '../src/route.mjs';
import { tempDir } from './helpers.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
async function fixture() {
  const root = await tempDir('teamloop-public-');
  const stateRoot = path.join(root, 'state');
  await fs.writeFile(path.join(root, 'brief.md'), 'Synthetic evidence.');
  const config = {
    schemaVersion: 1,
    stateRoot,
    blockedLiterals: [],
    limits: { maxTaskTimeoutMs: 180000, maxRunsPerProviderPacket: 1 },
    providers: { mock: { enabled: true, models: { fixture: { efforts: ['default'], imageInput: false } } } },
  };
  const spec = {
    id: 'public-test',
    root,
    assignment: 'Review supplied evidence',
    requirements: ['R1'],
    constraints: [],
    decisions: [],
    files: ['brief.md'],
    dataClass: 'synthetic',
  };
  return { root, config, spec, packet: await prepare(spec, config) };
}
test('no-network runner completes a real child-process round trip and records unknown usage', async () => {
  const { config, packet } = await fixture();
  const record = await run(packet, 'mock', 'fixture', config);
  assert.equal(record.status, 'completed');
  assert.equal(record.verdict, 'blocked');
  assert.equal(record.usage, null);
  const saved = JSON.parse(await fs.readFile(path.join(config.stateRoot, 'runs', record.runId, 'status.json'), 'utf8'));
  assert.equal(saved.packetHash, record.packetHash);
  assert.deepEqual(await fs.readdir(path.join(config.stateRoot, 'locks')), []);
});
test('attempt cap prevents another worker start and preserves the refusal', async () => {
  const { config, packet } = await fixture();
  await run(packet, 'mock', 'fixture', config);
  const second = await run(packet, 'mock', 'fixture', config);
  assert.equal(second.status, 'failed');
  assert.match(second.error, /budget exhausted/);
  assert.equal(second.exitCode, undefined);
  assert.deepEqual(await fs.readdir(path.join(config.stateRoot, 'locks')), []);
});
test('concurrent same-provider dispatch cannot double spend the packet budget', async () => {
  const { config, packet } = await fixture();
  const results = await Promise.allSettled([run(packet, 'mock', 'fixture', config), run(packet, 'mock', 'fixture', config)]);
  assert.equal(results.filter(r => r.status === 'fulfilled' && r.value.status === 'completed').length, 1);
  assert.ok(results.some(r => r.status === 'rejected' || r.value.status === 'failed'));
});
test('invalid packet timeout is rejected before leaving a lock behind', async () => {
  const { config, packet } = await fixture();
  const invalid = JSON.parse(await fs.readFile(packet, 'utf8'));
  invalid.payload.timeoutMs = 900001;
  invalid.packetHash = hash(invalid.payload);
  await fs.writeFile(packet, JSON.stringify(invalid));
  await assert.rejects(run(packet, 'mock', 'fixture', config), /timeout/);
  await assert.rejects(fs.access(path.join(config.stateRoot, 'locks', 'mock.lock')), /ENOENT/);
});
test('mock artifact is delivered but never auto-opened or confused with generated design', async () => {
  const { config, spec } = await fixture();
  const packet = await prepare({ ...spec, kind: 'artifact' }, config);
  const record = await run(packet, 'mock', 'fixture', config);
  assert.equal(record.status, 'completed');
  assert.match(await fs.readFile(path.join(config.stateRoot, 'runs', record.runId, record.artifact), 'utf8'), /not model output/);
});
test('a malformed provider setup fails observably and releases its own lock', async () => {
  const { config, packet } = await fixture();
  config.providers.codex = { enabled: true, allowedAccounts: ['operator@example.test'], models: { example: { efforts: ['default'], imageInput: false } } };
  config.codexHome = path.join(config.stateRoot, 'absent-auth');
  const record = await run(packet, 'codex', 'example', config);
  assert.equal(record.status, 'failed');
  assert.deepEqual(await fs.readdir(path.join(config.stateRoot, 'locks')), []);
});
test('configured blocked literals apply at preparation and again before dispatch', async () => {
  const { config, spec, packet } = await fixture();
  config.blockedLiterals = ['synthetic evidence'];
  await assert.rejects(prepare(spec, config), /Excluded/);
  await assert.rejects(run(packet, 'mock', 'fixture', config), /Excluded/);
});
test('provider opt-in, accounts, API spend and reasoning effort fail closed', async () => {
  const { config } = await fixture();
  assert.throws(() => resolveModel(config, 'claude', 'example'), /not enabled/);
  config.providers.claude = { enabled: true, allowedAccounts: [], models: { example: { efforts: ['default'], imageInput: false } } };
  assert.throws(() => validateConfig(config), /allowedAccounts/);
  delete config.providers.claude;
  config.providers.nvidia = { enabled: true, models: { example: { efforts: ['default'], imageInput: false } } };
  assert.throws(() => validateConfig(config), /allowApiSpend/);
  config.allowApiSpend = true;
  validateConfig(config);
  assert.throws(() => resolveModel(config, 'nvidia', 'example', 'max'), /reasoning effort/);
});
test('relative config paths resolve from their file, not the invoking directory', async () => {
  const { root, config } = await fixture();
  const file = path.join(root, 'relative.local.json');
  await fs.writeFile(file, JSON.stringify({ ...config, stateRoot: './separate-state', codexHome: './auth' }));
  const loaded = await loadConfig(file);
  assert.equal(loaded.stateRoot, path.join(root, 'separate-state'));
  assert.equal(loaded.codexHome, path.join(root, 'auth'));
});
test('routing is roster-driven and explains unavailable roles without executing them', async () => {
  const { config } = await fixture();
  const profile = {
    needs: ['engineering', 'critique'],
    stakes: 'medium',
    requestedTeam: true,
    maxReviewers: 2,
    availableProviders: ['mock'],
    leadFamily: 'lead',
  };
  const candidate = { provider: 'mock', model: 'fixture', effort: 'default', family: 'fixture' };
  const roster = {
    schemaVersion: 1,
    roles: { engineering: [candidate], critique: [candidate] },
    toolChecks: { engineering: ['Run tests'], critique: ['Check requirements'] },
  };
  const first = route(profile, roster, config);
  assert.equal(first.workers.length, 1);
  assert.equal(first.unfilled.length, 1);
  assert.deepEqual(first.toolChecks, ['Run tests', 'Check requirements']);
  assert.equal(route({ ...profile, requestedTeam: false, stakes: 'low' }, roster, config).mode, 'lead-only');
  assert.equal(route({ ...profile, maxReviewers: 0 }, roster, config).workers.length, 0);
  config.providers.mock.models.second = { efforts: ['high'], imageInput: false };
  roster.roles.critique = [{ ...candidate, model: 'second', effort: 'high' }];
  assert.equal(route(profile, roster, config).workers[1].model, 'second');
  assert.equal(route({ ...profile, availableProviders: [] }, roster, config).workers.length, 0);
});
test('likely provider secrets are blocked and redacted without containing real keys', () => {
  for (const secret of [['nvapi', 'x'.repeat(30)].join('-'), ['sk-ant', 'x'.repeat(30)].join('-'), ['ghp', 'x'.repeat(30)].join('_')]) {
    assert.throws(() => safeText(secret));
    assert.equal(redact(secret), '[REDACTED]');
  }
});
test('clean install is self-contained, works from another cwd, and refuses overwrite', async () => {
  const { root, config, spec } = await fixture();
  const destination = path.join(root, 'installed-skill');
  const install = () =>
    spawnSync(process.execPath, [path.join(repo, 'scripts/install-skill.mjs'), '--dest', destination], { cwd: root, encoding: 'utf8', windowsHide: true });
  const installed = install();
  assert.equal(installed.status, 0, installed.stderr);
  for (const name of ['LICENSE', 'NOTICE']) assert.deepEqual(await fs.readFile(path.join(destination, name)), await fs.readFile(path.join(repo, name)));
  assert.notEqual(install().status, 0);
  const taskFile = path.join(root, 'task.json');
  const configFile = path.join(root, 'config.local.json');
  await fs.writeFile(taskFile, JSON.stringify(spec));
  await fs.writeFile(configFile, JSON.stringify(config));
  const wrapper = path.join(destination, 'scripts/run.mjs');
  const prepared = spawnSync(process.execPath, [wrapper, 'prepare', taskFile, configFile], { cwd: os.tmpdir(), encoding: 'utf8', windowsHide: true });
  assert.equal(prepared.status, 0, prepared.stderr);
  const ran = spawnSync(process.execPath, [wrapper, 'run', prepared.stdout.trim(), 'mock', 'fixture', configFile], {
    cwd: os.tmpdir(),
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(ran.status, 0, ran.stderr);
  assert.equal(JSON.parse(ran.stdout).status, 'completed');
});
test('changed images are rejected before transport reads and exact bytes are retained', async () => {
  const { root, config, spec } = await fixture();
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
  await fs.writeFile(path.join(root, 'image.png'), bytes);
  const packet = JSON.parse(await fs.readFile(await prepare({ ...spec, images: ['image.png'] }, config), 'utf8'));
  const loaded = await loadImages(packet);
  assert.equal(loaded[0].data, bytes.toString('base64'));
  await fs.writeFile(path.join(root, 'image.png'), Buffer.concat([bytes, Buffer.from([2])]));
  assert.equal(loaded[0].data, bytes.toString('base64'));
  await assert.rejects(loadImages(packet), /before transport/);
});
test('raw metadata secret labels cannot bypass screening through JSON escaping', async () => {
  const { config, spec } = await fixture();
  for (const key of ['assignment', 'requirements', 'constraints', 'decisions']) {
    const value = 'Review with api_key="synthetic-secret-value"';
    await assert.rejects(prepare({ ...spec, [key]: key === 'assignment' ? value : [value] }, config), /Excluded/);
  }
});
test('missing provider-reported model identity stays unknown', () => {
  const review = { packetHash: 'abc', verdict: 'approve', summary: 'Fixture only', findings: [], uncertainties: [] };
  const result = decode('nvidia', JSON.stringify({ response: JSON.stringify(review) }), 'abc', 'requested-model');
  assert.equal(result.actualModel, null);
});
test('incomplete foreign run records do not stop unrelated dispatch', async () => {
  const { config, packet } = await fixture();
  await fs.mkdir(path.join(config.stateRoot, 'runs', 'interrupted'), { recursive: true });
  const result = await run(packet, 'mock', 'fixture', config);
  assert.equal(result.status, 'completed');
});
test('runtime output validation rejects extra schema properties', () => {
  const review = { packetHash: 'abc', verdict: 'approve', summary: 'Fixture', findings: [], uncertainties: [] };
  assert.throws(() => validateResponse({ ...review, unexpected: true }, 'abc'), /properties/);
  assert.throws(
    () => validateResponse({ ...review, findings: [{ severity: 'low', requirement: 'r', evidence: 'e', recommendation: 'r', unexpected: true }] }, 'abc'),
    /properties/,
  );
  assert.throws(
    () =>
      validateArtifact(
        {
          packetHash: 'abc',
          artifact: { filename: 'x.html', mediaType: 'text/html', content: '<!doctype html><html></html>', unexpected: true },
          rationale: 'Fixture',
          uncertainties: [],
        },
        'abc',
      ),
    /properties/,
  );
});
test('status lists incomplete and corrupt records without hiding valid runs or editing evidence', async () => {
  const { config, packet } = await fixture();
  const incomplete = path.join(config.stateRoot, 'runs', 'interrupted');
  const corrupt = path.join(config.stateRoot, 'runs', 'corrupt');
  const result = await run(packet, 'mock', 'fixture', config);
  assert.equal(result.status, 'completed');
  await fs.mkdir(incomplete);
  await fs.mkdir(corrupt);
  await fs.writeFile(path.join(corrupt, 'status.json'), '{');
  const listed = await statuses(config);
  assert.ok(listed.some(r => r.status === 'incomplete-record'));
  assert.ok(listed.some(r => r.status === 'corrupt-record'));
  assert.ok(listed.some(r => r.runId === result.runId && r.status === 'completed'));
  const refusal = await run(packet, 'mock', 'fixture', config);
  assert.equal(refusal.status, 'failed');
  assert.match(refusal.error, /reconcile/);
  assert.equal(await fs.readFile(path.join(corrupt, 'status.json'), 'utf8'), '{');
  assert.deepEqual(await fs.readdir(path.join(config.stateRoot, 'locks')), []);
});
