import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { activateExecutionMode, resolveExecutionMode, selectStandardMode, validateExecutionModes } from '../src/execution-mode.mjs';
import { tempDir } from './helpers.mjs';

const config = stateRoot => ({
  stateRoot,
  standardPolicyVersion: '1.8.0',
  executionModes: { 'claude-bridge': { enabled: true, provider: 'claude', builderVersion: '1.0.0', validatedBuilderVersion: '1.0.0' } },
});

test('execution overlay is opt-in, expiring, and leaves standard canonical', async () => {
  const root = await tempDir('teamloop-mode-');
  const cfg = config(root),
    now = Date.parse('2026-09-13T12:00:00Z');
  assert.equal((await resolveExecutionMode(cfg, now)).effectiveMode, 'standard');
  const active = await activateExecutionMode(cfg, 'claude-bridge', '2026-09-19T11:37:34Z', { now });
  assert.equal(active.effectiveMode, 'claude-bridge');
  assert.equal(active.standardPolicyVersion, '1.8.0');
  const expired = await resolveExecutionMode(cfg, Date.parse('2026-09-19T11:37:34Z'));
  assert.equal(expired.effectiveMode, 'standard');
  assert.equal(expired.reason, 'expired');
  const standard = await selectStandardMode(cfg, { now: now + 1 });
  assert.equal(standard.effectiveMode, 'standard');
  assert.equal(standard.reason, 'explicit-standard');
});

test('invalid, stale, disabled, or unvalidated overlay state fails closed to standard', async () => {
  const root = await tempDir('teamloop-mode-');
  const cfg = config(root),
    file = path.join(root, 'execution-mode.json'),
    now = Date.parse('2026-09-13T12:00:00Z');
  await fs.writeFile(file, '{broken');
  assert.equal((await resolveExecutionMode(cfg, now)).reason, 'invalid-state');
  await fs.writeFile(file, JSON.stringify({ requestedMode: 'unknown', expiresAt: '2026-09-19T11:37:34Z' }));
  assert.equal((await resolveExecutionMode(cfg, now)).reason, 'unsupported-or-disabled');
  assert.throws(() =>
    validateExecutionModes({
      ...cfg,
      executionModes: { 'claude-bridge': { enabled: true, provider: 'claude', builderVersion: '1.0.1', validatedBuilderVersion: '1.0.0' } },
    }),
  );
});
