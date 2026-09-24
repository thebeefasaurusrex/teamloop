import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { digest, prepare, run, selectStatuses, statuses } from '../src/team-loop.mjs';
import { tempDir } from './helpers.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function fixture() {
  const root = await tempDir('teamloop-digest-');
  await fs.writeFile(path.join(root, 'brief.md'), 'Synthetic evidence.');
  const config = {
    schemaVersion: 1,
    stateRoot: path.join(root, 'state'),
    blockedLiterals: [],
    limits: { maxTaskTimeoutMs: 180000, maxRunsPerProviderPacket: 3 },
    providers: { mock: { enabled: true, models: { fixture: { efforts: ['default'], imageInput: false } } } },
  };
  const configFile = path.join(root, 'config.json');
  await fs.writeFile(configFile, JSON.stringify(config));
  const spec = id => ({
    id,
    root,
    assignment: 'Review supplied evidence',
    requirements: ['R1'],
    constraints: [],
    decisions: [],
    files: ['brief.md'],
    dataClass: 'synthetic',
  });
  return { root, config, configFile, spec };
}
const cli = (configFile, ...args) =>
  spawnSync(process.execPath, [path.join(repo, 'src/team-loop.mjs'), ...args, configFile], { cwd: repo, encoding: 'utf8', windowsHide: true });

test('completed records carry severity counts and the digest keeps outcome and pointers only', async () => {
  const { config, spec } = await fixture();
  const record = await run(await prepare(spec('digest-review'), config), 'mock', 'fixture', config);
  assert.deepEqual(record.findings, { high: 0, medium: 0, low: 0 });
  assert.equal(record.uncertainties, 1);
  const d = digest(record, config);
  assert.equal(d.status, 'completed');
  assert.equal(d.verdict, 'blocked');
  assert.deepEqual(d.findings, { high: 0, medium: 0, low: 0 });
  assert.equal(d.files.review, path.join(config.stateRoot, 'runs', record.runId, 'review.json'));
  for (const key of ['overlay', 'account', 'requestedMode', 'packetHash', 'stdoutBytes', 'providerMeta']) assert.equal(key in d, false, key);
  const artifactRecord = await run(await prepare({ ...spec('digest-artifact'), kind: 'artifact' }, config), 'mock', 'fixture', config);
  const a = digest(artifactRecord, config);
  assert.equal(a.artifact, 'demo.html');
  assert.ok(a.artifactBytes > 100);
  assert.equal(a.files.artifact, path.join(config.stateRoot, 'runs', artifactRecord.runId, 'demo.html'));
  assert.equal('review' in a.files, false, 'artifact digests never point the lead at artifact.json');
});

test('status selection is newest first, scoped by task, capped by default, and never hides warnings', () => {
  const records = [
    { runId: 'old', taskId: 'a', startedAt: '2026-09-01T00:00:00Z', status: 'completed' },
    { runId: 'corrupt', status: 'corrupt-record', note: 'Reconcile' },
    { runId: 'new', taskId: 'b', startedAt: '2026-09-03T00:00:00Z', status: 'failed' },
    { runId: 'mid', taskId: 'a', startedAt: '2026-09-02T00:00:00Z', status: 'completed' },
  ];
  assert.deepEqual(
    selectStatuses(records).map(r => r.runId),
    ['corrupt', 'new', 'mid', 'old'],
  );
  assert.deepEqual(
    selectStatuses(records, { last: 1 }).map(r => r.runId),
    ['corrupt', 'new'],
  );
  assert.deepEqual(
    selectStatuses(records, { task: 'a' }).map(r => r.runId),
    ['corrupt', 'mid', 'old'],
  );
  assert.deepEqual(
    selectStatuses(records, { last: 1, all: true }).map(r => r.runId),
    ['corrupt', 'new', 'mid', 'old'],
  );
});

test('status CLI prints digests by default, honours --last, --task and --all, and --full restores complete records', async () => {
  const { config, configFile, spec } = await fixture();
  for (const id of ['task-one', 'task-two', 'task-two']) await run(await prepare(spec(id), config), 'mock', 'fixture', config);
  assert.equal((await statuses(config)).length, 3);
  const short = cli(configFile, 'status', '--last', '2');
  assert.equal(short.status, 0, short.stderr);
  const lines = short.stdout.trim().split(/\r?\n/).map(JSON.parse);
  assert.equal(lines.length, 2);
  assert.equal('overlay' in lines[0], false);
  assert.match(short.stderr, /Showing 2 of 3/);
  const scoped = cli(configFile, 'status', '--task', 'task-one');
  assert.equal(scoped.stdout.trim().split(/\r?\n/).length, 1);
  const full = cli(configFile, 'status', '--all', '--full');
  const records = full.stdout.trim().split(/\r?\n/).map(JSON.parse);
  assert.equal(records.length, 3);
  assert.ok(records.every(r => 'overlay' in r && 'packetHash' in r));
  assert.equal(full.stderr.trim(), '');
  assert.notEqual(cli(configFile, 'status', '--last', 'ten').status, 0);
});

test('run CLI prints a digest by default and the full record with --full', async () => {
  const { config, configFile, spec } = await fixture();
  const packet = await prepare(spec('run-digest'), config);
  const short = cli(configFile, 'run', packet, 'mock', 'fixture');
  assert.equal(short.status, 0, short.stderr);
  const d = JSON.parse(short.stdout);
  assert.equal(d.status, 'completed');
  assert.equal(d.verdict, 'blocked');
  assert.equal('overlay' in d, false);
  assert.ok(d.files.status.endsWith('status.json'));
  const full = cli(configFile, 'run', packet, 'mock', 'fixture', '--full');
  assert.equal(full.status, 0, full.stderr);
  assert.ok('overlay' in JSON.parse(full.stdout));
});

test('plan run keeps NDJSON on stdout and writes a one-line digest to stderr', async () => {
  const { root, config, configFile, spec } = await fixture();
  const packet = await prepare(spec('plan-digest'), config);
  const planFile = path.join(root, 'plan.json');
  await fs.writeFile(
    planFile,
    JSON.stringify({
      schemaVersion: 1,
      taskId: 'plan-digest',
      policyVersion: 'test-1',
      maxConcurrency: 1,
      stages: [{ id: 'mock-review', type: 'review', packet, provider: 'mock', model: 'fixture' }],
    }),
  );
  const ran = cli(configFile, 'plan', 'run', planFile);
  assert.equal(ran.status, 0, ran.stderr);
  const events = ran.stdout.trim().split(/\r?\n/).map(JSON.parse);
  assert.equal(events.at(-1).event, 'run_finished');
  const summary = JSON.parse(ran.stderr.trim().split(/\r?\n/).at(-1));
  assert.equal(summary.status, 'completed');
  assert.equal(summary.leadDecisionRequired, true);
  assert.match(summary.stages[0], /^mock-review completed blocked run [a-f0-9-]{36}$/);
});
