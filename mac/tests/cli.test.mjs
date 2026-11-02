import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const cli = fileURLToPath(new URL('../core/cli.mjs', import.meta.url));
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'teamloop-cli-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return (action, input = '{}') =>
    spawnSync(process.execPath, [cli, action], { input, encoding: 'utf8', timeout: 10000, env: { ...process.env, TEAMLOOP_STATE_DIR: root } });
}
test('native IPC contract returns one JSON snapshot with no secret storage', async t => {
  const run = await fixture(t);
  const r = run('snapshot');
  assert.equal(r.status, 0);
  const v = JSON.parse(r.stdout);
  assert.ok(v.settings);
  assert.ok(v.policy);
  assert.equal(v.policy.dailyClaudeRecheck, false);
  assert.equal(r.stdout.trim().split('\n').length, 1);
});
test('configure then restart preserves native settings', async t => {
  const run = await fixture(t);
  assert.equal(run('configure', JSON.stringify({ settings: { preventSleep: false, pollSeconds: 120 } })).status, 0);
  const v = JSON.parse(run('snapshot').stdout);
  assert.equal(v.settings.preventSleep, false);
  assert.equal(v.settings.pollSeconds, 120);
  assert.ok(v.revision > 0);
});
test('malformed IPC does not echo a credential excerpt', async t => {
  const run = await fixture(t);
  const r = run('configure', '{"secrets":{"relay":"sensitive-value"},broken');
  assert.equal(r.status, 1);
  assert.ok(!r.stdout.includes('sensitive-value'));
  assert.ok(JSON.parse(r.stdout).error);
});
test('IPC rejects unknown actions without running tools', async t => {
  const run = await fixture(t);
  const r = run('shell', '{}');
  assert.equal(r.status, 1);
  assert.match(JSON.parse(r.stdout).error, /Unknown/);
});
